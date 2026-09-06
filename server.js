const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const MAX_PLAYERS = 20;
const MAP = { width: 1200, height: 700 };

const spawnPoints = [
  [120,120],[250,150],[380,120],[510,170],[650,120],[790,160],[930,120],[1060,150],
  [160,310],[300,330],[450,290],[600,340],[760,300],[900,330],[1050,300],
  [120,540],[280,560],[500,520],[760,550],[1040,540]
];

function newRoom(code) {
  return {
    code,
    phase: 'waiting',
    round: 0,
    players: new Map(),
    seekerId: null,
    timeLeft: 0,
    timer: null,
    map: 'starry',
  };
}
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id:p.id, name:p.name, x:p.x, y:p.y, rotation:p.rotation,
    role: room.phase === 'result' ? p.role : (p.id === room.seekerId ? 'seeker' : 'hider'),
    palette:p.palette
  }));
}
function broadcastState(room) {
  io.to(room.code).emit('state', {
    phase: room.phase,
    round: room.round,
    timeLeft: room.timeLeft,
    seekerId: room.seekerId,
    players: publicPlayers(room),
    map: room.map
  });
}
function clearTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function startTimer(room, seconds, onEnd) {
  clearTimer(room); room.timeLeft = seconds;
  room.timer = setInterval(() => {
    room.timeLeft--;
    broadcastState(room);
    if (room.timeLeft <= 0) { clearTimer(room); onEnd(); }
  },1000);
}
function startRound(room) {
  if (room.players.size < 2) return;
  room.round += 1;
  room.phase = 'hide';
  const ids = [...room.players.keys()];
  room.seekerId = ids[Math.floor(Math.random() * ids.length)];
  ids.forEach((id,i) => {
    const p = room.players.get(id);
    p.role = id === room.seekerId ? 'seeker' : 'hider';
    p.x = spawnPoints[i % spawnPoints.length][0];
    p.y = spawnPoints[i % spawnPoints.length][1];
    p.rotation = 0;
    if (p.role === 'hider') p.palette = {...p.palette, body:'#7b6d5f', head:'#9b7651', arm:'#7b6d5f', leg:'#514a43'};
  });
  broadcastState(room);
  startTimer(room, 45, () => {
    room.phase = 'seek';
    startTimer(room, 120, () => { room.phase = 'result'; broadcastState(room); });
    broadcastState(room);
  });
}

io.on('connection', socket => {
  socket.on('join', ({roomCode, name}) => {
    roomCode = String(roomCode || 'ROOM').trim().toUpperCase().slice(0,12);
    name = String(name || '학생').trim().slice(0,16) || '학생';
    let room = rooms.get(roomCode);
    if (!room) { room = newRoom(roomCode); rooms.set(roomCode, room); }
    if (room.players.size >= MAX_PLAYERS) return socket.emit('joinError','방이 가득 찼어요.');
    if (room.phase !== 'waiting') return socket.emit('joinError','이미 시작된 게임이에요.');
    const idx = room.players.size;
    room.players.set(socket.id, {
      id: socket.id, name, x: spawnPoints[idx][0], y: spawnPoints[idx][1], rotation:0,
      role:'hider', palette:{body:'#7b6d5f',head:'#9b7651',arm:'#7b6d5f',leg:'#514a43'}
    });
    socket.join(roomCode); socket.data.roomCode = roomCode;
    socket.emit('joined',{roomCode, max:MAX_PLAYERS});
    broadcastState(room);
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    if (room.players.size >= 2 && room.phase === 'waiting') startRound(room);
  });

  socket.on('move', ({x,y,rotation}) => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const p = room.players.get(socket.id); if (!p) return;
    if (!['hide','seek'].includes(room.phase)) return;
    p.x = Math.max(35,Math.min(MAP.width-35,Number(x)||p.x));
    p.y = Math.max(45,Math.min(MAP.height-45,Number(y)||p.y));
    p.rotation = Number(rotation)||0;
    socket.to(room.code).emit('playerMove',{id:socket.id,x:p.x,y:p.y,rotation:p.rotation});
  });

  socket.on('paint', payload => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.phase !== 'hide') return;
    const p = room.players.get(socket.id); if (!p || p.role === 'seeker') return;
    const {part,color} = payload || {};
    if (!['body','head','arm','leg'].includes(part)) return;
    if (typeof color !== 'string') return;
    p.palette[part] = color.slice(0,12);
    socket.emit('painted', {palette:p.palette});
  });

  socket.on('catchAttempt', ({targetId}) => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.phase !== 'seek') return;
    if (socket.id !== room.seekerId) return;
    const target = room.players.get(targetId);
    if (!target || target.role === 'seeker') return;
    const seeker = room.players.get(socket.id);
    const d = Math.hypot(seeker.x-target.x,seeker.y-target.y);
    if (d <= 70) {
      target.role = 'caught';
      io.to(room.code).emit('caught',{targetId});
      const hiders = [...room.players.values()].filter(p=>p.role !== 'seeker' && p.role !== 'caught');
      if (hiders.length === 0) { room.phase='result'; clearTimer(room); broadcastState(room); }
      else broadcastState(room);
    } else socket.emit('miss');
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    room.players.delete(socket.id);
    if (room.seekerId === socket.id && room.phase !== 'waiting' && room.phase !== 'result') {
      const next = [...room.players.keys()][0]; room.seekerId = next || null;
      if (next) room.players.get(next).role = 'seeker';
    }
    if (!room.players.size) { clearTimer(room); rooms.delete(room.code); }
    else broadcastState(room);
  });
});

server.listen(PORT, () => console.log(`Chameleon draft running on ${PORT}`));
