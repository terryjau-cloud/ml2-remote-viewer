# Architecture

## Phase 1 Scope

The prototype has two independent applications:

- `frontend`: React viewer that joins a room, waits for a remote WebRTC offer, creates an answer, and displays remote media.
- `signaling-server`: WebSocket relay that groups clients by room and forwards WebRTC signaling messages.

## Signaling Flow

```text
sender -> signaling server -> viewer: offer
viewer -> signaling server -> sender: answer
sender <-> signaling server <-> viewer: ICE candidates
```

The server does not inspect SDP or ICE payloads. It only validates the high-level message envelope and relays messages to peers in the same room.

## Message Envelope

```ts
type SignalMessage =
  | { type: "join"; roomId: string; role?: "viewer" | "sender" }
  | { type: "offer"; roomId: string; payload: RTCSessionDescriptionInit }
  | { type: "answer"; roomId: string; payload: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; roomId: string; payload: RTCIceCandidateInit }
  | { type: "leave"; roomId: string };
```

## Notes

- The frontend is receiver-only in this phase.
- No TURN server is configured yet.
- No authentication, persistence, or deployment configuration is included.
