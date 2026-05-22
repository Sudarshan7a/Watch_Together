// ─── DOM refs ────────────────────────────────────────────────
const screens        = Array.from(document.querySelectorAll("[data-screen]"));
const nameInput      = document.getElementById("nameInput");
const roomCodeInput  = document.getElementById("roomCodeInput");
const generatedRoomCode = document.getElementById("generatedRoomCode");
const hostStage      = document.getElementById("hostStage");
const hostRoomChip   = document.getElementById("hostRoomChip");
const viewerRoomChip = document.getElementById("viewerRoomChip");
const userAvatarHost   = document.getElementById("userAvatarHost");
const userAvatarViewer = document.getElementById("userAvatarViewer");
const viewerCountChip  = document.getElementById("viewerCountChip");
const hostVideo      = document.getElementById("hostVideo");
const viewerVideo    = document.getElementById("viewerVideo");
const shareScreenBtn = document.getElementById("shareScreenBtn");
const stopSharingBtn = document.getElementById("stopSharingBtn");
const hostPlaceholder   = document.getElementById("hostPlaceholder");
const viewerPlaceholder = document.getElementById("viewerPlaceholder");
const body = document.body;

// ─── Socket ───────────────────────────────────────────────────
const socketUrl = window.location.protocol === "file:"
  ? "http://localhost:3000"
  : window.location.origin;
const socket = window.io
  ? window.io(socketUrl, { transports: ["websocket"] })
  : null;

// ─── State ────────────────────────────────────────────────────
const state = {
  roomCode: "",
  micMuted: true,   // mic off by default
  viewerAudioMuted: false,
  sharing: false,
  socketConnected: false,
  displayName: "",
  pendingAction: null,
};

let localStream = null;
let micStream   = null;
const peerConnections = {};
const dataChannels    = {};

function syncMicButtonUI(button) {
  if (!button) return;
  button.setAttribute("aria-pressed", String(state.micMuted));
  button.querySelector(".icon-mic-on")?.classList.toggle("hidden", state.micMuted);
  button.querySelector(".icon-mic-off")?.classList.toggle("hidden", !state.micMuted);
}

// ─── Room ID generation ───────────────────────────────────────
const ADJECTIVES = [
  "COZY","WARM","CALM","SOFT","DARK","BOLD","COOL","DEEP",
  "HAZY","LAZY","WILD","EPIC","PURE","VAST","KEEN","LUSH",
  "MIST","NOVA","OPAL","PINE","ROSY","SAGE","TEAL","ZEAL"
];
const NOUNS = [
  "FILM","REEL","LENS","DUSK","GLOW","HAZE","MOON","STAR",
  "WAVE","COVE","PEAK","VALE","MIST","REEF","ISLE","FERN",
  "LARK","MOTH","PUMA","QUAY","RIFT","SILO","TIDE","VEIL"
];

function cryptoRandInt(max) {
  const arr = new Uint32Array(1);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  return arr[0] % max;
}

function randomRoomCode() {
  const adj  = ADJECTIVES[cryptoRandInt(ADJECTIVES.length)];
  const noun = NOUNS[cryptoRandInt(NOUNS.length)];
  const num  = String(cryptoRandInt(9000) + 1000); // 1000–9999
  return `${adj}${noun}-${num}`;
}

function normalizeCode(value) {
  // Accept WORDWORD-1234 or WORD-1234 style, strip spaces
  return value.toUpperCase().replace(/[^A-Z0-9\-]/g, "").slice(0, 16);
}

// ─── Avatar helpers ───────────────────────────────────────────
function getInitial(name) {
  const t = (name || "").trim();
  return t ? t[0].toUpperCase() : "?";
}

function updateAvatars() {
  const initial = getInitial(state.displayName);
  [userAvatarHost, userAvatarViewer].forEach((el) => {
    if (el) {
      el.textContent = initial;
      el.setAttribute("aria-label", `Avatar for ${state.displayName}`);
    }
  });
}

// ─── Display name ─────────────────────────────────────────────
function setDisplayName(name) {
  const trimmed = name.trim();
  state.displayName = trimmed;
  if (trimmed) {
    window.localStorage?.setItem("watchtogether-name", trimmed);
  } else {
    window.localStorage?.removeItem("watchtogether-name");
  }
  updateAvatars();
}

function ensureDisplayName(nextAction) {
  if (state.displayName) return true;
  state.pendingAction = nextAction;
  setScreen("name");
  if (nameInput) { nameInput.value = ""; nameInput.focus(); }
  return false;
}

function continuePendingAction() {
  const action = state.pendingAction;
  state.pendingAction = null;
  if (action === "open-create") {
    syncRoomCode(randomRoomCode());
    setScreen("create");
  } else if (action === "go-host") {
    emitJoinRoom("host");
    setScreen("host");
  } else if (action === "join-room") {
    const code = normalizeCode(roomCodeInput?.value.trim() || "") || state.roomCode;
    syncRoomCode(code);
    emitJoinRoom("viewer");
    setScreen("viewer");
  }
}

function saveNameAndContinue() {
  if (!nameInput) return;
  const value = nameInput.value.trim();
  if (!value) { nameInput.focus(); return; }
  setDisplayName(value);
  continuePendingAction();
}

// ─── Room code sync ───────────────────────────────────────────
function syncRoomCode(code) {
  state.roomCode = code;
  if (generatedRoomCode) generatedRoomCode.textContent = code;
  if (hostRoomChip)   hostRoomChip.textContent   = `ROOM: ${code}`;
  if (viewerRoomChip) viewerRoomChip.textContent  = `ROOM: ${code}`;
}

// ─── Screen routing ───────────────────────────────────────────
function setScreen(name) {
  screens.forEach((s) => s.classList.toggle("screen-active", s.dataset.screen === name));
  window.location.hash = name;
  body.className = `route-${name}`;

  // Update active nav link
  document.querySelectorAll(".nav-link").forEach((btn) => {
    const action = btn.dataset.action;
    const isActive =
      (name === "landing" && action === "go-home") ||
      (name === "join"    && action === "go-join");
    btn.classList.toggle("active", isActive);
  });
}

function getActiveScreen() {
  const route = window.location.hash.replace("#", "");
  return ["landing","name","join","create","host","viewer","ended","full"].includes(route)
    ? route : "landing";
}

// ─── Socket ───────────────────────────────────────────────────
function emitJoinRoom(role) {
  if (!socket) return;
  socket.emit("join-room", { roomCode: state.roomCode, role, name: state.displayName });
}

if (socket) {
  socket.on("connect", () => {
    state.socketConnected = true;
    body.dataset.socketConnected = "true";
  });
  socket.on("disconnect", () => {
    state.socketConnected = false;
    delete body.dataset.socketConnected;
  });
  socket.on("room-full",  () => setScreen("full"));
  socket.on("room-ended", () => { cleanupRoom(); setScreen("ended"); });

  socket.on("room-users", ({ users }) => {
    users.forEach((id) => createPeerConnection(id, false));
  });
  socket.on("user-joined", ({ socketId, role }) => {
    createPeerConnection(socketId, true);
    if (viewerCountChip) {
      const count = Object.keys(peerConnections).length;
      viewerCountChip.textContent = `${count} watching`;
    }
  });
  socket.on("user-left", ({ socketId }) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    delete dataChannels[socketId];
    document.getElementById("audio-" + socketId)?.remove();
    if (viewerCountChip) {
      const count = Object.keys(peerConnections).length;
      viewerCountChip.textContent = `${count} watching`;
    }
  });
  socket.on("signal", async ({ from, signal }) => {
    const pc = peerConnections[from];
    if (!pc) return;
    if (signal.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, signal: pc.localDescription });
    } else if (signal.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal));
    }
  });
}

// ─── WebRTC ───────────────────────────────────────────────────
function createPeerConnection(userId, isInitiator) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  peerConnections[userId] = pc;

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("signal", { to: userId, signal: candidate });
  };

  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  if (micStream)   micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

  pc.ontrack = ({ track, streams }) => {
    if (track.kind === "audio") {
      let el = document.getElementById("audio-" + userId);
      if (!el) {
        el = document.createElement("audio");
        el.id = "audio-" + userId;
        el.autoplay = true;
        document.body.appendChild(el);
      }
      el.muted = state.viewerAudioMuted;
      el.srcObject = new MediaStream([track]);
    }
    if (track.kind === "video" && viewerVideo) {
      viewerVideo.srcObject = streams[0];
      viewerVideo.classList.remove("hidden");
      if (viewerPlaceholder) viewerPlaceholder.style.display = "none";
      streams[0].getTracks().forEach((t) => {
        t.onended = resetViewerStage;
        t.onmute  = resetViewerStage;
      });
    }
  };

  function setupDataChannel(channel) {
    channel.onmessage = ({ data }) => {
      const payload = JSON.parse(data);
      const feedId  = getActiveScreen() === "host" ? "chatFeedHost" : "chatFeedViewer";
      const feed    = document.getElementById(feedId);
      if (feed) addMessage(feed, payload.user, payload.message, "other", payload.time || Date.now());
    };
  }

  if (isInitiator) {
    const dc = pc.createDataChannel("chat");
    dataChannels[userId] = dc;
    setupDataChannel(dc);
  } else {
    pc.ondatachannel = ({ channel }) => {
      dataChannels[userId] = channel;
      setupDataChannel(channel);
    };
  }

  pc.onnegotiationneeded = async () => {
    try {
      await pc.setLocalDescription(await pc.createOffer());
      socket.emit("signal", { to: userId, signal: pc.localDescription });
    } catch (err) { console.error(err); }
  };

  if (isInitiator) {
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => socket.emit("signal", { to: userId, signal: pc.localDescription }));
  }

  return pc;
}

function resetViewerStage() {
  if (viewerVideo) { viewerVideo.srcObject = null; viewerVideo.classList.add("hidden"); }
  if (viewerPlaceholder) viewerPlaceholder.style.display = "";
}

function cleanupRoom() {
  localStream?.getTracks().forEach((t) => t.stop()); localStream = null;
  micStream?.getTracks().forEach((t) => t.stop());   micStream   = null;

  Object.entries(peerConnections).forEach(([id, pc]) => {
    try { pc.onicecandidate = null; pc.ontrack = null; pc.onnegotiationneeded = null; pc.close(); }
    catch (e) { /* ignore */ }
    delete peerConnections[id];
  });
  Object.keys(dataChannels).forEach((id) => delete dataChannels[id]);
  document.querySelectorAll('audio[id^="audio-"]').forEach((el) => el.remove());

  if (hostVideo)   { hostVideo.srcObject = null;   hostVideo.classList.add("hidden"); }
  if (viewerVideo) { viewerVideo.srcObject = null; viewerVideo.classList.add("hidden"); }
  if (hostPlaceholder)   hostPlaceholder.style.display   = "";
  if (viewerPlaceholder) viewerPlaceholder.style.display = "";

  // Reset share buttons
  if (shareScreenBtn) shareScreenBtn.classList.remove("hidden");
  if (stopSharingBtn) stopSharingBtn.classList.add("hidden");

  state.sharing = false;
  state.micMuted = false;
  state.viewerAudioMuted = false;
}

// ─── Screen sharing ───────────────────────────────────────────
function toggleHostShare() {
  if (state.sharing) {
    state.sharing = false;
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    if (hostVideo) { hostVideo.srcObject = null; hostVideo.classList.add("hidden"); }
    if (hostPlaceholder) hostPlaceholder.style.display = "";
    if (shareScreenBtn) shareScreenBtn.classList.remove("hidden");
    if (stopSharingBtn) stopSharingBtn.classList.add("hidden");
  } else {
    navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080, frameRate: 30 }, audio: true })
      .then((stream) => {
        localStream = stream;
        if (hostVideo) { hostVideo.srcObject = stream; hostVideo.classList.remove("hidden"); }
        if (hostPlaceholder) hostPlaceholder.style.display = "none";
        if (shareScreenBtn) shareScreenBtn.classList.add("hidden");
        if (stopSharingBtn) stopSharingBtn.classList.remove("hidden");

        Object.values(peerConnections).forEach((pc) => {
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        });

        state.sharing = true;
        stream.getVideoTracks()[0].onended = () => { if (state.sharing) toggleHostShare(); };
      })
      .catch((err) => console.error("Screen share failed:", err));
  }
}

// ─── Mic ──────────────────────────────────────────────────────
async function toggleMic(button) {
  state.micMuted = !state.micMuted;
  if (!state.micMuted && !micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      Object.values(peerConnections).forEach((pc) => {
        micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));
      });
    } catch (err) {
      console.error("Mic failed:", err);
      state.micMuted = true;
    }
  }
  if (micStream) micStream.getAudioTracks().forEach((t) => { t.enabled = !state.micMuted; });
  syncMicButtonUI(button);
}

// ─── Viewer audio ─────────────────────────────────────────────
function toggleViewerAudio(button) {
  state.viewerAudioMuted = !state.viewerAudioMuted;
  document.querySelectorAll('audio[id^="audio-"]').forEach((el) => { el.muted = state.viewerAudioMuted; });
  if (viewerVideo) viewerVideo.muted = state.viewerAudioMuted;
  button.querySelector(".icon-unmute")?.classList.toggle("hidden", state.viewerAudioMuted);
  button.querySelector(".icon-muted")?.classList.toggle("hidden", !state.viewerAudioMuted);
  const label = button.querySelector(".audio-label");
  if (label) label.textContent = state.viewerAudioMuted ? "Unmute" : "Mute";
}

// ─── Chat messages — Discord-style grouped ───────────────────
function syncFullscreenButtons() {
  const el = document.fullscreenElement;
  document.querySelectorAll('[data-action="toggle-fullscreen"]').forEach((btn) => {
    const targetSel = btn.getAttribute("data-fullscreen-target") || "";
    const target = targetSel ? document.querySelector(targetSel) : null;
    const active = !!(el && target && (el === target));
    btn.setAttribute("aria-pressed", String(active));
    btn.querySelector(".icon-fs-enter")?.classList.toggle("hidden", active);
    btn.querySelector(".icon-fs-exit")?.classList.toggle("hidden", !active);
  });
}

async function toggleFullscreen(button) {
  const targetSel = button?.getAttribute("data-fullscreen-target") || "";
  const target = targetSel ? document.querySelector(targetSel) : null;
  if (!target) return;

  if (document.fullscreenElement) {
    await document.exitFullscreen?.();
  } else {
    await target.requestFullscreen?.();
  }
  syncFullscreenButtons();
}

const messageTemplate = document.getElementById("messageTemplate");

// Per-feed last sender tracking so host + viewer feeds are independent
const feedLastSender = new WeakMap();

function addMessage(feed, label, message, kind = "other", timestamp = Date.now()) {
  const prevSender = feedLastSender.get(feed) || null;
  const isContinuation = prevSender === label;

  // Update last sender for this feed
  feedLastSender.set(feed, label);

  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  const avatarEl = node.querySelector(".msg-avatar");
  const metaEl   = node.querySelector(".message-meta");
  const pEl      = node.querySelector("p");

  if (kind === "self") node.classList.add("message-self");

  if (isContinuation) {
    // ── Continuation message: no avatar, no name/time header ──
    node.classList.add("msg-continued");
    // Hide avatar — replace with blank spacer so text stays aligned
    if (avatarEl) {
      avatarEl.style.visibility = "hidden";
    }
    // Remove meta header entirely
    const headerEl = node.querySelector(".message-header");
    if (headerEl) headerEl.remove();
  } else {
    // ── First message in a group: show avatar + name + time ──
    node.classList.add("msg-first");
    const initial = getInitial(label === "You" ? state.displayName : label);
    if (avatarEl) {
      avatarEl.textContent = initial;
    }

    const timeEl = document.createElement("span");
    timeEl.className = "message-time";
    timeEl.textContent = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    metaEl.textContent = label;
    metaEl.after(timeEl);
  }

  pEl.textContent = message;
  feed.appendChild(node);
  feed.scrollTop = feed.scrollHeight;
}

// ─── Event delegation ─────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  switch (action) {
    case "open-create":
      if (!ensureDisplayName("open-create")) return;
      syncRoomCode(randomRoomCode());
      setScreen("create");
      break;

    case "go-join":
      setScreen("join");
      roomCodeInput?.focus();
      break;

    case "go-host":
      if (!ensureDisplayName("go-host")) return;
      emitJoinRoom("host");
      setScreen("host");
      break;

    case "join-room": {
      if (!ensureDisplayName("join-room")) return;
      const code = normalizeCode(roomCodeInput?.value.trim() || "") || state.roomCode;
      syncRoomCode(code);
      emitJoinRoom("viewer");
      setScreen("viewer");
      break;
    }

    case "copy-code":
      await navigator.clipboard?.writeText(state.roomCode);
      button.textContent = "Copied!";
      setTimeout(() => {
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 5h10v10H5z" /></svg>Copy code';
      }, 1400);
      break;

    case "save-name":
      saveNameAndContinue();
      break;

    case "share-screen":
      toggleHostShare();
      break;

    case "stop-sharing":
      if (state.sharing) toggleHostShare();
      break;

    case "toggle-mic":
      toggleMic(button);
      break;

    case "end-room":
      if (socket) socket.emit("end-room");
      cleanupRoom();
      setScreen("ended");
      break;

    case "leave-room":
      cleanupRoom();
      setScreen("landing");
      break;

    case "toggle-viewer-audio":
      toggleViewerAudio(button);
      break;

    case "toggle-fullscreen":
      toggleFullscreen(button);
      break;

    case "go-home":
      cleanupRoom();
      setScreen("landing");
      break;
  }
});

// ─── Chat form submit ─────────────────────────────────────────
document.querySelectorAll("[data-chat-form]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector('input[name="message"]');
    const feed  = form.previousElementSibling;
    const text  = input.value.trim();
    if (!text) return;

    const payload = { user: state.displayName || "Guest", message: text, time: Date.now() };

    Object.values(dataChannels).forEach((dc) => {
      if (dc.readyState === "open") dc.send(JSON.stringify(payload));
    });

    addMessage(feed, "You", text, "self", payload.time);
    input.value = "";
  });
});

// ─── Name form submit ─────────────────────────────────────────
document.querySelectorAll("[data-name-form]").forEach((form) => {
  form.addEventListener("submit", (e) => { e.preventDefault(); saveNameAndContinue(); });
});

// ─── Room code input normalizer ───────────────────────────────
roomCodeInput?.addEventListener("input", () => {
  roomCodeInput.value = normalizeCode(roomCodeInput.value);
});

// ─── Hash routing ─────────────────────────────────────────────
window.addEventListener("hashchange", () => setScreen(getActiveScreen()));
document.addEventListener("fullscreenchange", syncFullscreenButtons);

// ─── Init ─────────────────────────────────────────────────────
const savedName = window.localStorage?.getItem("watchtogether-name");
if (savedName) {
  setDisplayName(savedName);
  if (nameInput) nameInput.value = savedName;
}

syncRoomCode(randomRoomCode());
syncMicButtonUI(document.querySelector('[data-action="toggle-mic"]'));
syncFullscreenButtons();
setScreen(getActiveScreen());
