import cors from "cors";
import express, { NextFunction, Request, Response, Express } from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { JsonRpcHandler } from "./jsonrpc.handler";

export function createApp(): { app: Express; server: http.Server } {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(cors());
  app.use(express.json());

  wss.on("connection", (ws) => {
    const handler = new JsonRpcHandler(ws);

    ws.on("message", async (data) => {
      await handler.processMessage(data.toString());
    });

    ws.on("close", () => {
      handler.cleanup();
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "up",
    });
  });

  app.use((_req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ message: "Resource not found" });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
  });

  return { app, server };
}
