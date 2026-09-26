import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    UploadedFile: {
      type: String,
      default: null,
    },
    UploadedFileId: {
      type: String,
      default: null,
    },
    reactions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        value: { type: String, required: true, trim: true },
      },
    ],
    isPending: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index({ recipients: 1, isPending: 1 });

export const Message = mongoose.model("Message", messageSchema);
