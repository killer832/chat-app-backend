import { Router } from "express";
import {
  chatFileUpload,
  createGroup,
  getMessages,
  listConversations,
  addGroupMembers,
  removeGroupMember,
} from "../Controllers/message.controller.js";
import { verifyJwt } from "../Middlewares/auth.middleware.js";
import { upload } from "../Middlewares/multer.middleware.js";

const router = Router();

router.get("/conversations", verifyJwt, listConversations);
router.post("/groups", verifyJwt, createGroup);
router.post("/groups/:conversationId/members", verifyJwt, addGroupMembers);
router.delete(
  "/groups/:conversationId/members/:userId",
  verifyJwt,
  removeGroupMember,
);
router.get("/groups/:conversationId/messages", verifyJwt, getMessages);
router.get("/:userId/messages", verifyJwt, getMessages);
router.post(
  "/chat-files-upload",
  verifyJwt,
  upload.single("chatFile"),
  chatFileUpload,
);

export default router;
