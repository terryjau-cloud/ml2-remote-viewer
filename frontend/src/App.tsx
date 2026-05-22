import { useCallback, useEffect, useRef, useState } from "react";
import { parseSignalMessage, type SignalMessage } from "./signaling";

type ConnectionStatus =
  | "idle"
  | "connecting"
  | "joined"
  | "requesting-media"
  | "sending-offer"
  | "receiving-offer"
  | "connected"
  | "disconnected"
  | "error";

type AppMode = "viewer" | "sender";

const signalingUrl = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:8080";
const currentPageUrl = window.location.origin;

function createTimestamp() {
  return new Date().toLocaleTimeString();
}

function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
}

function useSignalLog() {
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    setLogs((current) => [`[${createTimestamp()}] ${message}`, ...current].slice(0, 120));
  }, []);

  return { logs, addLog };
}

function useHashMode() {
  const readMode = () => (window.location.hash === "#sender" ? "sender" : "viewer");
  const [mode, setMode] = useState<AppMode>(readMode);

  useEffect(() => {
    const handleHashChange = () => setMode(readMode());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return mode;
}

function App() {
  const mode = useHashMode();

  return (
    <>
      <nav className="app-nav" aria-label="Prototype pages">
        <a className={mode === "viewer" ? "active" : ""} href="#">
          Viewer
        </a>
        <a className={mode === "sender" ? "active" : ""} href="#sender">
          Test Sender
        </a>
      </nav>
      {mode === "sender" ? <SenderPage /> : <ViewerPage />}
    </>
  );
}

function ViewerPage() {
  const [roomId, setRoomId] = useState("dev-room");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const { logs, addLog } = useSignalLog();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

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

    pendingIceCandidatesRef.current = [];

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

  const flushPendingIceCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection?.remoteDescription) {
      return;
    }

    const pendingCandidates = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of pendingCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }

    if (pendingCandidates.length > 0) {
      addLog(`Added ${pendingCandidates.length} queued remote ICE candidate(s).`);
    }
  }, [addLog]);

  const ensurePeerConnection = useCallback(
    (targetRoomId: string) => {
      if (peerConnectionRef.current) {
        return peerConnectionRef.current;
      }

      const peerConnection = createPeerConnection();

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
        if (peerConnection.connectionState === "connected") {
          setStatus("connected");
        }
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
      await flushPendingIceCandidates();

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      sendSignal({
        type: "answer",
        roomId: targetRoomId,
        payload: answer,
      });

      addLog("Created and sent answer.");
    },
    [addLog, ensurePeerConnection, flushPendingIceCandidates, sendSignal],
  );

  const handleIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      if (peerConnectionRef.current?.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(candidate);
        addLog("Added remote ICE candidate.");
        return;
      }

      pendingIceCandidatesRef.current.push(candidate);
      addLog("Queued remote ICE candidate until remote description is ready.");
    },
    [addLog],
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
          await handleIceCandidate(message.payload);
          break;
        case "error":
          setStatus("error");
          addLog(`Signaling error: ${message.message}`);
          break;
        default:
          break;
      }
    },
    [addLog, handleIceCandidate, handleOffer],
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

        <StatusRow status={status} />
        <ConnectionDetails />

        <div className="video-frame">
          <video ref={videoRef} autoPlay playsInline controls muted={false} />
          {status !== "connected" && <div className="video-placeholder">Waiting for remote video</div>}
        </div>
      </section>

      <LogPanel title="Viewer ICE / Signaling Log" logs={logs} />
    </main>
  );
}

function SenderPage() {
  const [roomId, setRoomId] = useState("dev-room");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const { logs, addLog } = useSignalLog();
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

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

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  }, []);

  const cleanupPeerConnection = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnectionRef.current = null;
    }

    pendingIceCandidatesRef.current = [];
  }, []);

  const disconnect = useCallback(() => {
    if (activeRoomId) {
      sendSignal({ type: "leave", roomId: activeRoomId });
    }

    socketRef.current?.close();
    socketRef.current = null;
    cleanupPeerConnection();
    stopLocalStream();
    setStatus("disconnected");
    addLog("Sender disconnected.");
  }, [activeRoomId, addLog, cleanupPeerConnection, sendSignal, stopLocalStream]);

  const getLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    setStatus("requesting-media");
    addLog("Requesting webcam video.");

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });

    localStreamRef.current = stream;
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = stream;
    }

    addLog("Webcam stream ready.");
    return stream;
  }, [addLog]);

  const flushPendingIceCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection?.remoteDescription) {
      return;
    }

    const pendingCandidates = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of pendingCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }

    if (pendingCandidates.length > 0) {
      addLog(`Added ${pendingCandidates.length} queued remote ICE candidate(s).`);
    }
  }, [addLog]);

  const ensurePeerConnection = useCallback(
    async (targetRoomId: string) => {
      const stream = await getLocalStream();

      if (peerConnectionRef.current) {
        return peerConnectionRef.current;
      }

      const peerConnection = createPeerConnection();
      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

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
        if (peerConnection.connectionState === "connected") {
          setStatus("connected");
        }
        if (peerConnection.connectionState === "failed") {
          setStatus("error");
        }
      };

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    },
    [addLog, getLocalStream, sendSignal],
  );

  const createAndSendOffer = useCallback(
    async (targetRoomId: string) => {
      setStatus("sending-offer");
      const peerConnection = await ensurePeerConnection(targetRoomId);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      sendSignal({
        type: "offer",
        roomId: targetRoomId,
        payload: offer,
      });

      addLog("Created and sent offer.");
    },
    [addLog, ensurePeerConnection, sendSignal],
  );

  const handleAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit) => {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        addLog("Skipped answer because peer connection is not ready.");
        return;
      }

      await peerConnection.setRemoteDescription(answer);
      await flushPendingIceCandidates();
      addLog("Received and applied answer.");
    },
    [addLog, flushPendingIceCandidates],
  );

  const handleIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      if (peerConnectionRef.current?.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(candidate);
        addLog("Added remote ICE candidate.");
        return;
      }

      pendingIceCandidatesRef.current.push(candidate);
      addLog("Queued remote ICE candidate until remote description is ready.");
    },
    [addLog],
  );

  const handleMessage = useCallback(
    async (message: SignalMessage) => {
      switch (message.type) {
        case "joined":
          setStatus("joined");
          addLog(`Joined room "${message.roomId}" as test sender.`);
          addLog("Waiting for a viewer peer before creating an offer.");
          break;
        case "peer-joined":
          addLog(`Peer joined room: ${message.clientId}${message.role ? ` (${message.role})` : ""}.`);
          await createAndSendOffer(message.roomId);
          break;
        case "peer-left":
          addLog(`Peer left room: ${message.clientId}.`);
          break;
        case "answer":
          await handleAnswer(message.payload);
          break;
        case "ice-candidate":
          await handleIceCandidate(message.payload);
          break;
        case "error":
          setStatus("error");
          addLog(`Signaling error: ${message.message}`);
          break;
        default:
          break;
      }
    },
    [addLog, createAndSendOffer, handleAnswer, handleIceCandidate],
  );

  const joinRoom = useCallback(
    async (targetRoomId = roomId.trim()) => {
      if (!targetRoomId) {
        setStatus("error");
        addLog("Room ID is required.");
        return;
      }

      disconnect();

      try {
        await getLocalStream();
      } catch (error) {
        setStatus("error");
        addLog(error instanceof Error ? `Unable to open webcam: ${error.message}` : "Unable to open webcam.");
        return;
      }

      setStatus("connecting");
      setActiveRoomId(targetRoomId);
      addLog(`Connecting to signaling server at ${signalingUrl}.`);

      const socket = new WebSocket(signalingUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", roomId: targetRoomId, role: "sender" }));
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
    [addLog, cleanupPeerConnection, disconnect, getLocalStream, handleMessage, roomId],
  );

  const reconnect = useCallback(() => {
    const targetRoomId = activeRoomId || roomId.trim();
    addLog("Reconnecting sender.");
    void joinRoom(targetRoomId);
  }, [activeRoomId, addLog, joinRoom, roomId]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      cleanupPeerConnection();
      stopLocalStream();
    };
  }, [cleanupPeerConnection, stopLocalStream]);

  const isJoined =
    status === "joined" || status === "requesting-media" || status === "sending-offer" || status === "connected";

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
          <button onClick={() => void joinRoom()} disabled={isJoined || status === "connecting"}>
            Join
          </button>
          <button onClick={disconnect} disabled={status === "idle" || status === "disconnected"}>
            Disconnect
          </button>
          <button onClick={reconnect} disabled={!activeRoomId && !roomId.trim()}>
            Reconnect
          </button>
        </div>

        <StatusRow status={status} />
        <ConnectionDetails />

        <div className="video-frame">
          <video ref={previewVideoRef} autoPlay playsInline muted />
          {!localStreamRef.current && <div className="video-placeholder">Local webcam preview</div>}
        </div>
      </section>

      <LogPanel title="Sender ICE / Signaling Log" logs={logs} />
    </main>
  );
}

function StatusRow({ status }: { status: ConnectionStatus }) {
  return (
    <div className="status-row">
      <span className={`status-dot status-${status}`} />
      <span>Connection status: {status}</span>
    </div>
  );
}

function ConnectionDetails() {
  return (
    <dl className="connection-details">
      <div>
        <dt>Signaling URL</dt>
        <dd>{signalingUrl}</dd>
      </div>
      <div>
        <dt>Page URL</dt>
        <dd>{currentPageUrl}</dd>
      </div>
    </dl>
  );
}

function LogPanel({ title, logs }: { title: string; logs: string[] }) {
  return (
    <section className="log-panel">
      <h1>{title}</h1>
      <div className="log-list" aria-live="polite">
        {logs.length === 0 ? <p>No signaling activity yet.</p> : logs.map((log) => <p key={log}>{log}</p>)}
      </div>
    </section>
  );
}

export default App;
