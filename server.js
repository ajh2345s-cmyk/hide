const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const ADMIN_CODE = 'GMLTN';
const MAP = { width: 7600, height: 4800 };
const PHASE = { WAITING: 'waiting', HIDE: 'hide', SEEK: 'seek', RESULT: 'result' };

app.use(express.static(path.join(__dirname, 'public')));

const spawnPoints = [];
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 5; x++) spawnPoints.push([650 + x * 1450, 650 + y * 1150]);
}

function makeRoom(code) {
  return {
    code,
    hostId: null,
    phase: PHASE.WAITING,
    round: 0,
    players: new Map(),
    hiderIds: new Set(),
    seekerIds: new Set(),
    settings: {
      hideSeconds: 90,
      seekSeconds: 180,
      baseScanSeconds: 5,
      finalScanSeconds: 1,
      finalScanWindowSeconds: 30,
      scanRadius: 135,
      revealSeconds: 1.8,
    },
    timeLeft: 0,
    lastScanAt: 0,
    timer: null,
  };
}

const rooms = new Map();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const cleanName = (v) => String(v || '학생').trim().slice(0, 16) || '학생';
const roomOf = (socket) => socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
const clearTimer = (room) => { if (room.timer) clearInterval(room.timer); room.timer = null; };

function currentScanCooldown(room) {
  return room.timeLeft <= room.settings.finalScanWindowSeconds
    ? room.settings.finalScanSeconds
    : room.settings.baseScanSeconds;
}

function publicPlayers(room, viewerIsHost = false) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, x: p.x, y: p.y, pose: p.pose,
    rotation: p.rotation, role: p.role, alive: p.alive,
    paint: p.paint.slice(-220),
    revealUntil: p.revealUntil || 0,
    ...(viewerIsHost ? { fullPaintCount: p.paint.length } : {}),
  }));
}

function stateFor(room, isHost = false) {
  const cooldown = currentScanCooldown(room);
  return {
    phase: room.phase,
    round: room.round,
    timeLeft: room.timeLeft,
    roomCode: room.code,
    map: MAP,
    settings: room.settings,
    scanCooldown: cooldown,
    scanAvailableAt: room.lastScanAt + cooldown * 1000,
    players: publicPlayers(room, isHost),
    hiderCount: room.hiderIds.size,
    seekerCount: room.seekerIds.size,
  };
}

function broadcast(room) {
  for (const p of io.sockets.adapter.rooms.get(room.code) || []) {
    const s = io.sockets.sockets.get(p);
    if (s) s.emit('state', stateFor(room, s.data.isHost === true));
  }
}

function assignRoles(room) {
  room.hiderIds.clear();
  room.seekerIds.clear();
  const ids = [...room.players.keys()];
  const seekerCount = ids.length >= 15 ? 3 : ids.length >= 8 ? 2 : 1;
  const shuffled = ids.slice().sort(() => Math.random() - 0.5);
  const seekers = new Set(shuffled.slice(0, Math.min(seekerCount, Math.max(1, ids.length - 1))));

  ids.forEach((id, i) => {
    const p = room.players.get(id);
    p.role = seekers.has(id) ? 'seeker' : 'hider';
    p.alive = true;
    p.paint = [];
    p.pose = ['stand', 'crouch', 'lay'][Math.floor(Math.random() * 3)];
    p.rotation = 0;
    p.revealUntil = 0;
    const s = spawnPoints[i % spawnPoints.length];
    p.x = s[0]; p.y = s[1];
    if (p.role === 'seeker') room.seekerIds.add(id); else room.hiderIds.add(id);
  });
}

function startRound(room) {
  if (room.players.size < 2 || room.phase !== PHASE.WAITING) return false;
  room.round += 1;
  assignRoles(room);
  room.phase = PHASE.HIDE;
  room.timeLeft = room.settings.hideSeconds;
  room.lastScanAt = 0;
  broadcast(room);
  clearTimer(room);

  room.timer = setInterval(() => {
    room.timeLeft -= 1;
    if (room.timeLeft <= 0) {
      room.phase = PHASE.SEEK;
      room.timeLeft = room.settings.seekSeconds;
      room.lastScanAt = 0;
    }
    broadcast(room);
    if (room.phase === PHASE.SEEK && room.timeLeft <= 0) {
      room.phase = PHASE.RESULT;
      clearTimer(room);
      broadcast(room);
    }
  }, 1000);
  return true;
}

io.on('connection', (socket) => {
  socket.on('host', ({ code }) => {
    if (String(code || '').trim().toUpperCase() !== ADMIN_CODE) return socket.emit('hostError', '관리자 코드가 아닙니다.');
    if (socket.data.roomCode) return socket.emit('hostError', '이미 방에 연결되어 있습니다.');
    let roomCode;
    do roomCode = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(roomCode));
    const room = makeRoom(roomCode);
    room.hostId = socket.id;
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.isHost = true;
    socket.emit('hostReady', { roomCode });
    broadcast(room);
  });

  socket.on('join', ({ roomCode, name }) => {
    const code = String(roomCode || '').trim().toUpperCase().slice(0, 12);
    if (!code || code === ADMIN_CODE) return socket.emit('joinError', '학생용 방 코드를 입력하세요.');
    const room = rooms.get(code);
    if (!room) return socket.emit('joinError', '방을 찾을 수 없습니다.');
    if (room.phase !== PHASE.WAITING) return socket.emit('joinError', '이미 시작된 게임입니다.');
    if (room.players.size >= MAX_PLAYERS) return socket.emit('joinError', '방이 가득 찼어요.');
    const index = room.players.size;
    const [x, y] = spawnPoints[index % spawnPoints.length];
    const p = { id: socket.id, name: cleanName(name), x, y, rotation: 0, pose: 'stand', role: 'pending', alive: true, paint: [], revealUntil: 0 };
    room.players.set(socket.id, p);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = false;
    socket.emit('joined', { roomCode: code });
    broadcast(room);
  });

  socket.on('settings', (raw) => {
    const room = roomOf(socket);
    if (!room || !socket.data.isHost || socket.id !== room.hostId || room.phase !== PHASE.WAITING) return;
    const next = { ...room.settings };
    for (const key of Object.keys(next)) {
      if (raw && Number.isFinite(Number(raw[key]))) next[key] = Number(raw[key]);
    }
    next.hideSeconds = clamp(Math.round(next.hideSeconds), 10, 600);
    next.seekSeconds = clamp(Math.round(next.seekSeconds), 30, 900);
    next.baseScanSeconds = clamp(next.baseScanSeconds, 0.5, 30);
    next.finalScanSeconds = clamp(next.finalScanSeconds, 0.5, 10);
    next.finalScanWindowSeconds = clamp(Math.round(next.finalScanWindowSeconds), 5, 120);
    next.scanRadius = clamp(Math.round(next.scanRadius), 50, 400);
    next.revealSeconds = clamp(next.revealSeconds, 0.5, 5);
    room.settings = next;
    broadcast(room);
  });

  socket.on('start', () => {
    const room = roomOf(socket);
    if (room && socket.data.isHost && socket.id === room.hostId) startRound(room);
  });

  socket.on('move', ({ x, y, rotation }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost) return;
    const p = room.players.get(socket.id);
    if (!p || !p.alive || p.role !== 'hider' || room.phase !== PHASE.HIDE) return;
    if (Number.isFinite(Number(x))) p.x = clamp(Number(x), 45, MAP.width - 45);
    if (Number.isFinite(Number(y))) p.y = clamp(Number(y), 45, MAP.height - 45);
    if (Number.isFinite(Number(rotation))) p.rotation = Number(rotation);
  });

  socket.on('pose', ({ pose }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.HIDE) return;
    const p = room.players.get(socket.id);
    if (!p || p.role !== 'hider' || !p.alive) return;
    if (['stand', 'crouch', 'lay'].includes(pose)) p.pose = pose;
    broadcast(room);
  });

  socket.on('paint', ({ x, y, radius, color }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.HIDE) return;
    const p = room.players.get(socket.id);
    if (!p || p.role !== 'hider' || !p.alive) return;
    const px = Number(x), py = Number(y), r = clamp(Number(radius) || 12, 4, 55);
    if (!Number.isFinite(px) || !Number.isFinite(py) || typeof color !== 'string') return;
    const stroke = { x: clamp(px, -90, 90), y: clamp(py, -120, 120), radius: r, color: color.slice(0, 16) };
    p.paint.push(stroke);
    if (p.paint.length > 220) p.paint.splice(0, p.paint.length - 220);
  });

  socket.on('scan', ({ x, y }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.SEEK) return;
    const seeker = room.players.get(socket.id);
    if (!seeker || seeker.role !== 'seeker' || !seeker.alive) return;
    const now = Date.now();
    const cooldown = currentScanCooldown(room);
    if (now < room.lastScanAt + cooldown * 1000) {
      return socket.emit('scanDenied', { waitMs: room.lastScanAt + cooldown * 1000 - now });
    }
    const sx = Number(x), sy = Number(y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    room.lastScanAt = now;
    const found = [];
    for (const p of room.players.values()) {
      if (p.role !== 'hider' || !p.alive) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= room.settings.scanRadius) {
        p.revealUntil = now + room.settings.revealSeconds * 1000;
        found.push({ id: p.id, name: p.name });
      }
    }
    io.to(room.code).emit('scanEffect', { x: sx, y: sy, found, until: now + room.settings.revealSeconds * 1000 });
    broadcast(room);
  });

  socket.on('catch', ({ targetId }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.SEEK) return;
    const seeker = room.players.get(socket.id);
    const target = room.players.get(String(targetId || ''));
    if (!seeker || seeker.role !== 'seeker' || !target || target.role !== 'hider' || !target.alive) return;
    const now = Date.now();
    if (now > (target.revealUntil || 0)) return socket.emit('catchDenied', '먼저 탐지로 드러낸 사람만 잡을 수 있어요.');
    target.alive = false;
    io.to(room.code).emit('caught', { targetId: target.id, name: target.name });
    if (![...room.players.values()].some(p => p.role === 'hider' && p.alive)) {
      clearTimer(room);
      room.phase = PHASE.RESULT;
    }
    broadcast(room);
  });

  socket.on('restart', () => {
    const room = roomOf(socket);
    if (!room || !socket.data.isHost || socket.id !== room.hostId) return;
    clearTimer(room);
    room.phase = PHASE.WAITING;
    room.round = 0;
    room.timeLeft = 0;
    room.players.forEach((p) => { p.role = 'pending'; p.alive = true; p.paint = []; p.revealUntil = 0; });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    if (!room) return;
    if (socket.data.isHost && socket.id === room.hostId) {
      clearTimer(room);
      io.to(room.code).emit('roomClosed');
      rooms.delete(room.code);
      return;
    }
    room.players.delete(socket.id);
    room.hiderIds.delete(socket.id);
    room.seekerIds.delete(socket.id);
    if (!room.players.size) {
      clearTimer(room);
      rooms.delete(room.code);
    } else broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) if (p.revealUntil && p.revealUntil < now) p.revealUntil = 0;
    if ([PHASE.HIDE, PHASE.SEEK].includes(room.phase)) broadcast(room);
  }
}, 120);

server.listen(PORT, () => console.log(`Chameleon V3 running on ${PORT}`));
