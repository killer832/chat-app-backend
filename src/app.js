import express from "express";

const app = express();

app.use(express.json({ limit: "16kb" }));

app.get("/", (req, res) => {
  res.send("Hello, World!");
}); 

export { app };
