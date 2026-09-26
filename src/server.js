import "dotenv/config";
import { app } from "./app.js";
import { Server } from "socket.io";
import http from "http";
import connectDB from "./DB/db.js";
import {
  handleOnConnection,
  messageHandler,
  handleMessageReaction,
  handleIsUserOnline,
  authenticateUser
} from "./Controllers/message.controller.js";
// import { ApiError } from "./Utils/ApiError.js";

const server = http.createServer(app);
export const io = new Server(server);

const port = process.env.PORT || 3000;

const messages = io.of("/message");

messages.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers.authorization;
  const userId = authenticateUser(token);

  if (!userId) {
    return next(new Error("Unauthorized"));
  }

  socket.userId = userId;
  next();
});

messages.on("connection", (socket) => {
  handleOnConnection(socket);

  socket.on("message", async (data) => {
    try {
      await messageHandler(socket, data, messages);
    } catch (error) {
      socket.emit("message-error", { message: error.message });
    }
  });
  socket.on("message-reaction", async (data) => {
    try {
      await handleMessageReaction(socket, data, messages);
    } catch (error) {
      socket.emit("message-reaction-error", { message: error.message });
    }
  });
  socket.on("isUserOnline", (data) => {
    handleIsUserOnline(socket, data);
  });
});

connectDB()
  .then(() => {
    server.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Error starting server:", error);
  });
