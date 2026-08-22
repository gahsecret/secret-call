import express from "express";
import http from "http";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');

app.use(cors());
app.get('/health', (_, res) => res.json({
  ok: true,
  service: 'Secret Call',
  version: '1.4.2',
  rooms: rooms?.size ?? 0
}));

app.get('/ice-config', (_, res) => {
  const username = process.env.TURN_USERNAME || '';
  const credential = process.env.TURN_PASSWORD || '';

  const iceServers = [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'stun:stun.l.google.com:19302' }
  ];

  if (username && credential) {
    iceServers.push(
      { urls: 'turn:global.relay.metered.ca:80', username, credential },
      { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username, credential },
      { urls: 'turn:global.relay.metered.ca:443', username, credential },
      { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username, credential }
    );
  }

  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    turnEnabled: Boolean(username && credential),
    iceServers
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_MEMBERS = 10;
const MAX_SHARERS = 3;

const rooms = new Map(); // internalId -> room
const codeToRoom = new Map(); // rotating code -> internalId
const users = new Map(); // socketId -> { roomId, name }

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function uniqueCode() {
  let code;
  do code = makeCode(); while (codeToRoom.has(code));
  return code;
}

function rotateCode(room) {
  if (room.code) codeToRoom.delete(room.code);
  room.code = uniqueCode();
  room.codeExpiresAt = Date.now() + CODE_TTL_MS;
  codeToRoom.set(room.code, room.id);
  io.to(room.id).emit('room-code-updated', {
    code: room.code,
    expiresAt: room.codeExpiresAt
  });
}

function newRoom() {
  const id = crypto.randomUUID();
  const room = {
    id,
    code: '',
    codeExpiresAt: 0,
    members: new Set(),
    sharers: new Set()
  };
  rooms.set(id, room);
  rotateCode(room);
  return room;
}

function getMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.members].map(socketId => ({
    socketId,
    name: users.get(socketId)?.name || 'Convidado',
    sharing: room.sharers.has(socketId)
  }));
}

function emitParticipants(roomId) {
  io.to(roomId).emit('participants', getMembers(roomId));
}

function leaveCurrentRoom(socket) {
  const user = users.get(socket.id);
  if (!user) return;
  const room = rooms.get(user.roomId);
  users.delete(socket.id);
  if (!room) return;

  room.members.delete(socket.id);
  room.sharers.delete(socket.id);
  socket.leave(room.id);
  socket.to(room.id).emit('user-left', { socketId: socket.id });
  emitParticipants(room.id);

  if (room.members.size === 0) {
    codeToRoom.delete(room.code);
    rooms.delete(room.id);
  }
}

function joinInternal(socket, room, name) {
  users.set(socket.id, { roomId: room.id, name });
  room.members.add(socket.id);
  socket.join(room.id);
  const existing = getMembers(room.id).filter(u => u.socketId !== socket.id);
  socket.emit('room-users', existing);
  socket.to(room.id).emit('user-joined', { socketId: socket.id, name });
  emitParticipants(room.id);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.members.size > 0 && now >= room.codeExpiresAt) rotateCode(room);
  }
}, 1000);

io.on('connection', socket => {
  socket.on('create-room', ({ name }, ack) => {
    const cleanName = String(name || '').trim().slice(0, 32);
    if (!cleanName) return ack?.({ ok: false, error: 'Digite seu nome.' });
    leaveCurrentRoom(socket);
    const room = newRoom();
    joinInternal(socket, room, cleanName);
    ack?.({ ok: true, code: room.code, expiresAt: room.codeExpiresAt });
  });

  socket.on('join-room', ({ code, name }, ack) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim().slice(0, 32);
    const roomId = codeToRoom.get(cleanCode);
    const room = roomId ? rooms.get(roomId) : null;

    if (!cleanName) return ack?.({ ok: false, error: 'Digite seu nome.' });
    if (!room || room.code !== cleanCode || Date.now() >= room.codeExpiresAt) {
      return ack?.({ ok: false, error: 'Código inválido ou expirado.' });
    }
    if (room.members.size >= MAX_MEMBERS) {
      return ack?.({ ok: false, error: 'A sala atingiu o limite de 10 pessoas.' });
    }

    leaveCurrentRoom(socket);
    joinInternal(socket, room, cleanName);
    ack?.({ ok: true, code: room.code, expiresAt: room.codeExpiresAt });
  });

  socket.on('request-screen-share', (_, ack) => {
    const user = users.get(socket.id);
    const room = user ? rooms.get(user.roomId) : null;
    if (!room) return ack?.({ ok: false, error: 'Você não está em uma sala.' });
    if (room.sharers.has(socket.id)) return ack?.({ ok: true });
    if (room.sharers.size >= MAX_SHARERS) {
      return ack?.({ ok: false, error: 'Já existem 3 pessoas compartilhando a tela.' });
    }
    room.sharers.add(socket.id);
    emitParticipants(room.id);
    io.to(room.id).emit('sharing-count', { count: room.sharers.size, max: MAX_SHARERS });
    ack?.({ ok: true });
  });

  socket.on('stop-screen-share', () => {
    const user = users.get(socket.id);
    const room = user ? rooms.get(user.roomId) : null;
    if (!room) return;
    room.sharers.delete(socket.id);
    emitParticipants(room.id);
    io.to(room.id).emit('sharing-count', { count: room.sharers.size, max: MAX_SHARERS });
  });

  socket.on('webrtc-offer', ({ target, offer }) => {
    io.to(target).emit('webrtc-offer', { from: socket.id, offer, name: users.get(socket.id)?.name || 'Convidado' });
  });
  socket.on('webrtc-answer', ({ target, answer }) => {
    io.to(target).emit('webrtc-answer', { from: socket.id, answer });
  });
  socket.on('webrtc-ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('webrtc-ice-candidate', { from: socket.id, candidate });
  });
  socket.on('leave-room', () => leaveCurrentRoom(socket));
  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

if (process.env.NODE_ENV === 'production' && process.env.SERVE_CLIENT !== 'false') {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || req.path === '/health' || req.path === '/ice-config') return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Secret Call V1.4.2 rodando na porta ${PORT}`);
});
