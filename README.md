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
ml2-remote-viewer/
├─ frontend/
├─ signaling-server/
├─ docs/
└─ README.md
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

By default Vite serves the viewer on all local network interfaces:

```text
http://localhost:5173
http://<YOUR_LAN_IP>:5173
```

Copy `frontend/.env.example` to `frontend/.env` if you need to change the signaling URL.

## Signaling Server Startup

```bash
cd signaling-server
npm run dev
```

By default the signaling server listens on:

```text
ws://0.0.0.0:8080
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

## Browser-to-Browser Local Test Flow

Use this flow before the Magic Leap 2 Unity sender exists.

1. Start the signaling server:

   ```bash
   cd signaling-server
   npm run dev
   ```

2. Start the frontend:

   ```bash
   cd frontend
   npm run dev
   ```

3. Open the viewer page in one browser tab:

   ```text
   http://localhost:5173/
   ```

4. Enter a room ID, for example `dev-room`, then click **Join**.
5. Open the test sender page in another browser tab:

   ```text
   http://localhost:5173/#sender
   ```

6. Enter the same room ID, then click **Join**.
7. Allow webcam permission when the browser asks.
8. Confirm that the sender tab shows the local webcam preview.
9. Confirm that the viewer tab shows the sender webcam stream.
10. Check both ICE / signaling log areas for offer, answer, and ICE candidate activity.

## LAN Testing Flow

Use this flow when another computer on the same local network needs to open the viewer or test sender.

1. Find the LAN IP address of the machine running this repository.

   Windows PowerShell:

   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 |
     Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
     Select-Object IPAddress, InterfaceAlias
   ```

   Windows `ipconfig`:

   ```cmd
   ipconfig
   ```

   Look for the active Wi-Fi or Ethernet adapter IPv4 address, for example `192.168.1.20`.

2. Configure the frontend signaling URL.

   Create `frontend/.env`:

   ```env
   VITE_SIGNALING_URL=ws://<YOUR_LAN_IP>:8080
   ```

   Example:

   ```env
   VITE_SIGNALING_URL=ws://192.168.1.20:8080
   ```

3. Start the signaling server so it listens on all interfaces:

   ```bash
   cd signaling-server
   npm run dev
   ```

   The server uses `HOST=0.0.0.0` and `PORT=8080` by default. You can override them in `signaling-server/.env`.

4. Start the frontend Vite dev server with LAN access:

   ```bash
   cd frontend
   npm run dev
   ```

   Equivalent explicit command:

   ```bash
   npm run dev -- --host 0.0.0.0
   ```

5. On another computer in the same LAN, open:

   ```text
   http://<YOUR_LAN_IP>:5173/
   ```

6. For the browser sender test page, open:

   ```text
   http://<YOUR_LAN_IP>:5173/#sender
   ```

7. Confirm the UI shows:

   ```text
   Signaling URL: ws://<YOUR_LAN_IP>:8080
   ```

8. Use the same Room ID on the viewer and sender pages.

If another computer cannot connect, check the host machine firewall and allow inbound TCP connections for ports `5173` and `8080`.

## Scripts

Frontend:

```bash
cd frontend
npm run dev
npm run dev:lan
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
