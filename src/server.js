import "dotenv/config";
import {app} from "./app.js";
import { Server } from "socket.io";
import http from "http";
import connectDB from "./DB/db.js";

const server = http.createServer(app);
export const io = new Server(server);
const port = process.env.PORT || 3000;

io.on("connection", (socket) => {
  console.log("A user connected");
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
