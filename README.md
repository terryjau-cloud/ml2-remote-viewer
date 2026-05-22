# ml2-remote-viewer

WebRTC remote viewer prototype for receiving video from a future Magic Leap 2 Unity sender.

This first phase includes:

- React + Vite + TypeScript frontend viewer
- Node.js `ws` signaling server
- WebRTC receiver prototype using `RTCPeerConnection`

Out of scope for this phase:

- Unity sender
- TURN server
- Database
- Login/auth
- Deployment
- Docker

## Project Structure

```text
frontend/
signaling-server/
docs/
README.md
AGENTS.md
```

## Install

Install dependencies independently for the frontend and signaling server:

```bash
cd frontend
npm install

cd ../signaling-server
npm install
```

## Frontend Development

```bash
cd frontend
npm run dev
```

By default Vite serves the viewer at:

```text
http://localhost:5173
```

Copy `frontend/.env.example` to `frontend/.env` if you need to change the signaling URL.

## Signaling Server Startup

```bash
cd signaling-server
npm run dev
```

By default the signaling server listens on:

```text
ws://localhost:8080
```

Copy `signaling-server/.env.example` to `signaling-server/.env` if you need to change the port or host.

## Local Testing Flow

1. Start the signaling server:

   ```bash
   cd signaling-server
   npm run dev
   ```

2. Start the frontend viewer:

   ```bash
   cd frontend
   npm run dev
   ```

3. Open `http://localhost:5173`.
4. Enter a room ID, for example `dev-room`.
5. Click **Join**.
6. Use a separate WebRTC sender or browser test client later to send an offer into the same room.
7. Watch the ICE / signaling log area for room join, offer, answer, and ICE candidate activity.
8. Use **Disconnect** to close the viewer connection.
9. Use **Reconnect** to leave and rejoin the same room.

## Scripts

Frontend:

```bash
cd frontend
npm run dev
npm run build
npm run lint
```

Signaling server:

```bash
cd signaling-server
npm run dev
npm run build
npm run lint
```

## Future TODO

- Magic Leap 2 Unity sender
- RenderTexture streaming
- Mixed Reality Capture
- TURN server
- Multi-viewer support
- HTTPS deployment
