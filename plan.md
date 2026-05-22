You're a fresher MERN stack dev. You know JavaScript, you've built stuff, but WebRTC is new territory. So this plan treats you like someone who knows JS but has never touched real-time networking. Every step is small enough that you won't get lost.

The Golden Rule Before We Start
Never move to the next step until the current one works and you understand why it works.
Not just copy-paste and it runs. Actually read it, break it on purpose, fix it. That's how you'll debug when something goes wrong at 2am.

Your Stack (already familiar to you)
Frontend → HTML + Vanilla JS (no React — keeps it simple)
Server → Node.js + Express + Socket.io (you know this)
Hosting → GitHub Pages (frontend) + Render (server)
Real-time → WebRTC (new, but you'll learn it step by step)
No database. No auth. No framework. Just clean JS.

Phase 0 — Understand Before You Touch Code
Time: 1 evening | Just reading, no coding
You need to understand 3 concepts. Not deeply — just enough to not be confused when you write the code.
Concept 1 — What is a socket?
Normal HTTP: you ask, server replies, connection closes.
Socket: connection stays open, both sides can talk anytime.
Think of it like a phone call vs sending a letter.
You already used this in MERN if you've ever used Socket.io for notifications. Same thing here.
Concept 2 — What is WebRTC in one sentence?
It's a browser feature that lets two browsers talk directly to each other — video, audio, data — without going through your server.
Concept 3 — The handshake (most important)
Before two browsers can talk directly, they need to find each other. That happens in 3 steps:
Step 1: Browser A creates an "offer"  
 (basically says "here's how to connect to me")

Step 2: Browser B receives it, creates an "answer"
(says "okay here's how to connect to me back")

Step 3: Both exchange "ICE candidates"
(their actual IP addresses and ports)

After this → direct connection, server is done
Your signaling server's only job is to pass these 3 messages. That's it.
End of Phase 0: You should be able to explain to a friend what a socket is and why you need a server just to start a WebRTC connection.

Phase 1 — Setup Your Machine
Time: 2-3 hours | Zero coding, just installation
Do these in order. Don't skip.
Step 1 — Check Node is installed
Open terminal (cmd or PowerShell on Windows, Terminal on Mac):
bashnode --version
npm --version
If you see version numbers — done. If not — go to nodejs.org, download LTS, install.
Step 2 — Install VS Code
code.visualstudio.com — download, install.
Install these extensions inside VS Code:

Prettier (formats your code automatically)
ESLint (catches errors)
Live Server (opens HTML files in browser with auto-refresh)

Step 3 — Create accounts

github.com (if you don't have one already)
render.com (sign up with GitHub — easier)

Step 4 — Create your project folder
watch-together/
server/
client/
Just two folders. Nothing else yet.
Open this folder in VS Code. This is your workspace for the entire project.
Step 5 — Initialize git
bashcd watch-together
git init
Checkpoint: VS Code is open, folder structure exists, git is initialized, both accounts created.

Phase 2 — Build the Signaling Server
Time: 1 day | ~50 lines of code
This is the easiest part. You've written Express servers before. This is just that, plus Socket.io.
Step 1 — Setup the server folder
bashcd server
npm init -y
npm install express socket.io cors
Step 2 — Create index.js
You'll write this file. It does exactly 4 things:

Creates an Express app
Attaches Socket.io to it
Listens for join-room event → adds user to a room
Listens for signal event → forwards it to the right person

I'll give you this complete file when we start coding. ~50 lines.
Step 3 — Run it locally
bashnode index.js
Terminal should say: Server running on port 3000
Step 4 — Test it
Open browser → go to localhost:3000/health
You should see: {"status":"ok"}
That means your server is alive.
Checkpoint: Server runs locally, /health returns ok, you understand what each line does.

Phase 3 — Build the Frontend, Piece by Piece
Time: 4-5 days | Broken into tiny steps
This is where most beginners fail — they try to build everything at once. You won't. You'll build one tiny thing, test it, then add the next.

Step 3.1 — Just the HTML shell
Half a day
Create client/index.html. No JS yet. Just the UI structure:

Home screen (create / join buttons)
Room screen (video area + chat panel)
Hidden by default (you'll show/hide with JS)

Use plain CSS. Don't touch WebRTC. Don't touch sockets.
Test: Open with Live Server extension. Page loads. Looks right. Buttons do nothing yet. That's fine.

Step 3.2 — Connect to your server with Socket.io
Half a day
Add Socket.io client script to your HTML. Write 10 lines of JS:
javascriptconst socket = io('http://localhost:3000')

socket.on('connect', () => {
console.log('Connected to server:', socket.id)
})
Test: Open browser console (F12). You should see:
Connected to server: xK92jdQ...
If you see that — your frontend and server are talking. Huge milestone.

Step 3.3 — Room creation and joining
Half a day
Write JS that:

Generates a random room code (like MANGO-7291) when you click Create
Sends join-room event to server with that code
Shows the room code on screen

Write JS that:

Takes the code from the join input
Sends join-room to server
Moves to the room screen

Test: Open two browser tabs. Create room in tab 1. Join in tab 2. Check server terminal — you should see both users joining the same room.

Step 3.4 — WebRTC connection between two tabs
1-2 days — the hardest step
This is where WebRTC comes in. You'll write:

The offer/answer exchange
ICE candidate sharing
All going through your signaling server

At the end of this step — the two tabs are connected. No video yet. Just the connection.
Test: Open browser console in both tabs. Both should print:
Peer connection established
Don't move on until you see this in both tabs.

Step 3.5 — Screen sharing
Half a day
One function:
javascriptconst stream = await navigator.mediaDevices.getDisplayMedia({
video: { width: 1920, height: 1080, frameRate: 30 },
audio: true
})
Add the stream tracks to the peer connection. Viewer's video element receives them.
Test: Tab 1 clicks Share Screen, picks a window. Tab 2's video element shows that window. If you can see it — this step is done.

Step 3.6 — Microphone audio
Half a day
javascriptconst micStream = await navigator.mediaDevices.getUserMedia({
audio: true
})
Mix mic with screen stream. Add a mute button.
Test: Speak into mic in tab 1. Tab 2 hears you (wear headphones to avoid feedback loop).

Step 3.7 — Chat
Half a day
WebRTC has something called a DataChannel — it lets you send text/data directly between browsers, just like the video/audio. You'll use this for chat.
javascriptconst dataChannel = peerConnection.createDataChannel('chat')

dataChannel.send(JSON.stringify({
user: 'Sudupa',
message: 'yo this works',
time: Date.now()
}))
Test: Type in tab 1 chat → appears in tab 2. Private, peer-to-peer, no server involved.

Step 3.8 — Multiple viewers (1-to-many)
1 day
Right now it works for 2 tabs. Now make it work for 5.
The change: when viewer 2 joins, the host creates a new peer connection specifically for viewer 2. Each viewer gets their own dedicated connection from the host.
host → peerConnection1 → viewer 1
host → peerConnection2 → viewer 2
host → peerConnection3 → viewer 3
Each connection is independent. Host sends the stream to all.
Test: Open 4 tabs. 1 host, 3 viewers. All 3 should see your screen. Chat works across all.

Phase 4 — Test on Real Networks
Time: 1 day
This is where you find out if it actually works outside your laptop.
Test 1 — Two tabs, same laptop
Already done in Phase 3. Should work.
Test 2 — Two devices, same WiFi
Your laptop + your phone. Open the site on both (use your laptop's local IP like 192.168.1.5:3000). Does it connect?
Test 3 — Different networks
You on your WiFi, friend on mobile data. This is the real test.
If it fails here — you need STUN. Add this one line:
javascriptconst peerConnection = new RTCPeerConnection({
iceServers: [
{ urls: 'stun:stun.l.google.com:19302' }
]
})
That's Google's free STUN server. Fixes 80% of cross-network issues.
If still failing for some friends — their router is very strict (happens with some Jio/BSNL connections). Then you need TURN. Use metered.ca free tier.

Phase 5 — Deploy
Time: half a day
Deploy server → Render.com
Push server/ folder to GitHub. Go to Render → New Web Service → connect repo → deploy.
You get a URL like:
https://watch-together-abc.onrender.com
Update your frontend to use this URL instead of localhost.
Deploy frontend → GitHub Pages
Push client/ folder to GitHub. Go to repo Settings → Pages → enable it.
Your app is live at:
https://yourusername.github.io/watch-together
Test: Send link to one friend. They open it on their phone. They join your room. You share your screen. They see it.
If that works — you shipped something real.

Phase 6 — Polish
Time: 2-3 days
Only after everything works:

Add viewer count badge
Add proper error messages (room full, connection lost)
Add reconnection logic if someone drops
Mobile responsive layout
Quality toggle (1080p / 720p / 480p)
Copy room code button

Full Timeline
DayWhat you do1Phase 0 — read and understand concepts2Phase 1 — install everything, setup3Phase 2 — build and run signaling server4Step 3.1 + 3.2 — HTML + socket connection5Step 3.3 — room creation and joining6-7Step 3.4 — WebRTC handshake (hardest part, take your time)8Step 3.5 — screen sharing9Step 3.6 + 3.7 — audio + chat10Step 3.8 — multiple viewers11Phase 4 — real network testing12Phase 5 — deploy13-15Phase 6 — polish

What Will Actually Be Hard
Be honest with yourself about these:
Step 3.4 — The WebRTC handshake is where most people get stuck. It involves async code, promises, and a very specific sequence of events. If something goes wrong, the console error messages are not beginner-friendly. Budget 2 days for just this step and don't rush it.
Cross-network testing — works on your machine but not across networks. This is a rite of passage. STUN fixes it almost always.
Audio feedback — if you test in two tabs on the same laptop without headphones, you'll hear yourself echoed back infinitely. Always test audio with headphones.

When you're ready to start, just say "let's start Phase 2" and I'll give you the complete server code line by line with explanation for every single line — nothing skipped.You said: let's start phase 2let's start phase 201:42Claude responded: Let's go.Let's go. Open VS Code, navigate to your server/ folder, and follow exactly in order.

Step 1 — Initialize the server folder
Open terminal in VS Code (Ctrl + backtick) and run these one by one:
bashcd server
npm init -y
npm install express socket.io cors
You should now see a node_modules/ folder and package.json in your server folder. That means dependencies installed correctly.

Step 2 — Create the server file
Create a new file inside server/ called index.js. Now copy this exactly:
javascriptconst express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')

// ─── App Setup ───────────────────────────────────────────────
const app = express()
app.use(cors())

const server = http.createServer(app)

const io = new Server(server, {
cors: {
origin: '\*',
methods: ['GET', 'POST']
}
})

// ─── Health Check ─────────────────────────────────────────────
// Render.com pings this URL to keep your server awake
app.get('/health', (req, res) => {
res.json({ status: 'ok' })
})

// ─── Room State ───────────────────────────────────────────────
// This object tracks who is in which room
// Structure: { "MANGO-7291": ["socketId1", "socketId2"] }
const rooms = {}

// ─── Socket Events ────────────────────────────────────────────
io.on('connection', (socket) => {
console.log('someone connected:', socket.id)

// ── Event 1: join-room ──────────────────────────────────────
// Fires when a user creates or joins a room
// Data received: { roomCode: "MANGO-7291", role: "host" or "viewer" }
socket.on('join-room', ({ roomCode, role }) => {

    // Attach room info to this socket for later use
    socket.roomCode = roomCode
    socket.role = role

    // Create the room array if it doesn't exist yet
    if (!rooms[roomCode]) {
      rooms[roomCode] = []
    }

    // Limit: 1 host + 5 viewers max
    if (rooms[roomCode].length >= 6) {
      socket.emit('room-full')
      return
    }

    // Add this socket to the room
    rooms[roomCode].push(socket.id)

    // Join the Socket.io room (lets us broadcast to everyone in it)
    socket.join(roomCode)

    console.log(`${role} joined room ${roomCode} — total: ${rooms[roomCode].length}`)

    // Tell everyone already in the room that a new person joined
    // socket.to() sends to everyone EXCEPT the sender
    socket.to(roomCode).emit('user-joined', {
      socketId: socket.id,
      role: role
    })

    // Send back the current list of people in the room
    // The new joiner needs to know who is already there
    // so they can initiate connections with them
    socket.emit('room-users', {
      users: rooms[roomCode].filter(id => id !== socket.id)
    })

})

// ── Event 2: signal ─────────────────────────────────────────
// Fires when a browser wants to send WebRTC handshake data
// to a specific other browser
// Data received: { to: "socketId", signal: { ...webrtc data } }
socket.on('signal', ({ to, signal }) => {

    // Forward the signal to the correct person
    // We include "from" so the receiver knows who sent it
    io.to(to).emit('signal', {
      from: socket.id,
      signal: signal
    })

})

// ── Event 3: disconnect ──────────────────────────────────────
// Fires automatically when someone closes the tab or loses connection
socket.on('disconnect', () => {
const roomCode = socket.roomCode

    if (roomCode && rooms[roomCode]) {
      // Remove this socket from the room array
      rooms[roomCode] = rooms[roomCode].filter(id => id !== socket.id)

      // Tell everyone remaining in the room that this person left
      socket.to(roomCode).emit('user-left', {
        socketId: socket.id
      })

      // Clean up empty rooms so memory doesn't leak
      if (rooms[roomCode].length === 0) {
        delete rooms[roomCode]
        console.log(`room ${roomCode} deleted — empty`)
      }
    }

    console.log('someone disconnected:', socket.id)

})
})

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
console.log(`Server running on port ${PORT}`)
})

Step 3 — Understand what you just wrote
Before running it, read this. Every single event explained:
join-room — fires when someone opens your app and creates or joins a room. Server adds them to the room list and tells everyone else "hey new person joined."
signal — this is the postman event. Browser A says "forward this message to browser B." Server doesn't care what's inside — just delivers it. That message contains WebRTC handshake data.
disconnect — fires automatically when tab closes. Server cleans up that person from the room and tells everyone else they left.
rooms object — just a plain JavaScript object living in memory. Key is room code, value is array of socket IDs. No database needed.

Step 4 — Add a start script
Open package.json and make sure the scripts section looks like this:
json"scripts": {
"start": "node index.js",
"dev": "nodemon index.js"
}
Then install nodemon so your server auto-restarts when you save changes:
bashnpm install --save-dev nodemon

Step 5 — Run it
bashnpm run dev
You should see:
Server running on port 3000
If you see an error — paste it here and I'll fix it immediately.

Step 6 — Test the health check
Open your browser and go to:
http://localhost:3000/health
You should see:
json{ "status": "ok" }

Step 7 — Test the socket connection
Open browser, press F12 to open DevTools, go to the Console tab and paste this:
javascriptconst socket = io('http://localhost:3000', {
transports: ['websocket']
})

socket.on('connect', () => {
console.log('✅ Connected! My socket ID is:', socket.id)
})
But wait — io isn't available in the browser console by default. So first open this URL in your browser:
http://localhost:3000/socket.io/socket.io.js
You should see a big JS file. That means Socket.io is serving its client script correctly.
Now a proper test — create a tiny test.html file anywhere on your computer:
html<!DOCTYPE html>

<html>
<head>
  <title>Socket Test</title>
</head>
<body>
  <h2>Check the browser console (F12)</h2>

  <script src="http://localhost:3000/socket.io/socket.io.js"></script>
  <script>
    const socket = io('http://localhost:3000')

    socket.on('connect', () => {
      console.log('✅ Connected to server! ID:', socket.id)

      // Test joining a room
      socket.emit('join-room', { 
        roomCode: 'TEST-1234', 
        role: 'host' 
      })
    })

    socket.on('room-users', (data) => {
      console.log('👥 Users already in room:', data.users)
    })

    socket.on('user-joined', (data) => {
      console.log('🙋 New user joined:', data)
    })

    socket.on('room-full', () => {
      console.log('🚫 Room is full!')
    })
  </script>
</body>
</html>
Open this file in two separate browser tabs.
Tab 1 console should show:
✅ Connected to server! ID: abc123...
👥 Users already in room: []
Tab 2 console should show:
✅ Connected to server! ID: xyz789...
👥 Users already in room: ["abc123..."]
Tab 1 console should then also show:
🙋 New user joined: { socketId: "xyz789...", role: "host" }
Your server terminal should show:
someone connected: abc123...
host joined room TEST-1234 — total: 1
someone connected: xyz789...
host joined room TEST-1234 — total: 2

Phase 2 Complete ✅
If you saw all of that — your signaling server works perfectly. Two browsers can find each other through it. That's the hardest conceptual part done.

What's next — Phase 3, Step 3.1:
We build the HTML shell. All the screens — home, room, join — just the visual structure with no functionality. Then Step 3.2 we wire up the socket connection you just tested.
Tell me when you see the test working and we'll move straight into the frontend.
