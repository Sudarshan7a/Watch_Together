import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import cors from "cors";

// ─── App Setup ───────────────────────────────────────────────
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

// ─── Health Check ─────────────────────────────────────────────
// Render.com pings this URL to keep your server awake
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

// ─── Room State ───────────────────────────────────────────────
// This object tracks who is in which room
// Structure: { "MANGO-7291": ["socketId1", "socketId2"] }
const rooms = {};

// ─── Socket Events ────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("someone connected:", socket.id);

  // ── Event 1: join-room ──────────────────────────────────────
  // Fires when a user creates or joins a room
  // Data received: { roomCode: "MANGO-7291", role: "host" or "viewer" }
  socket.on("join-room", ({ roomCode, role }) => {
    // Attach room info to this socket for later use
    socket.roomCode = roomCode;
    socket.role = role;

    // Create the room array if it doesn't exist yet
    if (!rooms[roomCode]) {
      rooms[roomCode] = [];
    }

    // Limit: 1 host + 5 viewers max
    if (rooms[roomCode].length >= 6) {
      socket.emit("room-full");
      return;
    }

    // Add this socket to the room
    rooms[roomCode].push(socket.id);

    // Join the Socket.io room (lets us broadcast to everyone in it)
    socket.join(roomCode);

    console.log(
      `${role} joined room ${roomCode} — total: ${rooms[roomCode].length}`,
    );

    // Tell everyone already in the room that a new person joined
    // socket.to() sends to everyone EXCEPT the sender
    socket.to(roomCode).emit("user-joined", {
      socketId: socket.id,
      role: role,
    });

    // Send back the current list of people in the room
    // The new joiner needs to know who is already there
    // so they can initiate connections with them
    socket.emit("room-users", {
      users: rooms[roomCode].filter((id) => id !== socket.id),
    });
  });

  // ── Event 2: signal ─────────────────────────────────────────
  // Fires when a browser wants to send WebRTC handshake data
  // to a specific other browser
  // Data received: { to: "socketId", signal: { ...webrtc data } }
  socket.on("signal", ({ to, signal }) => {
    // Forward the signal to the correct person
    // We include "from" so the receiver knows who sent it
    io.to(to).emit("signal", {
      from: socket.id,
      signal: signal,
    });
  });

  // ── Event 3: end-room ───────────────────────────────────────
  // Host ends the room for everyone
  socket.on("end-room", () => {
    const roomCode = socket.roomCode;

    if (!roomCode || !rooms[roomCode] || socket.role !== "host") {
      return;
    }

    io.to(roomCode).emit("room-ended");

    rooms[roomCode].forEach((id) => {
      const client = io.sockets.sockets.get(id);
      if (client) {
        client.leave(roomCode);
        client.roomCode = null;
      }
    });

    delete rooms[roomCode];
    socket.roomCode = null;
    console.log(`room ${roomCode} ended by host`);
  });

  // ── Event 4: disconnect ──────────────────────────────────────
  // Fires automatically when someone closes the tab or loses connection
  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;

    if (roomCode && rooms[roomCode] && socket.role === "host") {
      io.to(roomCode).emit("room-ended");

      rooms[roomCode].forEach((id) => {
        const client = io.sockets.sockets.get(id);
        if (client) {
          client.leave(roomCode);
          client.roomCode = null;
        }
      });

      delete rooms[roomCode];
      console.log(`room ${roomCode} ended — host disconnected`);
      console.log("someone disconnected:", socket.id);
      return;
    }

    if (roomCode && rooms[roomCode]) {
      // Remove this socket from the room array
      rooms[roomCode] = rooms[roomCode].filter((id) => id !== socket.id);

      // Tell everyone remaining in the room that this person left
      socket.to(roomCode).emit("user-left", {
        socketId: socket.id,
      });

      // Clean up empty rooms so memory doesn't leak
      if (rooms[roomCode].length === 0) {
        delete rooms[roomCode];
        console.log(`room ${roomCode} deleted — empty`);
      }
    }

    console.log("someone disconnected:", socket.id);
  });
});

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
