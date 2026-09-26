import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

// import routes

import userRoute from "./Routes/user.route.js";
import messageRoute from "./Routes/message.route.js";


// routes declaration
app.use("/api/v1/users", userRoute);
app.use("/api/v1/messages", messageRoute);

export { app };
