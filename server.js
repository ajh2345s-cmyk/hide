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
const MAPS = {
  classic: { id: 'classic', name: '오리지널 명화풍 맵', width: 7600, height: 4800 },
  monalisa: { id: 'monalisa', name: '모나리자 갤러리', width: 8000, height: 5200 },
};
const PHASE = { WAITING: 'waiting', HIDE: 'hide', SEEK: 'seek', RESULT: 'result' };
const POSES = ['stand', 'crouch', 'lay'];

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const cleanName = (v) => String(v || '학생').trim().slice(0, 16) || '학생';
const roomOf = (socket) => socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
const clearTimer = (room) => { if (room.timer) clearInterval(room.timer); room.timer = null; };
const mapOf = (room) => MAPS[room.settings.mapId] || MAPS.classic;

function makeRoom(code) {
  return {
    code,
    hostId: null,
    phase: PHASE.WAITING,
    round: 0,
    players: new Map(),
    settings: {
      mapId: 'monalisa',
      hideSeconds: 90,
      seekSeconds: 180,
      baseScanSeconds: 5,
      finalScanSeconds: 1,
      finalScanWindowSeconds: 30,
      scanRadius: 150,
      revealSeconds: 1.8,
    },
    timeLeft: 0,
    timer: null,
  };
}

function spawnPoint(index, map) {
  const cols = 5, rows = 4;
  const col = index % cols;
  const row = Math.floor(index / cols) % rows;
  return [
    Math.round(map.width * (0.12 + col * 0.19)),
    Math.round(map.height * (0.18 + row * 0.20)),
  ];
}

function seekerCountFor(size) {
  return size >= 16 ? 3 : size >= 9 ? 2 : 1;
}

function currentScanCooldown(room) {
  return room.timeLeft <= room.settings.finalScanWindowSeconds
    ? room.settings.finalScanSeconds
    : room.settings.baseScanSeconds;
}

function publicPlayers(room, viewerIsHost = false) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    pose: p.pose,
    rotation: p.rotation,
    role: p.role,
    alive: p.alive,
    paint: p.paint.slice(-260),
    revealUntil: p.revealUntil || 0,
    ...(viewerIsHost ? { scanReadyAt: p.scanReadyAt || 0, fullPaintCount: p.paint.length } : {}),
  }));
}

function stateFor(room, isHost = false) {
  const map = mapOf(room);
  const cooldown = currentScanCooldown(room);
  return {
    phase: room.phase,
    round: room.round,
    timeLeft: room.timeLeft,
    roomCode: room.code,
    map,
    maps: Object.values(MAPS).map(({ id, name }) => ({ id, name })),
    settings: room.settings,
    scanCooldown: cooldown,
    players: publicPlayers(room, isHost),
    hiderCount: [...room.players.values()].filter(p => p.role === 'hider').length,
    seekerCount: [...room.players.values()].filter(p => p.role === 'seeker').length,
  };
}

function broadcast(room) {
  const sockets = io.sockets.adapter.rooms.get(room.code) || new Set();
  for (const id of sockets) {
    const s = io.sockets.sockets.get(id);
    if (s) s.emit('state', stateFor(room, s.data.isHost === true));
  }
}

function assignRoles(room) {
  const ids = [...room.players.keys()];
  const shuffled = ids.slice().sort(() => Math.random() - 0.5);
  const seekerCount = Math.min(seekerCountFor(ids.length), Math.max(1, ids.length - 1));
  const seekerIds = new Set(shuffled.slice(0, seekerCount));
  const map = mapOf(room);
  ids.forEach((id, index) => {
    const p = room.players.get(id);
    p.role = seekerIds.has(id) ? 'seeker' : 'hider';
    p.alive = true;
    p.paint = [];
    p.pose = POSES[index % POSES.length];
    p.rotation = 0;
    p.revealUntil = 0;
    p.scanReadyAt = 0;
    const [x, y] = spawnPoint(index, map);
    p.x = x;
    p.y = y;
  });
}

function startRound(room) {
  if (room.players.size < 2 || room.phase !== PHASE.WAITING) return false;
  room.round += 1;
  assignRoles(room);
  room.phase = PHASE.HIDE;
  room.timeLeft = room.settings.hideSeconds;
  broadcast(room);
  clearTimer(room);
  room.timer = setInterval(() => {
    room.timeLeft -= 1;
    if (room.phase === PHASE.HIDE && room.timeLeft <= 0) {
      room.phase = PHASE.SEEK;
      room.timeLeft = room.settings.seekSeconds;
      for (const p of room.players.values()) p.scanReadyAt = 0;
    } else if (room.phase === PHASE.SEEK && room.timeLeft <= 0) {
      room.phase = PHASE.RESULT;
      room.timeLeft = 0;
      clearTimer(room);
    }
    broadcast(room);
  }, 1000);
  return true;
}

function validateMove(p, rawX, rawY, rawRotation, map) {
  const x = Number(rawX), y = Number(rawY), rotation = Number(rawRotation);
  if (Number.isFinite(x)) p.x = clamp(x, 60, map.width - 60);
  if (Number.isFinite(y)) p.y = clamp(y, 60, map.height - 60);
  if (Number.isFinite(rotation)) p.rotation = rotation;
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
    const map = mapOf(room);
    const [x, y] = spawnPoint(room.players.size, map);
    const p = {
      id: socket.id,
      name: cleanName(name),
      x, y,
      rotation: 0,
      pose: 'stand',
      role: 'pending',
      alive: true,
      paint: [],
      revealUntil: 0,
      scanReadyAt: 0,
    };
    room.players.set(socket.id, p);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = false;
    socket.emit('joined', { roomCode: code });
    broadcast(room);
  });

  socket.on('settings', (raw = {}) => {
    const room = roomOf(socket);
    if (!room || !socket.data.isHost || socket.id !== room.hostId || room.phase !== PHASE.WAITING) return;
    const next = { ...room.settings };
    if (['classic', 'monalisa'].includes(String(raw.mapId))) next.mapId = String(raw.mapId);
    const numeric = ['hideSeconds','seekSeconds','baseScanSeconds','finalScanSeconds','finalScanWindowSeconds','scanRadius','revealSeconds'];
    for (const key of numeric) if (Number.isFinite(Number(raw[key]))) next[key] = Number(raw[key]);
    next.hideSeconds = clamp(Math.round(next.hideSeconds), 10, 600);
    next.seekSeconds = clamp(Math.round(next.seekSeconds), 30, 900);
    next.baseScanSeconds = clamp(next.baseScanSeconds, 0.5, 30);
    next.finalScanSeconds = clamp(next.finalScanSeconds, 0.5, 10);
    next.finalScanWindowSeconds = clamp(Math.round(next.finalScanWindowSeconds), 5, 120);
    next.scanRadius = clamp(Math.round(next.scanRadius), 60, 450);
    next.revealSeconds = clamp(next.revealSeconds, 0.5, 5);
    room.settings = next;
    const map = mapOf(room);
    room.players.forEach((p, index) => {
      if (p.role === 'pending') {
        const [x, y] = spawnPoint(index, map);
        p.x = x; p.y = y;
      }
    });
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
    if (!p || !p.alive) return;
    const canMove = (p.role === 'hider' && room.phase === PHASE.HIDE) || (p.role === 'seeker' && room.phase === PHASE.SEEK);
    if (!canMove) return;
    validateMove(p, x, y, rotation, mapOf(room));
  });

  socket.on('pose', ({ pose }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.HIDE) return;
    const p = room.players.get(socket.id);
    if (!p || p.role !== 'hider' || !p.alive) return;
    if (POSES.includes(pose)) p.pose = pose;
    broadcast(room);
  });

  socket.on('paint', ({ x, y, radius, color }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.HIDE) return;
    const p = room.players.get(socket.id);
    if (!p || p.role !== 'hider' || !p.alive) return;
    const px = Number(x), py = Number(y), r = clamp(Number(radius) || 12, 4, 65);
    if (!Number.isFinite(px) || !Number.isFinite(py) || typeof color !== 'string') return;
    if (Math.hypot(px, py) > 165) return;
    const stroke = { x: clamp(px, -150, 150), y: clamp(py, -150, 150), radius: r, color: color.slice(0, 16) };
    p.paint.push(stroke);
    if (p.paint.length > 260) p.paint.splice(0, p.paint.length - 260);
  });

  socket.on('scan', ({ x, y }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.SEEK) return;
    const seeker = room.players.get(socket.id);
    if (!seeker || seeker.role !== 'seeker' || !seeker.alive) return;
    const now = Date.now();
    const cooldown = currentScanCooldown(room);
    if (now < seeker.scanReadyAt) return socket.emit('scanDenied', { waitMs: seeker.scanReadyAt - now });
    const sx = Number(x), sy = Number(y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    seeker.scanReadyAt = now + cooldown * 1000;
    const found = [];
    for (const p of room.players.values()) {
      if (p.role !== 'hider' || !p.alive) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= room.settings.scanRadius) {
        p.revealUntil = now + room.settings.revealSeconds * 1000;
        found.push({ id: p.id, name: p.name });
      }
    }
    io.to(room.code).emit('scanEffect', { x: sx, y: sy, found, until: now + room.settings.revealSeconds * 1000, seekerId: seeker.id });
    broadcast(room);
  });

  socket.on('catch', ({ targetId }) => {
    const room = roomOf(socket);
    if (!room || socket.data.isHost || room.phase !== PHASE.SEEK) return;
    const seeker = room.players.get(socket.id);
    const target = room.players.get(String(targetId || ''));
    if (!seeker || seeker.role !== 'seeker' || !seeker.alive || !target || target.role !== 'hider' || !target.alive) return;
    const now = Date.now();
    if (now > (target.revealUntil || 0)) return socket.emit('catchDenied', '탐지된 사람만 잡을 수 있어요.');
    if (Math.hypot(seeker.x - target.x, seeker.y - target.y) > room.settings.scanRadius * 1.4) return socket.emit('catchDenied', '조금 더 가까이 가야 잡을 수 있어요.');
    target.alive = false;
    target.revealUntil = 0;
    io.to(room.code).emit('caught', { targetId: target.id, name: target.name });
    const aliveHiders = [...room.players.values()].some(p => p.role === 'hider' && p.alive);
    if (!aliveHiders) {
      clearTimer(room);
      room.phase = PHASE.RESULT;
      room.timeLeft = 0;
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
    room.players.forEach((p, index) => {
      p.role = 'pending'; p.alive = true; p.paint = []; p.revealUntil = 0; p.scanReadyAt = 0; p.pose = 'stand';
      const [x, y] = spawnPoint(index, mapOf(room)); p.x = x; p.y = y;
    });
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
}, 180);

server.listen(PORT, () => console.log(`Chameleon V4 running on ${PORT}`));
