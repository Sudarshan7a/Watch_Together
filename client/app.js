// ─── DOM refs ────────────────────────────────────────────────
const screens = Array.from(document.querySelectorAll("[data-screen]"));
const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const generatedRoomCode = document.getElementById("generatedRoomCode");
const hostStage = document.getElementById("hostStage");
const hostRoomChip = document.getElementById("hostRoomChip");
const viewerRoomChip = document.getElementById("viewerRoomChip");
const userAvatarHost = document.getElementById("userAvatarHost");
const userAvatarViewer = document.getElementById("userAvatarViewer");
const viewerCountChip = document.getElementById("viewerCountChip");
const hostVideo = document.getElementById("hostVideo");
const viewerVideo = document.getElementById("viewerVideo");
const shareScreenBtn = document.getElementById("shareScreenBtn");
const stopSharingBtn = document.getElementById("stopSharingBtn");
const hostPlaceholder = document.getElementById("hostPlaceholder");
const viewerPlaceholder = document.getElementById("viewerPlaceholder");
const roomCodeError = document.getElementById("roomCodeError");
const connectionOverlay = document.getElementById("connectionOverlay");
const connectionTitle = document.getElementById("connectionTitle");
const connectionCopy = document.getElementById("connectionCopy");
const viewerStatusChip = document.getElementById("viewerStatusChip");
const whatsappShareBtn = document.getElementById("whatsappShareBtn");
const qualityLabel = document.getElementById("qualityLabel");
const qualityMenu = document.getElementById("qualityMenu");
const qualityPicker = document.getElementById("qualityPicker");
const body = document.body;

// ─── Socket ───────────────────────────────────────────────────
const socketUrl =
  window.location.protocol === "file:"
    ? "http://localhost:3000"
    : window.location.origin;
const socket = window.io
  ? window.io(socketUrl, { transports: ["websocket"] })
  : null;

// ─── State ────────────────────────────────────────────────────
const state = {
  roomCode: "",
  micMuted: true, // mic off by default
  viewerAudioMuted: false,
  sharing: false,
  socketConnected: false,
  displayName: "",
  pendingAction: null,
  role: "",
  memberId: "",
  joinedRoom: false,
  quality: { label: "Source", width: 0, height: 0, fps: 0 },
};

let localStream = null;
let micStream = null;
let micAudioContext = null;
let micAnalyser = null;
let micSourceNode = null;
let micMonitorFrame = null;
let micMonitorToken = 0;
const peerConnections = {};
const dataChannels = {};
const ROOM_SESSION_KEY = "watchtogether-room-session";
const MEMBER_ID_KEY = "watchtogether-member-id";
const ROOM_COOKIE_NAME = "watchtogether_room";

function getCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return (
    document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) || ""
  );
}

function setCookie(name, value, maxAgeSeconds) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function getMemberId() {
  let id =
    window.localStorage?.getItem(MEMBER_ID_KEY) ||
    getCookie("watchtogether_member");
  if (!id) {
    id =
      window.crypto?.randomUUID?.() ||
      `member-${Date.now()}-${cryptoRandInt(1000000)}`;
  }
  window.localStorage?.setItem(MEMBER_ID_KEY, id);
  setCookie("watchtogether_member", id, 60 * 60 * 24 * 365);
  return id;
}

function readSavedRoomSession() {
  const raw =
    window.localStorage?.getItem(ROOM_SESSION_KEY) ||
    getCookie(ROOM_COOKIE_NAME);
  if (!raw) return null;

  try {
    const session = JSON.parse(decodeURIComponent(raw));
    const roomCode = normalizeCode(session.roomCode || "");
    const role =
      session.role === "host"
        ? "host"
        : session.role === "viewer"
          ? "viewer"
          : "";
    if (!roomCode || !role) return null;
    return { roomCode, role, memberId: session.memberId || getMemberId() };
  } catch (err) {
    return null;
  }
}

function saveRoomSession(role) {
  if (!state.roomCode || !role) return;
  const session = { roomCode: state.roomCode, role, memberId: state.memberId };
  const raw = JSON.stringify(session);
  window.localStorage?.setItem(ROOM_SESSION_KEY, raw);
  setCookie(ROOM_COOKIE_NAME, raw, 60 * 60 * 24 * 14);
  state.role = role;
  state.joinedRoom = true;
}

function clearRoomSession() {
  window.localStorage?.removeItem(ROOM_SESSION_KEY);
  setCookie(ROOM_COOKIE_NAME, "", 0);
  state.role = "";
  state.joinedRoom = false;
}

function showConnectionOverlay(
  title = "Reconnecting",
  copy = "Keeping your room open while the connection comes back.",
) {
  if (!connectionOverlay) return;
  if (connectionTitle) connectionTitle.textContent = title;
  if (connectionCopy) connectionCopy.textContent = copy;
  connectionOverlay.classList.remove("hidden");
}

function hideConnectionOverlay() {
  connectionOverlay?.classList.add("hidden");
}

function shouldRebuildPeerConnection(pc) {
  if (!pc) return true;
  return [pc.connectionState, pc.iceConnectionState].some((state) =>
    ["failed", "disconnected", "closed"].includes(state),
  );
}

function destroyPeerConnection(userId) {
  const pc = peerConnections[userId];
  if (!pc) return;

  try {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.ondatachannel = null;
    pc.onnegotiationneeded = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
  } catch (err) {
    /* ignore */
  }

  delete peerConnections[userId];
  delete dataChannels[userId];
  document.getElementById("audio-" + userId)?.remove();
}

function rebuildPeerConnection(userId, notifyPeer = false) {
  destroyPeerConnection(userId);
  createPeerConnection(userId, state.role === "host");

  if (notifyPeer && socket?.connected) {
    socket.emit("signal", { to: userId, signal: { type: "reconnect-peer" } });
  }
}

function setRoomCodeError(message = "") {
  roomCodeError?.classList.toggle("hidden", !message);
  if (roomCodeError) roomCodeError.textContent = message;
  document
    .querySelector(".code-field")
    ?.classList.toggle("has-error", !!message);
}

function validateRoomCodeForJoin(code) {
  if (!code) return "Enter a room code first.";
  if (!/^[A-Z0-9]+-[0-9]{4}$/.test(code)) {
    return "Use the full room code, like COZYMOON-4821.";
  }
  return "";
}

function setViewerWaitingForHost(isWaiting) {
  if (viewerStatusChip) {
    viewerStatusChip.textContent = isWaiting
      ? "Host reconnecting"
      : "Watching live";
  }

  if (!viewerPlaceholder || viewerVideo?.srcObject) return;
  const text = viewerPlaceholder.querySelector("p");
  if (text) {
    text.textContent = isWaiting
      ? "Host is reconnecting..."
      : "Waiting for host to share screen...";
  }
}

function syncMicButtonUI() {
  Array.from(document.querySelectorAll('[data-action="toggle-mic"]')).forEach(
    (btn) => {
      btn.setAttribute("aria-pressed", String(!state.micMuted));
      btn
        .querySelector(".icon-mic-on")
        ?.classList.toggle("hidden", state.micMuted);
      btn
        .querySelector(".icon-mic-off")
        ?.classList.toggle("hidden", !state.micMuted);
      btn.classList.toggle("mic-active", !state.micMuted);
      if (state.micMuted) btn.classList.remove("mic-speaking");
    },
  );
}

function setMicSpeakingUI(isSpeaking) {
  document.querySelectorAll('[data-action="toggle-mic"]').forEach((btn) => {
    btn.classList.toggle("mic-speaking", !state.micMuted && isSpeaking);
  });
}

function stopMicMonitor() {
  micMonitorToken += 1;
  if (micMonitorFrame) cancelAnimationFrame(micMonitorFrame);
  micMonitorFrame = null;
  setMicSpeakingUI(false);

  try {
    micSourceNode?.disconnect();
  } catch (err) {
    /* ignore */
  }
  try {
    micAnalyser?.disconnect();
  } catch (err) {
    /* ignore */
  }
  micSourceNode = null;
  micAnalyser = null;

  if (micAudioContext && micAudioContext.state !== "closed") {
    micAudioContext.close().catch(() => {});
  }
  micAudioContext = null;
}

function readMicLevel(token) {
  if (token !== micMonitorToken) return;
  if (
    !micAnalyser ||
    state.micMuted ||
    !micStream?.getAudioTracks().some((track) => track.enabled)
  ) {
    setMicSpeakingUI(false);
    micMonitorFrame = requestAnimationFrame(() => readMicLevel(token));
    return;
  }

  const data = new Uint8Array(micAnalyser.fftSize);
  micAnalyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const sample = (data[index] - 128) / 128;
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / data.length);
  setMicSpeakingUI(rms > 0.03);
  micMonitorFrame = requestAnimationFrame(() => readMicLevel(token));
}

async function startMicMonitor() {
  stopMicMonitor();
  if (!micStream) return;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;

  micAudioContext = new AudioContextCtor();
  if (micAudioContext.state === "suspended") {
    try {
      await micAudioContext.resume();
    } catch (err) {
      /* ignore */
    }
  }

  const token = ++micMonitorToken;
  micSourceNode = micAudioContext.createMediaStreamSource(micStream);
  micAnalyser = micAudioContext.createAnalyser();
  micAnalyser.fftSize = 1024;
  micSourceNode.connect(micAnalyser);
  readMicLevel(token);
}

// ─── Room ID generation ───────────────────────────────────────
const ADJECTIVES = [
  "COZY",
  "WARM",
  "CALM",
  "SOFT",
  "DARK",
  "BOLD",
  "COOL",
  "DEEP",
  "HAZY",
  "LAZY",
  "WILD",
  "EPIC",
  "PURE",
  "VAST",
  "KEEN",
  "LUSH",
  "MIST",
  "NOVA",
  "OPAL",
  "PINE",
  "ROSY",
  "SAGE",
  "TEAL",
  "ZEAL",
];
const NOUNS = [
  "FILM",
  "REEL",
  "LENS",
  "DUSK",
  "GLOW",
  "HAZE",
  "MOON",
  "STAR",
  "WAVE",
  "COVE",
  "PEAK",
  "VALE",
  "MIST",
  "REEF",
  "ISLE",
  "FERN",
  "LARK",
  "MOTH",
  "PUMA",
  "QUAY",
  "RIFT",
  "SILO",
  "TIDE",
  "VEIL",
];

function cryptoRandInt(max) {
  const arr = new Uint32Array(1);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  return arr[0] % max;
}

function randomRoomCode() {
  const adj = ADJECTIVES[cryptoRandInt(ADJECTIVES.length)];
  const noun = NOUNS[cryptoRandInt(NOUNS.length)];
  const num = String(cryptoRandInt(9000) + 1000); // 1000–9999
  return `${adj}${noun}-${num}`;
}

function normalizeCode(value) {
  // Accept WORDWORD-1234 or WORD-1234 style, strip spaces
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\-]/g, "")
    .slice(0, 16);
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
  if (nameInput) {
    nameInput.value = "";
    nameInput.focus();
  }
  return false;
}

function continuePendingAction() {
  const action = state.pendingAction;
  state.pendingAction = null;
  if (action === "open-create") {
    clearRoomSession();
    syncRoomCode(randomRoomCode());
    setScreen("create");
  } else if (action === "go-host") {
    joinCurrentRoom("host");
    setScreen("host");
  } else if (action === "join-room") {
    const code =
      normalizeCode(roomCodeInput?.value.trim() || "") || state.roomCode;
    const error = validateRoomCodeForJoin(code);
    if (error) {
      setRoomCodeError(error);
      roomCodeInput?.focus();
      return;
    }
    setRoomCodeError();
    syncRoomCode(code);
    joinCurrentRoom("viewer");
    setScreen("viewer");
  }
}

function saveNameAndContinue() {
  if (!nameInput) return;
  const value = nameInput.value.trim();
  if (!value) {
    nameInput.focus();
    return;
  }
  setDisplayName(value);
  continuePendingAction();
}

// ─── Room code sync ───────────────────────────────────────────
function syncRoomCode(code) {
  state.roomCode = code;
  if (generatedRoomCode) generatedRoomCode.textContent = code;
  if (hostRoomChip) hostRoomChip.textContent = `ROOM: ${code}`;
  if (viewerRoomChip) viewerRoomChip.textContent = `ROOM: ${code}`;
  updateWhatsAppLink();
}

// ─── Screen routing ───────────────────────────────────────────
function setScreen(name) {
  if ((name === "host" || name === "viewer") && !state.joinedRoom) {
    const savedSession = readSavedRoomSession();
    if (!savedSession || savedSession.role !== name) {
      name = name === "viewer" ? "join" : "landing";
    }
  }

  screens.forEach((s) =>
    s.classList.toggle("screen-active", s.dataset.screen === name),
  );
  window.location.hash = name;
  body.className = `route-${name}`;

  // Update active nav link
  document.querySelectorAll(".nav-link").forEach((btn) => {
    const action = btn.dataset.action;
    const isActive =
      (name === "landing" && action === "go-home") ||
      (name === "join" && action === "go-join");
    btn.classList.toggle("active", isActive);
  });
}

function getActiveScreen() {
  const route = window.location.hash.replace("#", "");
  return [
    "landing",
    "name",
    "join",
    "create",
    "host",
    "viewer",
    "ended",
    "full",
  ].includes(route)
    ? route
    : "landing";
}

// ─── Socket ───────────────────────────────────────────────────
function emitJoinRoom(role) {
  if (!socket) return;
  socket.emit("join-room", {
    roomCode: state.roomCode,
    role,
    name: state.displayName,
    memberId: state.memberId,
  });
}

function joinCurrentRoom(role) {
  saveRoomSession(role);
  emitJoinRoom(role);
}

function restoreSavedRoomIfNeeded() {
  const route = getActiveScreen();
  if (route !== "host" && route !== "viewer") return false;

  const savedSession = readSavedRoomSession();
  if (!savedSession || savedSession.role !== route) {
    clearRoomSession();
    setScreen(route === "viewer" ? "join" : "landing");
    return false;
  }

  state.memberId = savedSession.memberId;
  syncRoomCode(savedSession.roomCode);
  saveRoomSession(savedSession.role);
  if (socket?.connected) {
    emitJoinRoom(savedSession.role);
  } else {
    showConnectionOverlay();
  }
  setScreen(savedSession.role);
  return true;
}

if (socket) {
  socket.on("connect", () => {
    state.socketConnected = true;
    body.dataset.socketConnected = "true";
    hideConnectionOverlay();
    restoreSavedRoomIfNeeded();
  });
  socket.on("disconnect", () => {
    state.socketConnected = false;
    delete body.dataset.socketConnected;
    if (state.joinedRoom) showConnectionOverlay();
  });
  socket.on("room-full", () => {
    cleanupRoom();
    clearRoomSession();
    setScreen("full");
  });
  socket.on("room-ended", () => {
    hideConnectionOverlay();
    cleanupRoom();
    clearRoomSession();
    setScreen("ended");
  });
  socket.on("room-unavailable", () => {
    hideConnectionOverlay();
    cleanupRoom();
    clearRoomSession();
    setScreen("ended");
  });
  socket.on("host-reconnecting", () => {
    if (getActiveScreen() === "viewer") {
      setViewerWaitingForHost(true);
      showConnectionOverlay(
        "Host reconnecting",
        "The room will stay open for a short moment.",
      );
    }
  });
  socket.on("host-reconnected", () => {
    setViewerWaitingForHost(false);
    hideConnectionOverlay();
  });

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
    destroyPeerConnection(socketId);
    if (viewerCountChip) {
      const count = Object.keys(peerConnections).length;
      viewerCountChip.textContent = `${count} watching`;
    }
  });
  socket.on("signal", async ({ from, signal }) => {
    const pc = peerConnections[from];
    if (signal?.type === "reconnect-peer") {
      if (!shouldRebuildPeerConnection(pc)) return;
      rebuildPeerConnection(from, false);
      return;
    }
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

  if (localStream)
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  if (micStream)
    micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

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
        t.onmute = resetViewerStage;
      });
    }
  };

  const handleConnectionDrop = () => {
    if (peerConnections[userId] !== pc) return;
    if (!shouldRebuildPeerConnection(pc)) return;
    rebuildPeerConnection(userId, true);
  };

  pc.onconnectionstatechange = handleConnectionDrop;
  pc.oniceconnectionstatechange = handleConnectionDrop;

  function setupDataChannel(channel) {
    channel.onmessage = ({ data }) => {
      const payload = JSON.parse(data);
      const feedId =
        getActiveScreen() === "host" ? "chatFeedHost" : "chatFeedViewer";
      const feed = document.getElementById(feedId);
      if (feed)
        addMessage(
          feed,
          payload.user,
          payload.message,
          "other",
          payload.time || Date.now(),
        );
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
    } catch (err) {
      console.error(err);
    }
  };

  if (isInitiator) {
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() =>
        socket.emit("signal", { to: userId, signal: pc.localDescription }),
      );
  }

  return pc;
}

function resetViewerStage() {
  if (viewerVideo) {
    viewerVideo.srcObject = null;
    viewerVideo.classList.add("hidden");
  }
  if (viewerPlaceholder) viewerPlaceholder.style.display = "";
}

function cleanupRoom() {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  stopMicMonitor();

  Object.keys(peerConnections).forEach((id) => destroyPeerConnection(id));

  if (hostVideo) {
    hostVideo.srcObject = null;
    hostVideo.classList.add("hidden");
  }
  if (viewerVideo) {
    viewerVideo.srcObject = null;
    viewerVideo.classList.add("hidden");
  }
  if (hostPlaceholder) hostPlaceholder.style.display = "";
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
    if (hostVideo) {
      hostVideo.srcObject = null;
      hostVideo.classList.add("hidden");
    }
    if (hostPlaceholder) hostPlaceholder.style.display = "";
    if (shareScreenBtn) shareScreenBtn.classList.remove("hidden");
    if (stopSharingBtn) stopSharingBtn.classList.add("hidden");
    if (qualityLabel) qualityLabel.textContent = state.quality.label;
  } else {
    navigator.mediaDevices
      .getDisplayMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        localStream = stream;
        if (hostVideo) {
          hostVideo.srcObject = stream;
          hostVideo.classList.remove("hidden");
        }
        if (hostPlaceholder) hostPlaceholder.style.display = "none";
        if (shareScreenBtn) shareScreenBtn.classList.add("hidden");
        if (stopSharingBtn) stopSharingBtn.classList.remove("hidden");

        Object.values(peerConnections).forEach((pc) => {
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        });

        if (state.quality.width && state.quality.height && state.quality.fps) {
          applyCurrentStreamQuality().catch((err) =>
            console.warn("Quality apply failed:", err),
          );
        }

        state.sharing = true;
        stream.getVideoTracks()[0].onended = () => {
          if (state.sharing) toggleHostShare();
        };
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
  if (micStream)
    micStream.getAudioTracks().forEach((t) => {
      t.enabled = !state.micMuted;
    });
  if (state.micMuted) {
    stopMicMonitor();
  } else if (micStream) {
    await startMicMonitor();
  }
  syncMicButtonUI();
}

async function applyCurrentStreamQuality() {
  if (
    !localStream ||
    !state.quality.width ||
    !state.quality.height ||
    !state.quality.fps
  )
    return;

  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack?.applyConstraints) return;

  await videoTrack.applyConstraints({
    width: { ideal: state.quality.width },
    height: { ideal: state.quality.height },
    frameRate: { ideal: state.quality.fps },
  });
}

// ─── Quality picker ───────────────────────────────────────────
function openQualityMenu() {
  if (!qualityMenu) return;
  positionQualityMenu();
  qualityMenu.classList.remove("hidden");
  qualityPicker
    ?.querySelector('[data-action="open-quality"]')
    ?.setAttribute("aria-expanded", "true");
}

function closeQualityMenu() {
  if (!qualityMenu) return;
  qualityMenu.classList.add("hidden");
  qualityMenu.style.top = "";
  qualityMenu.style.bottom = "";
  qualityMenu.style.left = "";
  qualityMenu.style.right = "";
  qualityMenu.style.maxHeight = "";
  qualityMenu.style.maxWidth = "";
  qualityPicker
    ?.querySelector('[data-action="open-quality"]')
    ?.setAttribute("aria-expanded", "false");
}

function positionQualityMenu() {
  if (!qualityMenu || !qualityPicker) return;

  const trigger =
    qualityPicker.querySelector('[data-action="open-quality"]') ||
    qualityPicker;
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceAbove = rect.top;
  const spaceBelow = viewportHeight - rect.bottom;
  const openUp = spaceAbove >= spaceBelow;
  const availableSpace = Math.max(0, (openUp ? spaceAbove : spaceBelow) - 12);

  qualityMenu.style.top = openUp ? "auto" : "calc(100% + 8px)";
  qualityMenu.style.bottom = openUp ? "calc(100% + 8px)" : "auto";
  qualityMenu.style.left = "0";
  qualityMenu.style.right = "auto";
  qualityMenu.style.maxHeight = `${availableSpace}px`;
  qualityMenu.style.maxWidth = `${Math.max(0, viewportWidth - 24)}px`;

  if (rect.right + 180 > viewportWidth) {
    qualityMenu.style.left = "auto";
    qualityMenu.style.right = "0";
  }
}

function setQuality(label, width, height, fps) {
  state.quality = { label, width, height, fps };
  if (qualityLabel) qualityLabel.textContent = label;
  // Update aria-selected on menu items
  qualityMenu?.querySelectorAll("[data-action='set-quality']").forEach((li) => {
    li.setAttribute(
      "aria-selected",
      li.dataset.quality === label ? "true" : "false",
    );
  });
  if (state.sharing && localStream) {
    applyCurrentStreamQuality().catch((err) =>
      console.warn("Quality apply failed:", err),
    );
  }
  closeQualityMenu();
}

// Close quality menu when clicking outside
document.addEventListener("click", (e) => {
  if (qualityPicker && !qualityPicker.contains(e.target)) {
    closeQualityMenu();
  }
});

// ─── Viewer audio ─────────────────────────────────────────────
function toggleViewerAudio(button) {
  state.viewerAudioMuted = !state.viewerAudioMuted;
  document.querySelectorAll('audio[id^="audio-"]').forEach((el) => {
    el.muted = state.viewerAudioMuted;
  });
  if (viewerVideo) viewerVideo.muted = state.viewerAudioMuted;
  button
    .querySelector(".icon-unmute")
    ?.classList.toggle("hidden", state.viewerAudioMuted);
  button
    .querySelector(".icon-muted")
    ?.classList.toggle("hidden", !state.viewerAudioMuted);
  const label = button.querySelector(".audio-label");
  if (label) label.textContent = state.viewerAudioMuted ? "Unmute" : "Mute";
}

// ─── Chat messages — Discord-style grouped ───────────────────
function syncFullscreenButtons() {
  const el = document.fullscreenElement;
  document
    .querySelectorAll('[data-action="toggle-fullscreen"]')
    .forEach((btn) => {
      const targetSel = btn.getAttribute("data-fullscreen-target") || "";
      const target = targetSel ? document.querySelector(targetSel) : null;
      const active = !!(el && target && el === target);
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

function showFsMinimize(stageEl) {
  if (!stageEl) return;
  if (!document.fullscreenElement) return;
  if (document.fullscreenElement !== stageEl) return;

  const btn = stageEl.querySelector(".fs-minimize");
  if (!btn) return;

  btn.classList.remove("hidden");
  clearTimeout(btn._hideTimer);
  btn._hideTimer = setTimeout(() => btn.classList.add("hidden"), 1800);
}

const messageTemplate = document.getElementById("messageTemplate");

// Per-feed last sender tracking so host + viewer feeds are independent
const feedLastSender = new WeakMap();

function addMessage(
  feed,
  label,
  message,
  kind = "other",
  timestamp = Date.now(),
) {
  const prevSender = feedLastSender.get(feed) || null;
  const isContinuation = prevSender === label;

  // Update last sender for this feed
  feedLastSender.set(feed, label);

  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  const avatarEl = node.querySelector(".msg-avatar");
  const metaEl = node.querySelector(".message-meta");
  const pEl = node.querySelector("p");

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
    timeEl.textContent = new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    metaEl.textContent = label;
    metaEl.after(timeEl);
  }

  pEl.textContent = message;
  feed.appendChild(node);
  feed.scrollTop = feed.scrollHeight;
}

// ─── WhatsApp share ───────────────────────────────────────────
function updateWhatsAppLink() {
  if (!whatsappShareBtn) return;
  const text = `Join my private WatchTogether room! Code: ${state.roomCode} — ${window.location.origin}`;
  whatsappShareBtn.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// ─── Event delegation ─────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  switch (action) {
    case "open-create":
      if (!ensureDisplayName("open-create")) return;
      clearRoomSession();
      syncRoomCode(randomRoomCode());
      setScreen("create");
      break;

    case "go-join":
      setRoomCodeError();
      setScreen("join");
      roomCodeInput?.focus();
      break;

    case "go-host":
      if (!ensureDisplayName("go-host")) return;
      joinCurrentRoom("host");
      setScreen("host");
      break;

    case "join-room": {
      if (!ensureDisplayName("join-room")) return;
      const code =
        normalizeCode(roomCodeInput?.value.trim() || "") || state.roomCode;
      const error = validateRoomCodeForJoin(code);
      if (error) {
        setRoomCodeError(error);
        roomCodeInput?.focus();
        return;
      }
      setRoomCodeError();
      syncRoomCode(code);
      joinCurrentRoom("viewer");
      setScreen("viewer");
      break;
    }

    case "copy-code":
      await navigator.clipboard?.writeText(state.roomCode);
      button.textContent = "Copied!";
      setTimeout(() => {
        button.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 5h10v10H5z" /></svg>Copy code';
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
      clearRoomSession();
      setScreen("ended");
      break;

    case "leave-room":
      if (socket) socket.emit("leave-room");
      cleanupRoom();
      clearRoomSession();
      setScreen("landing");
      break;

    case "toggle-viewer-audio":
      toggleViewerAudio(button);
      break;

    case "toggle-fullscreen":
      toggleFullscreen(button);
      break;

    case "exit-fullscreen":
      await document.exitFullscreen?.();
      syncFullscreenButtons();
      document
        .querySelectorAll(".fs-minimize")
        .forEach((b) => b.classList.add("hidden"));
      break;

    case "go-home":
      if (state.joinedRoom && socket) socket.emit("leave-room");
      cleanupRoom();
      clearRoomSession();
      setScreen("landing");
      break;

    case "open-quality":
      qualityMenu?.classList.contains("hidden")
        ? openQualityMenu()
        : closeQualityMenu();
      break;

    case "set-quality": {
      const { quality, width, height, fps } = button.dataset;
      setQuality(quality, Number(width), Number(height), Number(fps));
      break;
    }
  }
});

document.querySelectorAll(".video-stage").forEach((stage) => {
  stage.addEventListener("click", () => showFsMinimize(stage));
  stage.querySelectorAll(".fs-minimize").forEach((btn) => {
    btn.addEventListener("click", (e) => e.stopPropagation());
  });
});

// ─── Chat form submit ─────────────────────────────────────────
document.querySelectorAll("[data-chat-form]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector('input[name="message"]');
    const feed = form.previousElementSibling;
    const text = input.value.trim();
    if (!text) return;

    const payload = {
      user: state.displayName || "Guest",
      message: text,
      time: Date.now(),
    };

    Object.values(dataChannels).forEach((dc) => {
      if (dc.readyState === "open") dc.send(JSON.stringify(payload));
    });

    addMessage(feed, "You", text, "self", payload.time);
    input.value = "";
  });
});

// ─── Name form submit ─────────────────────────────────────────
document.querySelectorAll("[data-name-form]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveNameAndContinue();
  });
});

// ─── Room code input normalizer ───────────────────────────────
roomCodeInput?.addEventListener("input", () => {
  roomCodeInput.value = normalizeCode(roomCodeInput.value);
  if (roomCodeInput.value) setRoomCodeError();
});

// ─── Hash routing ─────────────────────────────────────────────
window.addEventListener("hashchange", () => setScreen(getActiveScreen()));
document.addEventListener("fullscreenchange", syncFullscreenButtons);
window.addEventListener("resize", () => {
  if (!qualityMenu || qualityMenu.classList.contains("hidden")) return;
  positionQualityMenu();
});

// ─── Init ─────────────────────────────────────────────────────
const savedName = window.localStorage?.getItem("watchtogether-name");
if (savedName) {
  setDisplayName(savedName);
  if (nameInput) nameInput.value = savedName;
}

state.memberId = getMemberId();

const savedRoomSession = readSavedRoomSession();
if (savedRoomSession) {
  state.memberId = savedRoomSession.memberId;
  syncRoomCode(savedRoomSession.roomCode);
} else {
  syncRoomCode(randomRoomCode());
}

syncMicButtonUI();
if (qualityLabel) qualityLabel.textContent = state.quality.label;
syncFullscreenButtons();
if (!restoreSavedRoomIfNeeded()) {
  setScreen(getActiveScreen());
}
