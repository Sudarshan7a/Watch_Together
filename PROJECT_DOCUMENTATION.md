# WatchTogether Project Documentation

## 1. Project Overview

WatchTogether is a private watch-party app that lets one host share a screen or video stream to a small room of viewers, with live chat and mic audio layered on top. It is built to feel like a premium mini cinema rather than a generic meeting tool.

The core problem it solves is simple, private shared viewing without account creation or heavy setup. A host can create a room, share a room code, and viewers can join instantly from a browser.

Target users are small groups of friends or couples who want a lightweight, private movie night experience, plus a host who wants to broadcast their screen with minimal friction.

## 2. Tech Stack

This project is intentionally small and browser-native. The main technologies in use are:

- HTML5: The app UI is defined in [client/index.html](client/index.html), including all landing, join, create, host, viewer, ended, and room-full screens.
- CSS3: Visual styling, responsive layout, and the full cinematic design system live in [client/styles.css](client/styles.css).
- Vanilla JavaScript: All client behavior is implemented in [client/app.js](client/app.js) without a frontend framework.
- Node.js: The signaling backend runs on Node in [server/index.js](server/index.js).
- Express: Used to serve the client static files and expose HTTP routes in [server/index.js](server/index.js).
- Socket.io: Used for room membership, signaling, and reconnect events between browsers and the server in [server/index.js](server/index.js) and [client/app.js](client/app.js).
- CORS: Enabled on the server via `cors` so the app can work across localhost, Render, and static hosting scenarios.
- WebRTC: Used for peer-to-peer video, audio, and data channels in [client/app.js](client/app.js).
- Web Audio API: Used for mic activity detection with `AudioContext` and `AnalyserNode` in [client/app.js](client/app.js).
- Web Share API: Used for native room sharing fallback in the `share-room` action in [client/app.js](client/app.js).
- Clipboard API: Used for copying room codes and fallback share text in [client/app.js](client/app.js).
- localStorage and cookies: Used for persistent room and member identity in [client/app.js](client/app.js).
- Google Fonts: `Inter`, `Newsreader`, and `JetBrains Mono` are loaded in [client/index.html](client/index.html).
- Mermaid: Used in [README.md](README.md) for architecture diagrams.

Why these choices make sense:

- Vanilla JS keeps the project simple and avoids framework overhead for a small realtime app.
- Socket.io is a good fit for signaling because the server only needs to forward messages before WebRTC takes over.
- WebRTC is required because the actual media and chat travel directly between browsers instead of through the server.
- Express is enough for static hosting and a health endpoint without adding unnecessary complexity.
- localStorage and cookies give the app reconnect behavior without introducing a database.

## 3. Architecture Overview

### Folder-by-folder structure

- [client/](client): The browser app.
  - [client/index.html](client/index.html): All screens and controls are declared here.
  - [client/styles.css](client/styles.css): The full presentation layer, including layout, typography, backgrounds, buttons, cards, and room-state styling.
  - [client/app.js](client/app.js): All client state, routing, Socket.io integration, WebRTC setup, room session persistence, chat, audio controls, and fullscreen handling.
- [server/](server): The signaling server.
  - [server/index.js](server/index.js): Express server, Socket.io server, static file serving, room lifecycle, signaling relay, and keep-alive logic.
  - [server/package.json](server/package.json): Server package metadata and dependencies.
  - [server/pnpm-lock.yaml](server/pnpm-lock.yaml): Locked dependency graph for the backend.
- [design/](design): Product and visual documentation.
  - [design/DESIGN.md](design/DESIGN.md): Style system and brand direction.
  - [design/watchtogether_project_prd_updated.md](design/watchtogether_project_prd_updated.md): Product requirements and feature intent.
  - The subfolders under `design/` contain screen-specific design variants and mockups.
- [README.md](README.md): High-level project description and setup notes.
- [plan.md](plan.md): A step-by-step implementation tutorial that explains the original build approach.
- [test.html](test.html): A lightweight browser test page for loading the Socket.io client script and validating the frontend bootstrap.
- [clinet/](clinet): Empty and unused; likely a typo directory.

### How data flows through the system

The app follows a simple browser-to-server-to-browser signaling model.

1. The client loads [client/index.html](client/index.html), which pulls in Socket.io and [client/app.js](client/app.js).
2. The client connects to the Socket.io server and emits `join-room` with `roomCode`, `role`, and `memberId`.
3. The server stores that membership in the in-memory `rooms` object in [server/index.js](server/index.js).
4. The server forwards `signal` payloads between peers so WebRTC can complete offer/answer and ICE exchange.
5. Once the WebRTC peer connections are established, video, audio, and chat messages travel peer-to-peer between browsers.
6. The server remains in the loop only for signaling, room lifecycle, and reconnect notifications.

### Real-time, async, and background processes

- WebRTC negotiation is asynchronous and handled in `createPeerConnection()` with a `negotiationLocks` guard to avoid overlapping offers.
- Mic monitoring runs continuously through `requestAnimationFrame` in `startMicMonitor()` and `readMicLevel()`.
- Host reconnect grace handling is asynchronous in [server/index.js](server/index.js) through `HOST_RECONNECT_GRACE_MS` and `room.hostGraceTimer`.
- Room keep-alive pings run in the server process when `RENDER_EXTERNAL_URL` is present, so the Render deployment does not spin down during active use.

## 4. Core Features

### Landing, create, and join flow

What it does: Presents a cinematic landing page, lets the user create a room, or lets them join with a room code.

Files that handle it: [client/index.html](client/index.html), [client/app.js](client/app.js), [client/styles.css](client/styles.css).

How it works under the hood:

- `setScreen()` switches between `landing`, `name`, `join`, `create`, `host`, `viewer`, `ended`, and `full` routes using `window.location.hash`.
- `ensureDisplayName()` forces the user to enter a name before room creation or joining.
- `randomRoomCode()` generates codes like `COZYMOON-4821` from the `ADJECTIVES` and `NOUNS` arrays.
- `normalizeCode()` and `validateRoomCodeForJoin()` sanitize and validate room input before socket join.

### Room creation and room code sharing

What it does: Generates a room code, shows it to the host, and lets the host copy or share it.

Files that handle it: [client/index.html](client/index.html), [client/app.js](client/app.js).

How it works under the hood:

- The `open-create` action clears any prior room session and calls `syncRoomCode(randomRoomCode())`.
- `copy-code` uses `navigator.clipboard.writeText()` and updates the UI copy label to `Copied!`.
- `share-room` uses `navigator.share()` when available and falls back to clipboard text otherwise.
- Room session identity is persisted with `saveRoomSession()` using both `localStorage` and a cookie.

### Host room and screen sharing

What it does: Lets the host enter the room, share their screen, stop sharing, and choose output quality.

Files that handle it: [client/index.html](client/index.html), [client/app.js](client/app.js).

How it works under the hood:

- `toggleHostShare()` calls `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
- The resulting tracks are attached to every active `RTCPeerConnection` in `peerConnections`.
- `applyCurrentStreamQuality()` applies constraints to the local video track based on `state.quality`.
- The quality menu is controlled by `openQualityMenu()`, `closeQualityMenu()`, `positionQualityMenu()`, and `setQuality()`.
- `syncFullscreenButtons()` and `toggleFullscreen()` control the host and viewer fullscreen controls.

### Viewer room and playback

What it does: Lets viewers join a room, receive the host stream, and mute or adjust playback volume locally.

Files that handle it: [client/index.html](client/index.html), [client/app.js](client/app.js).

How it works under the hood:

- `socket.on("room-users")` creates peer connections for already-present viewers.
- `socket.on("user-joined")` creates a peer connection for a newly joined peer.
- Incoming video tracks are attached to `viewerVideo.srcObject` in `pc.ontrack`.
- `resetViewerStage()` clears the viewer stage when the stream ends or mutes.
- `toggleViewerAudio()`, `applyViewerVolume()`, and `syncViewerAudioUI()` manage viewer-side mute and volume only; this does not affect the host.

### WebRTC signaling and peer connections

What it does: Establishes direct browser-to-browser media and data connections.

Files that handle it: [client/app.js](client/app.js), [server/index.js](server/index.js).

How it works under the hood:

- `createPeerConnection(userId, isInitiator)` constructs a `RTCPeerConnection` using the public STUN server `stun:stun.l.google.com:19302`.
- `pc.onicecandidate` relays ICE candidates back through `socket.emit("signal")`.
- `socket.on("signal")` handles `offer`, `answer`, ICE candidates, and reconnect signals.
- `negotiationLocks` and the local `negotiationPending` flag prevent offer collisions when screen-share and mic tracks are added together.
- `rebuildPeerConnection()` and `shouldRebuildPeerConnection()` recover from failed or disconnected peers.

### Chat

What it does: Provides live chat in both host and viewer layouts.

Files that handle it: [client/index.html](client/index.html), [client/app.js](client/app.js).

How it works under the hood:

- `createPeerConnection()` creates a WebRTC `RTCDataChannel` named `chat` for the initiator.
- The non-initiator attaches `pc.ondatachannel` and stores the incoming channel in `dataChannels`.
- Chat messages are serialized as JSON payloads with `user`, `message`, `time`, and `isHost` fields.
- The chat form handler broadcasts the message to every open data channel and then appends a local `You` message with `addMessage()`.
- `feedLastSender` is a `WeakMap` that groups repeated messages from the same sender so the feed looks threaded.

### Mic audio and speaking indicator

What it does: Lets the host enable microphone audio and shows when the host is speaking.

Files that handle it: [client/app.js](client/app.js), [client/index.html](client/index.html).

How it works under the hood:

- `toggleMic()` requests `getUserMedia({ audio: true })` on first use.
- The mic stream is attached to every peer connection via `pc.addTrack()`.
- `startMicMonitor()` creates an `AudioContext` and `AnalyserNode`.
- `readMicLevel()` computes RMS volume from the waveform and toggles `.mic-speaking` when the host is actively speaking.
- `stopMicMonitor()` tears down the analyzer, source node, and animation frame loop.

### Session recovery and reconnect handling

What it does: Restores users after refreshes or short disconnects.

Files that handle it: [client/app.js](client/app.js), [server/index.js](server/index.js).

How it works under the hood:

- `getMemberId()` creates a persistent member ID and stores it in `localStorage` and a cookie.
- `readSavedRoomSession()`, `saveRoomSession()`, and `clearRoomSession()` manage room state.
- `restoreSavedRoomIfNeeded()` re-emits `join-room` after the socket reconnects.
- On the server, `removeSocketFromRoom()` treats the host differently from viewers and gives the host a 30-second reconnect grace window.
- The server emits `host-reconnecting`, `host-reconnected`, `room-ended`, `room-full`, and `room-unavailable` to keep the UI in sync with reality.

### Room lifecycle and limits

What it does: Keeps the room bounded and cleans it up when it is empty or intentionally ended.

Files that handle it: [server/index.js](server/index.js).

How it works under the hood:

- `ROOM_CODE_PATTERN` enforces room format like `WORDWORD-1234`.
- The room limit is effectively 6 members total, enforced in `join-room`.
- `getHostMember()` identifies the single host record inside a room.
- `endRoom()` emits `room-ended`, disconnects active clients from the room, and deletes the room object.
- Empty rooms are deleted automatically when the last non-host member leaves.

## 5. Key Technical Decisions

- In-memory room state: The server uses `rooms = {}` instead of a database. That keeps the app simple, but rooms are ephemeral and disappear when the server restarts.
- Socket.io only for signaling: Media does not flow through the server. The server just forwards `join-room`, `signal`, `end-room`, and `leave-room` events.
- 1-to-many WebRTC topology: The host creates a separate `RTCPeerConnection` per viewer, which is why `peerConnections` is keyed by socket ID.
- Negotiation locking: `negotiationLocks` and `negotiationPending` exist to avoid the `m-lines`/simultaneous offer problem when multiple tracks are added during screen share.
- Per-track audio elements: `pc.ontrack` creates audio elements with IDs like `audio-${userId}-${track.id}` so mic audio and screen audio do not clobber each other.
- Grouped chat rendering: `addMessage()` uses a `WeakMap` to track the last sender per feed and collapse consecutive messages into a continuous block.
- Dual persistence for identity: Room membership and name are stored in both cookies and `localStorage` to improve resilience across refreshes and browser restarts.
- Keep-alive pinging on Render: The server pings its own `/health` endpoint using `RENDER_EXTERNAL_URL` so the free tier stays awake.

## 6. Database Schema

There is no database in this project.

Instead, the server keeps transient room state in memory:

- `rooms[roomCode]`: The top-level room map.
- `room.members`: A `Map` keyed by `memberId`.
- Member object shape: `{ memberId, socketId, role }`.
- `room.hostGraceTimer`: A timeout handle used to keep the room alive while the host reconnects.

Key field purposes:

- `roomCode`: The shared room identifier.
- `memberId`: The persistent browser identity used to reconnect across refreshes.
- `socketId`: The current live socket connection for that member.
- `role`: Either `host` or `viewer`.

Because there is no database, there are no tables, collections, foreign keys, migrations, or indexes.

## 7. API Endpoints

### HTTP endpoints

- `GET /`
  - Defined in [server/index.js](server/index.js).
  - Returns [client/index.html](client/index.html).
  - No auth requirements.
- `GET /health`
  - Defined in [server/index.js](server/index.js).
  - Returns JSON `{ status: "ok" }`.
  - Used by the Render keep-alive ping and manual health checks.
  - No auth requirements.

### Socket.io event contract

These are the realtime routes that actually power the app.

- `join-room`
  - Client payload: `{ roomCode, role, memberId }`
  - Server behavior: normalizes the code, validates role and memberId, creates or looks up the room, enforces the viewer cap, registers the member, joins the socket to the room, and emits `room-users` back to the joining client.
  - Auth: none.
- `signal`
  - Client payload: `{ to, signal }`
  - Server behavior: forwards `{ from: socket.id, signal }` to the target socket ID.
  - Auth: none.
- `end-room`
  - Client payload: none.
  - Server behavior: only accepted from the host; ends the room and clears client-side membership.
  - Auth: host-only by role.
- `leave-room`
  - Client payload: none.
  - Server behavior: removes the socket from the room, emits `user-left` for viewers, or starts the host reconnect grace window for hosts.
  - Auth: none.
- `disconnect`
  - Triggered automatically by Socket.io when the connection drops.
  - Server behavior: runs the same room-removal logic as a leave.

Server-to-client events:

- `room-users`: `{ users: string[] }`
- `user-joined`: `{ socketId, role }`
- `user-left`: `{ socketId }`
- `room-full`: no payload
- `room-ended`: no payload
- `room-unavailable`: no payload
- `host-reconnecting`: no payload
- `host-reconnected`: no payload
- `signal`: `{ from, signal }`

## 8. Hardest/Most Complex Parts

The most complex part is the WebRTC negotiation path in `createPeerConnection()`. The app has to handle the initial offer/answer exchange, late joiners, reconnects, and track changes when the host starts sharing or adds mic audio. The `negotiationLocks` and `negotiationPending` logic exist specifically to keep that sequence stable.

The next hardest part is reconnect behavior. The client tries to recover state from cookies and `localStorage`, while the server tracks host grace time with `HOST_RECONNECT_GRACE_MS`. That combination is what keeps a room from collapsing immediately when someone refreshes.

Another tricky part is media handling. The host can emit both screen audio and mic audio, so the client has to attach tracks carefully and avoid echo. That is why the code creates separate audio elements per track and skips screen-audio duplication in `pc.ontrack`.

## 9. What I’d Tell a New Developer

Start in [server/index.js](server/index.js) to understand the signaling lifecycle, then move to the top of [client/app.js](client/app.js) and read state, session, and socket setup before touching any UI handlers. After that, read `createPeerConnection()`, `toggleHostShare()`, and the `socket.on(...)` handlers in that order.

Do not change the room/session logic casually. `saveRoomSession()`, `readSavedRoomSession()`, `restoreSavedRoomIfNeeded()`, and the server-side `removeSocketFromRoom()` logic are tightly coupled.

Be careful around `createPeerConnection()`, especially the `negotiationLocks` section and the `pc.ontrack` handler. That is the most delicate part of the app, and small changes there can break viewer joins or cause broken renegotiation.

The tech debt and known rough edges are straightforward:

- There is no database, so all room state is ephemeral.
- There is no authentication, so the room code and `memberId` are the only access controls.
- The `clinet/` directory is empty and should probably be removed or renamed.
- The documentation/tutorial files ([plan.md](plan.md), [README.md](README.md), and the `design/` docs) describe the project heavily, but the actual runtime logic lives in [client/app.js](client/app.js) and [server/index.js](server/index.js).

If you want to go deeper next, read the following in order:

1. [server/index.js](server/index.js)
2. [client/app.js](client/app.js)
3. [client/index.html](client/index.html)
4. [client/styles.css](client/styles.css)
5. [design/watchtogether_project_prd_updated.md](design/watchtogether_project_prd_updated.md)
