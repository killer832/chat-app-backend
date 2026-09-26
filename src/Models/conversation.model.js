import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    isGroup: { type: Boolean, default: false },
    members: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

conversationSchema.index({ members: 1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
