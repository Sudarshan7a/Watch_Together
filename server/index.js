import express from "express";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, "../client");

app.use(express.static(clientDir));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

const rooms = {};
const HOST_RECONNECT_GRACE_MS = 30000;
const ROOM_CODE_PATTERN = /^[A-Z0-9]+-[0-9]{4}$/;

function normalizeRoomCode(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);
}

function createRoom() {
  return {
    members: new Map(),
    hostGraceTimer: null,
  };
}

function getSocketLabel(socket, fallback = "someone") {
  return (
    socket.displayName ||
    socket.handshake.auth?.name?.trim() ||
    socket.memberId ||
    fallback
  );
}

function getActiveSocketIds(roomCode, exceptSocketId = "") {
  const room = rooms[roomCode];
  if (!room) return [];

  return Array.from(room.members.values())
    .map((member) => member.socketId)
    .filter(
      (socketId) =>
        socketId &&
        socketId !== exceptSocketId &&
        io.sockets.sockets.has(socketId),
    );
}

function getHostMember(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;
  return (
    Array.from(room.members.values()).find(
      (member) => member.role === "host",
    ) || null
  );
}

function endRoom(roomCode, reason = "ended") {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  io.to(roomCode).emit("room-ended");

  getActiveSocketIds(roomCode).forEach((id) => {
    const client = io.sockets.sockets.get(id);
    if (client) {
      client.leave(roomCode);
      client.roomCode = null;
      client.role = null;
      client.memberId = null;
    }
  });

  delete rooms[roomCode];
  console.log(`room ${roomCode} ${reason}`);
}

function removeSocketFromRoom(socket, intentional = false) {
  const roomCode = socket.roomCode;
  const room = rooms[roomCode];
  if (!room) return;

  const member = room.members.get(socket.memberId);
  if (!member || member.socketId !== socket.id) return;

  if (member.role === "host") {
    if (intentional) {
      endRoom(roomCode, "ended by host");
      return;
    }

    member.socketId = null;
    socket.to(roomCode).emit("host-reconnecting");
    room.hostGraceTimer = setTimeout(() => {
      endRoom(roomCode, "ended - host did not reconnect");
    }, HOST_RECONNECT_GRACE_MS);
    return;
  }

  room.members.delete(socket.memberId);
  socket.to(roomCode).emit("user-left", { socketId: socket.id });

  if (room.members.size === 0) {
    if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
    delete rooms[roomCode];
    console.log(`room ${roomCode} deleted - empty`);
  }
}

io.on("connection", (socket) => {
  socket.displayName = socket.handshake.auth?.name?.trim() || "";
  console.log(`${getSocketLabel(socket, socket.id)} connected: ${socket.id}`);

  socket.on("join-room", ({ roomCode, role, memberId, name }) => {
    roomCode = normalizeRoomCode(roomCode);

    if (!roomCode || (role !== "host" && role !== "viewer") || !memberId) {
      socket.emit("room-unavailable");
      return;
    }

    if (!ROOM_CODE_PATTERN.test(roomCode)) {
      socket.emit("room-unavailable");
      return;
    }

    if (!rooms[roomCode] && role === "viewer") {
      socket.emit("room-unavailable");
      return;
    }

    if (!rooms[roomCode]) {
      rooms[roomCode] = createRoom();
    }

    const room = rooms[roomCode];
    const existingMember = room.members.get(memberId);
    const hostMember = getHostMember(roomCode);

    if (role === "host" && hostMember && hostMember.memberId !== memberId) {
      socket.emit("room-full");
      return;
    }

    if (!existingMember && room.members.size >= 6) {
      socket.emit("room-full");
      return;
    }

    if (room.hostGraceTimer && role === "host") {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
      socket.to(roomCode).emit("host-reconnected");
    }

    const displayName =
      String(name || socket.displayName || memberId).trim() || memberId;
    socket.displayName = displayName;

    socket.roomCode = roomCode;
    socket.role = role;
    socket.memberId = memberId;

    const previousSocketId = existingMember?.socketId || "";
    const isReconnect = !!existingMember;
    room.members.set(memberId, {
      memberId,
      socketId: socket.id,
      role,
      displayName,
    });
    socket.join(roomCode);

    console.log(
      `${displayName} joined room ${roomCode} as ${role} - total: ${room.members.size}`,
    );

    if (!isReconnect || previousSocketId !== socket.id) {
      socket.to(roomCode).emit("user-joined", {
        socketId: socket.id,
        role,
      });
    }

    socket.emit("room-users", {
      users: getActiveSocketIds(roomCode, socket.id),
    });
  });

  socket.on("signal", ({ to, signal }) => {
    io.to(to).emit("signal", {
      from: socket.id,
      signal,
    });
  });

  socket.on("end-room", () => {
    const roomCode = socket.roomCode;

    if (!roomCode || !rooms[roomCode] || socket.role !== "host") {
      return;
    }

    endRoom(roomCode, "ended by host");
    socket.roomCode = null;
    socket.role = null;
    socket.memberId = null;
  });

  socket.on("leave-room", () => {
    const roomCode = socket.roomCode;
    removeSocketFromRoom(socket, socket.role === "host");
    if (roomCode) socket.leave(roomCode);
    socket.roomCode = null;
    socket.role = null;
    socket.memberId = null;
  });

  socket.on("disconnect", () => {
    removeSocketFromRoom(socket, false);
    console.log(
      `${getSocketLabel(socket, socket.id)} disconnected: ${socket.id}`,
    );
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // ── Keep-alive self-ping (Render free tier spins down after inactivity) ──
  // Render sets RENDER_EXTERNAL_URL automatically. We ping our own /health
  // endpoint every 30 s so the service never goes idle during a live session.
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    const pingUrl = `${renderUrl}/health`;
    console.log(`Keep-alive enabled: pinging ${pingUrl} every 30 s`);
    setInterval(() => {
      try {
        const mod = pingUrl.startsWith("https") ? https : http;
        const req = mod.get(pingUrl, (res) => {
          // Drain the response so the socket is freed
          res.resume();
        });
        req.on("error", (err) => {
          console.warn("Keep-alive ping failed:", err.message);
        });
      } catch (err) {
        console.warn("Failed to initiate keep-alive ping:", err.message);
      }
    }, 30_000);
  }
});
