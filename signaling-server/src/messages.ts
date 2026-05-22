export type ClientRole = "viewer" | "sender";

export type SignalMessage =
  | { type: "join"; roomId: string; role?: ClientRole }
  | { type: "offer"; roomId: string; payload: unknown }
  | { type: "answer"; roomId: string; payload: unknown }
  | { type: "ice-candidate"; roomId: string; payload: unknown }
  | { type: "leave"; roomId: string };

export type ServerMessage =
  | { type: "joined"; roomId: string; clientId: string }
  | { type: "peer-joined"; roomId: string; clientId: string; role?: ClientRole }
  | { type: "peer-left"; roomId: string; clientId: string }
  | { type: "offer"; roomId: string; payload: unknown }
  | { type: "answer"; roomId: string; payload: unknown }
  | { type: "ice-candidate"; roomId: string; payload: unknown }
  | { type: "error"; message: string };

const relayTypes = new Set(["offer", "answer", "ice-candidate"]);

export function parseMessage(data: Buffer): SignalMessage | null {
  try {
    const parsed = JSON.parse(data.toString("utf8")) as Partial<SignalMessage>;
    if (!parsed || typeof parsed.type !== "string" || typeof parsed.roomId !== "string") {
      return null;
    }

    if (parsed.type === "join" || parsed.type === "leave") {
      return parsed as SignalMessage;
    }

    if (relayTypes.has(parsed.type) && "payload" in parsed) {
      return parsed as SignalMessage;
    }

    return null;
  } catch {
    return null;
  }
}

export function serializeMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
