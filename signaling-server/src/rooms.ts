import type { WebSocket } from "ws";
import { serializeMessage, type ClientRole, type ServerMessage } from "./messages.js";

export type Client = {
  id: string;
  socket: WebSocket;
  roomId?: string;
  role?: ClientRole;
};

type RelayMessage = Extract<ServerMessage, { roomId: string }>;

export class RoomManager {
  private readonly rooms = new Map<string, Set<Client>>();

  join(client: Client, roomId: string, role?: ClientRole) {
    this.leave(client);

    const room = this.rooms.get(roomId) ?? new Set<Client>();
    const existingClients = [...room];
    room.add(client);
    this.rooms.set(roomId, room);

    client.roomId = roomId;
    client.role = role;

    this.send(client, { type: "joined", roomId, clientId: client.id });

    for (const existingClient of existingClients) {
      this.send(client, {
        type: "peer-joined",
        roomId,
        clientId: existingClient.id,
        role: existingClient.role,
      });
    }

    this.broadcast(client, {
      type: "peer-joined",
      roomId,
      clientId: client.id,
      role,
    });
  }

  leave(client: Client) {
    const roomId = client.roomId;
    if (!roomId) {
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      client.roomId = undefined;
      client.role = undefined;
      return;
    }

    room.delete(client);
    this.broadcast(client, { type: "peer-left", roomId, clientId: client.id });

    if (room.size === 0) {
      this.rooms.delete(roomId);
    }

    client.roomId = undefined;
    client.role = undefined;
  }

  relay(sender: Client, message: RelayMessage) {
    if (!sender.roomId || sender.roomId !== message.roomId) {
      this.send(sender, { type: "error", message: "Client is not joined to this room." });
      return;
    }

    this.broadcast(sender, message);
  }

  private broadcast(sender: Client, message: ServerMessage) {
    const room = sender.roomId ? this.rooms.get(sender.roomId) : undefined;
    if (!room) {
      return;
    }

    for (const client of room) {
      if (client.id !== sender.id) {
        this.send(client, message);
      }
    }
  }

  private send(client: Client, message: ServerMessage) {
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(serializeMessage(message));
    }
  }
}
