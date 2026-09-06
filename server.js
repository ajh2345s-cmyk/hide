const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 20;
const MAP = { width: 5000, height: 3200 };
const SPECIAL_HOST_CODE = 'GMLTN';
const PHASES = { WAITING:'waiting', HIDE:'hide', SEEK:'seek', RESULT:'result' };

const spawnPoints = [];
for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) spawnPoints.push([500 + x * 940, 450 + y * 760]);

function makeRoom(code) {
  return {
    code,
    hostId: null,
    phase: PHASES.WAITING,
    round: 0,
    players: new Map(),
    hiderIds: new Set(),
    seekerIds: new Set(),
    timeLeft: 0,
    timer: null,
  };
}

const rooms = new Map();

function sanitizeName(name) { return String(name || '학생').trim().slice(0, 16) || '학생'; }
function findRoomForSocket(socket) { return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null; }
function clearTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    role: p.role,
    alive: p.alive,
    paint: p.paint.slice(-120),
  }));
}

function roomState(room) {
  return {
    phase: room.phase,
    round: room.round,
    timeLeft: room.timeLeft,
    roomCode: room.code,
    players: publicPlayers(room),
    map: MAP,
    hiderCount: room.hiderIds.size,
    seekerCount: room.seekerIds.size,
  };
}

function broadcast(room) { io.to(room.code).emit('state', roomState(room)); }

function assignRoles(room) {
  room.hiderIds.clear();
  room.seekerIds.clear();
  const ids = [...room.players.keys()];
  // Roughly 15% seekers, capped at 4 and always at least 1.
  const seekerCount = Math.max(1, Math.min(4, Math.floor(ids.length * 0.15) || 1));
  const shuffled = ids.slice().sort(() => Math.random() - 0.5);
  const seekerSet = new Set(shuffled.slice(0, seekerCount));

  ids.forEach((id, i) => {
    const p = room.players.get(id);
    p.role = seekerSet.has(id) ? 'seeker' : 'hider';
    p.alive = true;
    p.paint = [];
    const s = spawnPoints[i % spawnPoints.length];
    p.x = s[0]; p.y = s[1]; p.rotation = 0;
    if (p.role === 'seeker') room.seekerIds.add(id); else room.hiderIds.add(id);
  });
}

function startRound(room) {
  if (room.players.size < 2 || room.phase !== PHASES.WAITING) return false;
  room.round += 1;
  assignRoles(room);
  room.phase = PHASES.HIDE;
  room.timeLeft = 60;
  broadcast(room);
  clearTimer(room);
  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      clearTimer(room);
      room.phase = PHASES.SEEK;
      room.timeLeft = 180;
      broadcast(room);
      room.timer = setInterval(() => {
        room.timeLeft--;
        if (room.timeLeft <= 0) {
          clearTimer(room);
          room.phase = PHASES.RESULT;
        }
        broadcast(room);
      }, 1000);
    }
    broadcast(room);
  }, 1000);
  return true;
}

io.on('connection', socket => {
  socket.on('host', ({ code }) => {
    if (String(code || '').trim().toUpperCase() !== SPECIAL_HOST_CODE) return socket.emit('hostError', '관리자 코드가 아닙니다.');
    if (socket.data.roomCode) return socket.emit('hostError', '이미 다른 방에 연결되어 있습니다.');
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
    const playerName = sanitizeName(name);
    if (!code) return socket.emit('joinError', '방 코드를 입력하세요.');
    if (code === SPECIAL_HOST_CODE) return socket.emit('joinError', '관리자 코드입니다. 학생용 방 코드를 입력하세요.');
    let room = rooms.get(code);
    if (!room) return socket.emit('joinError', '방을 찾을 수 없습니다. 선생님이 먼저 방을 만들어야 합니다.');
    if (room.phase !== PHASES.WAITING) return socket.emit('joinError', '이미 시작된 게임입니다.');
    if (room.players.size >= MAX_PLAYERS) return socket.emit('joinError', '방이 가득 찼어요.');
    const idx = room.players.size;
    const s = spawnPoints[idx % spawnPoints.length];
    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      x: s[0], y: s[1], rotation: 0,
      role: 'pending', alive: true,
      paint: []
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = false;
    socket.emit('joined', { roomCode: code, max: MAX_PLAYERS });
    broadcast(room);
  });

  socket.on('start', () => {
    const room = findRoomForSocket(socket);
    if (!room || !socket.data.isHost || socket.id !== room.hostId) return;
    startRound(room);
  });

  socket.on('move', ({ x, y, rotation }) => {
    const room = findRoomForSocket(socket);
    if (!room || socket.data.isHost) return;
    const p = room.players.get(socket.id);
    if (!p || !p.alive) return;
    if (room.phase === PHASES.HIDE && p.role !== 'hider') return;
    if (![PHASES.HIDE, PHASES.SEEK].includes(room.phase)) return;
    const nx = Number(x), ny = Number(y), nr = Number(rotation);
    if (Number.isFinite(nx)) p.x = clamp(nx, 35, MAP.width - 35);
    if (Number.isFinite(ny)) p.y = clamp(ny, 35, MAP.height - 35);
    if (Number.isFinite(nr)) p.rotation = nr;
  });

  socket.on('paintStroke', ({ x, y, radius, color }) => {
    const room = findRoomForSocket(socket);
    if (!room || room.phase !== PHASES.HIDE || socket.data.isHost) return;
    const p = room.players.get(socket.id);
    if (!p || p.role !== 'hider' || !p.alive) return;
    const px = Number(x), py = Number(y), r = clamp(Number(radius) || 12, 3, 45);
    if (!Number.isFinite(px) || !Number.isFinite(py) || typeof color !== 'string') return;
    p.paint.push({ x: clamp(px, -80, 80), y: clamp(py, -110, 90), radius: r, color: color.slice(0, 16) });
    if (p.paint.length > 160) p.paint.shift();
  });

  socket.on('caught', ({ targetId }) => {
    const room = findRoomForSocket(socket);
    if (!room || room.phase !== PHASES.SEEK || socket.data.isHost) return;
    const seeker = room.players.get(socket.id);
    if (!seeker || seeker.role !== 'seeker' || !seeker.alive) return;
    const target = room.players.get(String(targetId || ''));
    if (!target || target.role !== 'hider' || !target.alive) return;
    const d = Math.hypot(seeker.x - target.x, seeker.y - target.y);
    if (d <= 75) {
      target.alive = false;
      io.to(room.code).emit('caught', { targetId: target.id, name: target.name });
      if (![...room.players.values()].some(p => p.role === 'hider' && p.alive)) {
        clearTimer(room);
        room.phase = PHASES.RESULT;
      }
      broadcast(room);
    } else socket.emit('miss');
  });

  socket.on('restart', () => {
    const room = findRoomForSocket(socket);
    if (!room || !socket.data.isHost || socket.id !== room.hostId) return;
    clearTimer(room);
    room.phase = PHASES.WAITING;
    room.timeLeft = 0;
    room.round = 0;
    room.players.forEach(p => { p.role='pending'; p.alive=true; p.paint=[]; });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = findRoomForSocket(socket);
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
    if (!room.players.size && !room.hostId) { clearTimer(room); rooms.delete(room.code); }
    else broadcast(room);
  });
});

// Low-rate authoritative state broadcast: friendly to weaker tablets.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === PHASES.HIDE || room.phase === PHASES.SEEK) broadcast(room);
  }
}, 120);

server.listen(PORT, () => console.log(`Chameleon v2 running on ${PORT}`));
