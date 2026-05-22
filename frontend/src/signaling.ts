export type ClientRole = "viewer" | "sender";

export type SignalMessage =
  | { type: "join"; roomId: string; role: ClientRole }
  | { type: "joined"; roomId: string; clientId: string }
  | { type: "peer-joined"; roomId: string; clientId: string; role?: ClientRole }
  | { type: "peer-left"; roomId: string; clientId: string }
  | { type: "offer"; roomId: string; payload: RTCSessionDescriptionInit }
  | { type: "answer"; roomId: string; payload: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; roomId: string; payload: RTCIceCandidateInit }
  | { type: "leave"; roomId: string }
  | { type: "error"; message: string };

export function parseSignalMessage(data: string): SignalMessage | null {
  try {
    const parsed = JSON.parse(data) as Partial<SignalMessage>;
    return typeof parsed.type === "string" ? (parsed as SignalMessage) : null;
  } catch {
    return null;
  }
}
