import { useCallback, useEffect, useRef, useState } from "react";
import { parseSignalMessage, type SignalMessage } from "./signaling";

type ConnectionStatus =
  | "idle"
  | "connecting"
  | "joined"
  | "receiving-offer"
  | "connected"
  | "disconnected"
  | "error";

const signalingUrl = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:8080";

function createTimestamp() {
  return new Date().toLocaleTimeString();
}

function App() {
  const [roomId, setRoomId] = useState("dev-room");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const addLog = useCallback((message: string) => {
    setLogs((current) => [`[${createTimestamp()}] ${message}`, ...current].slice(0, 120));
  }, []);

  const sendSignal = useCallback(
    (message: SignalMessage) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        addLog("Cannot send signaling message: WebSocket is not open.");
        return;
      }

      socket.send(JSON.stringify(message));
    },
    [addLog],
  );

  const cleanupPeerConnection = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnectionRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (activeRoomId) {
      sendSignal({ type: "leave", roomId: activeRoomId });
    }

    socketRef.current?.close();
    socketRef.current = null;
    cleanupPeerConnection();
    setStatus("disconnected");
    addLog("Disconnected.");
  }, [activeRoomId, addLog, cleanupPeerConnection, sendSignal]);

  const ensurePeerConnection = useCallback(
    (targetRoomId: string) => {
      if (peerConnectionRef.current) {
        return peerConnectionRef.current;
      }

      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;
        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
        }
        setStatus("connected");
        addLog("Remote media track received.");
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: "ice-candidate",
            roomId: targetRoomId,
            payload: event.candidate.toJSON(),
          });
          addLog("Sent local ICE candidate.");
        }
      };

      peerConnection.onconnectionstatechange = () => {
        addLog(`Peer connection state: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === "failed") {
          setStatus("error");
        }
      };

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    },
    [addLog, sendSignal],
  );

  const handleOffer = useCallback(
    async (targetRoomId: string, offer: RTCSessionDescriptionInit) => {
      setStatus("receiving-offer");
      addLog("Received offer.");

      const peerConnection = ensurePeerConnection(targetRoomId);
      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      sendSignal({
        type: "answer",
        roomId: targetRoomId,
        payload: answer,
      });

      addLog("Created and sent answer.");
    },
    [addLog, ensurePeerConnection, sendSignal],
  );

  const handleMessage = useCallback(
    async (message: SignalMessage) => {
      switch (message.type) {
        case "joined":
          setStatus("joined");
          addLog(`Joined room "${message.roomId}" as viewer.`);
          break;
        case "peer-joined":
          addLog(`Peer joined room: ${message.clientId}${message.role ? ` (${message.role})` : ""}.`);
          break;
        case "peer-left":
          addLog(`Peer left room: ${message.clientId}.`);
          break;
        case "offer":
          await handleOffer(message.roomId, message.payload);
          break;
        case "ice-candidate":
          if (message.payload && peerConnectionRef.current?.remoteDescription) {
            await peerConnectionRef.current.addIceCandidate(message.payload);
            addLog("Added remote ICE candidate.");
          } else {
            addLog("Skipped ICE candidate because remote description is not ready.");
          }
          break;
        case "error":
          setStatus("error");
          addLog(`Signaling error: ${message.message}`);
          break;
        default:
          break;
      }
    },
    [addLog, handleOffer],
  );

  const joinRoom = useCallback(
    (targetRoomId = roomId.trim()) => {
      if (!targetRoomId) {
        setStatus("error");
        addLog("Room ID is required.");
        return;
      }

      disconnect();
      setStatus("connecting");
      setActiveRoomId(targetRoomId);
      addLog(`Connecting to signaling server at ${signalingUrl}.`);

      const socket = new WebSocket(signalingUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", roomId: targetRoomId, role: "viewer" }));
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          addLog("Ignored non-text signaling message.");
          return;
        }

        const message = parseSignalMessage(event.data);
        if (!message) {
          addLog("Ignored invalid signaling message.");
          return;
        }

        void handleMessage(message);
      };

      socket.onerror = () => {
        setStatus("error");
        addLog("WebSocket error.");
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        cleanupPeerConnection();
        setStatus((current) => (current === "error" ? "error" : "disconnected"));
        addLog("WebSocket closed.");
      };
    },
    [addLog, cleanupPeerConnection, disconnect, handleMessage, roomId],
  );

  const reconnect = useCallback(() => {
    const targetRoomId = activeRoomId || roomId.trim();
    addLog("Reconnecting.");
    joinRoom(targetRoomId);
  }, [activeRoomId, addLog, joinRoom, roomId]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      cleanupPeerConnection();
    };
  }, [cleanupPeerConnection]);

  const isJoined = status === "joined" || status === "receiving-offer" || status === "connected";

  return (
    <main className="app-shell">
      <section className="viewer-panel">
        <div className="toolbar">
          <label className="room-field">
            <span>Room ID</span>
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder="dev-room"
              disabled={isJoined}
            />
          </label>
          <button onClick={() => joinRoom()} disabled={isJoined || status === "connecting"}>
            Join
          </button>
          <button onClick={disconnect} disabled={status === "idle" || status === "disconnected"}>
            Disconnect
          </button>
          <button onClick={reconnect} disabled={!activeRoomId && !roomId.trim()}>
            Reconnect
          </button>
        </div>

        <div className="status-row">
          <span className={`status-dot status-${status}`} />
          <span>Connection status: {status}</span>
        </div>

        <div className="video-frame">
          <video ref={videoRef} autoPlay playsInline controls muted={false} />
          {status !== "connected" && <div className="video-placeholder">Waiting for remote video</div>}
        </div>
      </section>

      <section className="log-panel">
        <h1>ICE / Signaling Log</h1>
        <div className="log-list" aria-live="polite">
          {logs.length === 0 ? <p>No signaling activity yet.</p> : logs.map((log) => <p key={log}>{log}</p>)}
        </div>
      </section>
    </main>
  );
}

export default App;
