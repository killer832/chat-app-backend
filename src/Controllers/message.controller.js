import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Message } from "../Models/messages.model.js";
import { Conversation } from "../Models/conversation.model.js";
import { User } from "../Models/user.model.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asyncHandler.js";
import { uploadFilesOnImageKit } from "../Services/imagekit.service.js";

const onlineUser = new Map();

const chatFileUpload = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Chat file is required");

  const uploadedFile = await uploadFilesOnImageKit(req.file.path);
  if (!uploadedFile?.url || !uploadedFile?.fileId)
    throw new ApiError(502, "Unable to upload chat file");

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        {
          url: uploadedFile.url,
          fileId: uploadedFile.fileId,
          name: uploadedFile.name || req.file.originalname,
          size: uploadedFile.size || req.file.size,
          mimeType: req.file.mimetype,
        },
        "Chat file uploaded successfully",
      ),
    );
});

const createGroup = asyncHandler(async (req, res) => {
  const { name, memberIds = [] } = req.body;
  if (!name?.trim() || !Array.isArray(memberIds))
    throw new ApiError(400, "Group name and memberIds are required");
  const ids = [...new Set([String(req.user._id), ...memberIds.map(String)])];
  if (ids.some((id) => !mongoose.isValidObjectId(id)))
    throw new ApiError(400, "Invalid member ID");
  const users = await User.countDocuments({ _id: { $in: ids } });
  if (users !== ids.length)
    throw new ApiError(404, "One or more group members do not exist");
  const conversation = await Conversation.create({
    name: name.trim(),
    members: ids,
    createdBy: req.user._id,
    isGroup: true,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, conversation, "Group created"));
});

const getMessages = asyncHandler(async (req, res) => {
  const { conversationId, userId } = req.params;
  let filter;
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId))
      throw new ApiError(400, "Invalid conversation ID");

    const conversation = await Conversation.findOne({
      _id: conversationId,
      members: req.user._id,
    });

    if (!conversation) throw new ApiError(404, "Conversation not found");

    filter = { conversation: conversation._id };
  } else {
    if (!mongoose.isValidObjectId(userId))
      throw new ApiError(400, "Invalid user ID");
    filter = {
      conversation: null,
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id },
      ],
    };
  }

  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(parsedLimit, 1), 100);
  const before = req.query.before;
  if (before) {
    if (!mongoose.isValidObjectId(before))
      throw new ApiError(400, "Invalid before cursor");
    const cursorMessage = await Message.findOne({ _id: before, ...filter }).select(
      "_id createdAt",
    );
    if (!cursorMessage) throw new ApiError(400, "Cursor message not found in this chat");
    filter.$or = [
      ...(filter.$or || []),
      { createdAt: { $lt: cursorMessage.createdAt } },
      { createdAt: cursorMessage.createdAt, _id: { $lt: cursorMessage._id } },
    ];
    if (filter.$or.length > 2 && !conversationId) {
      const directPair = filter.$or.slice(0, 2);
      filter.$and = [{ $or: directPair }, { $or: filter.$or.slice(2) }];
      delete filter.$or;
    }
  }

  const page = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1);
  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse();
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {
          messages,
          hasMore,
          nextCursor: hasMore ? messages[0]?._id : null,
        },
        "Messages fetched",
      ),
    );
});

const listConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const groups = await Conversation.find({ members: userId, isGroup: true })
    .sort({ updatedAt: -1 })
    .lean();
  const groupConversations = await Promise.all(
    groups.map(async (conversation) => ({
      ...conversation,
      lastMessage: await Message.findOne({ conversation: conversation._id })
        .sort({ createdAt: -1, _id: -1 })
        .lean(),
    })),
  );

  const directMessages = await Message.find({
    conversation: null,
    $or: [{ sender: userId }, { receiver: userId }],
  })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const directByUser = new Map();
  for (const message of directMessages) {
    const peerId = String(message.sender) === String(userId)
      ? String(message.receiver)
      : String(message.sender);
    if (peerId && peerId !== "null" && !directByUser.has(peerId))
      directByUser.set(peerId, { type: "direct", userId: peerId, lastMessage: message });
  }
  const peerIds = [...directByUser.keys()];
  const peers = await User.find({ _id: { $in: peerIds } }).select("fullname username avatar").lean();
  const peerById = new Map(peers.map((peer) => [String(peer._id), peer]));
  const conversations = [
    ...groupConversations.map((conversation) => ({ type: "group", ...conversation })),
    ...[...directByUser.entries()].map(([peerId, direct]) => ({
      ...direct,
      user: peerById.get(peerId) || null,
    })),
  ].sort(
    (a, b) => new Date(b.lastMessage?.createdAt || b.updatedAt || 0) -
      new Date(a.lastMessage?.createdAt || a.updatedAt || 0),
  );

  return res.status(200).json(new ApiResponse(200, conversations, "Conversations fetched"));
});

const addGroupMembers = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { memberIds } = req.body;
  if (!mongoose.isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversation ID");
  if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.some((id) => !mongoose.isValidObjectId(id)))
    throw new ApiError(400, "A non-empty array of valid memberIds is required");
  const conversation = await Conversation.findOne({ _id: conversationId, isGroup: true });
  if (!conversation) throw new ApiError(404, "Group not found");
  if (String(conversation.createdBy) !== String(req.user._id))
    throw new ApiError(403, "Only the group creator can manage members");
  const ids = [...new Set(memberIds.map(String))];
  const found = await User.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw new ApiError(404, "One or more members do not exist");
  const newIds = ids.filter((id) => !conversation.members.some((member) => String(member) === id));
  conversation.members.push(...newIds);
  await conversation.save();
  return res.status(200).json(new ApiResponse(200, conversation, "Group members added"));
});

const removeGroupMember = asyncHandler(async (req, res) => {
  const { conversationId, userId } = req.params;
  if (![conversationId, userId].every((id) => mongoose.isValidObjectId(id)))
    throw new ApiError(400, "Invalid conversation or user ID");
  const conversation = await Conversation.findOne({ _id: conversationId, isGroup: true });
  if (!conversation) throw new ApiError(404, "Group not found");
  if (String(conversation.createdBy) !== String(req.user._id))
    throw new ApiError(403, "Only the group creator can manage members");
  if (String(conversation.createdBy) === String(userId))
    throw new ApiError(400, "The group creator cannot be removed");
  conversation.members = conversation.members.filter((member) => String(member) !== String(userId));
  await conversation.save();
  return res.status(200).json(new ApiResponse(200, conversation, "Group member removed"));
});

const authenticateUser = (token) => {
  try {
    if (!token) return null;
    const accessToken = token.startsWith("Bearer ") ? token.slice(7) : token;
    return jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET)._id;
  } catch {
    return null;
  }
};

const emitToUser = (io, recipientId, message) => {
  const socketIds = onlineUser.get(String(recipientId));
  if (!socketIds?.size) return false;
  for (const socketId of socketIds) io.to(socketId).emit("message", message);
  return true;
};

const deliverPendingMessages = async (socket) => {
  const pending = await Message.find({
    recipients: socket.userId,
    isPending: true,
  }).sort({ createdAt: 1 });
  for (const message of pending) {
    socket.emit("message", message.toObject());
    message.recipients = message.recipients.filter(
      (id) => String(id) !== String(socket.userId),
    );
    message.isPending = message.recipients.length > 0;
    await message.save();
  }
};

const handleOnConnection = (socket) => {
  const userId = String(socket.userId);
  const wasOffline = !onlineUser.has(userId);
  if (!onlineUser.has(userId)) onlineUser.set(userId, new Set());
  onlineUser.get(userId).add(socket.id);
  if (wasOffline) socket.nsp.emit("presence", { userId, isOnline: true });
  void deliverPendingMessages(socket).catch((error) =>
    console.error("Pending message delivery failed:", error),
  );
  socket.on("disconnect", () => {
    const sockets = onlineUser.get(userId);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) {
      onlineUser.delete(userId);
      socket.nsp.emit("presence", { userId, isOnline: false });
    }
  });
};

const messageHandler = async (socket, data, io) => {
  const {
    receiverId,
    conversationId,
    message,
    content,
    UploadedFile = null,
    UploadedFileId = null,
  } = data || {};
  const text = content ?? message;
  if (!text && !UploadedFile)
    throw new Error("Message content or a file is required");

  let recipients;
  let conversation = null;
  let receiver = null;
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId))
      throw new Error("Invalid conversation ID");
    conversation = await Conversation.findOne({
      _id: conversationId,
      members: socket.userId,
      isGroup: true,
    });
    if (!conversation) throw new Error("Group conversation not found");
    recipients = conversation.members.filter(
      (id) => String(id) !== String(socket.userId),
    );
  } else {
    if (
      !mongoose.isValidObjectId(receiverId) ||
      String(receiverId) === String(socket.userId)
    )
      throw new Error("Valid receiverId is required");
    if (!(await User.exists({ _id: receiverId })))
      throw new Error("Receiver not found");
    receiver = receiverId;
    recipients = [receiverId];
  }

  const offlineRecipients = recipients.filter(
    (id) => !onlineUser.has(String(id)),
  );
  const savedMessage = await Message.create({
    content: text || "",
    sender: socket.userId,
    receiver,
    conversation: conversation?._id || null,
    recipients: offlineRecipients,
    isPending: offlineRecipients.length > 0,
    UploadedFile,
    UploadedFileId,
  });
  const payload = savedMessage.toObject();
  for (const recipientId of recipients) emitToUser(io, recipientId, payload);
  socket.emit("message-sent", payload);
};

const handleMessageReaction = async (socket, data, io) => {
  const { messageId, reaction } = data || {};
  if (!mongoose.isValidObjectId(messageId) || typeof reaction !== "string" || !reaction.trim())
    throw new Error("messageId and a non-empty reaction are required");

  const message = await Message.findById(messageId);
  if (!message) throw new Error("Message not found");
  let recipients;
  if (message.conversation) {
    const conversation = await Conversation.findOne({
      _id: message.conversation,
      members: socket.userId,
    });
    if (!conversation) throw new Error("You are not a member of this group");
    recipients = conversation.members.filter((id) => String(id) !== String(socket.userId));
  } else {
    if (![message.sender, message.receiver].some((id) => String(id) === String(socket.userId)))
      throw new Error("You are not a participant in this message");
    recipients = [message.sender, message.receiver].filter((id) => String(id) !== String(socket.userId));
  }

  message.reactions = message.reactions.filter((item) => String(item.user) !== String(socket.userId));
  message.reactions.push({ user: socket.userId, value: reaction.trim() });
  await message.save();
  const payload = {
    messageId: String(message._id),
    reactions: message.reactions.map((item) => ({ userId: String(item.user), value: item.value })),
  };
  socket.emit("message-reaction-updated", payload);
  for (const recipientId of recipients) {
    const sockets = onlineUser.get(String(recipientId));
    if (sockets)
      for (const socketId of sockets)
        io.to(socketId).emit("message-reaction", {
          senderId: String(socket.userId),
          ...payload,
        });
  }
};

const handleIsUserOnline = (socket, data) => {
  const { receiverId } = data || {};
  if (receiverId)
    socket.emit("isUserOnline", {
      userId: receiverId,
      isOnline: onlineUser.has(String(receiverId)),
    });
};

export {
  createGroup,
  listConversations,
  addGroupMembers,
  removeGroupMember,
  getMessages,
  handleIsUserOnline,
  handleMessageReaction,
  messageHandler,
  handleOnConnection,
  authenticateUser,
  chatFileUpload
};
