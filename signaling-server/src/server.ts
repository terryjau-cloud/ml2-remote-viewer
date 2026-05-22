import "dotenv/config";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { WebSocketServer } from "ws";
import { parseMessage, serializeMessage } from "./messages.js";
import { RoomManager, type Client } from "./rooms.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8080);

const roomManager = new RoomManager();
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, service: "ml2-remote-viewer-signaling" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const client: Client = {
    id: randomUUID(),
    socket,
  };

  socket.on("message", (data) => {
    if (!Buffer.isBuffer(data)) {
      socket.send(serializeMessage({ type: "error", message: "Only text messages are supported." }));
      return;
    }

    const message = parseMessage(data);
    if (!message) {
      socket.send(serializeMessage({ type: "error", message: "Invalid signaling message." }));
      return;
    }

    switch (message.type) {
      case "join":
        roomManager.join(client, message.roomId, message.role);
        break;
      case "leave":
        roomManager.leave(client);
        break;
      case "offer":
      case "answer":
      case "ice-candidate":
        roomManager.relay(client, message);
        break;
      default:
        socket.send(serializeMessage({ type: "error", message: "Unsupported message type." }));
        break;
    }
  });

  socket.on("close", () => {
    roomManager.leave(client);
  });
});

server.listen(port, host, () => {
  console.log(`Signaling server listening on ws://${host}:${port}`);
});
