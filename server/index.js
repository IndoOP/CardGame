const express = require('express'), http = require('http'), cors = require('cors'), crypto = require('crypto');
const { Server } = require('socket.io');
const G = require('./games');

const PORT = process.env.PORT || 3001;
const ORIGIN = process.env.CLIENT_ORIGIN || '*'; // comma-separated list in production
const origin = ORIGIN === '*' ? '*' : ORIGIN.split(',').map(s => s.trim());

const rooms = new Map();
const app = express();
app.use(cors({ origin }));
app.get('/', (_, res) => res.json({ ok: true, rooms: rooms.size }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin }, pingInterval: 10000, pingTimeout: 15000 });

const clean = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
const gen = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join(''); } while (rooms.has(c)); return c; };
const newPlayer = (name, token) => ({ id: crypto.randomBytes(4).toString('hex'), token, name, sock: null, connected: false });

function snap(r, p) {
  return { code: r.code, hostId: r.hostId, you: p.id, phase: r.phase, game: r.game, msg: r.msg,
    players: r.players.map(x => ({ id: x.id, name: x.name, connected: x.connected })),
    g: r.game && r.g ? G[r.game].view(r, p.id) : null };
}
const push = r => r.players.forEach(p => p.sock && io.to(p.sock).emit('state', snap(r, p)));

function attach(socket, r, p) {
  if (socket.data.code && socket.data.code !== r.code) leave(socket);
  p.sock = socket.id; p.connected = true; r.emptySince = null;
  socket.data = { code: r.code, pid: p.id };
}
function leave(socket) {
  const r = rooms.get(socket.data.code); const pid = socket.data.pid; socket.data = {};
  if (!r) return;
  const p = r.players.find(x => x.id === pid); if (!p) return;
  r.players = r.players.filter(x => x !== p);
  if (!r.players.length) { rooms.delete(r.code); return; }
  if (r.phase !== 'lobby') { r.phase = 'lobby'; r.game = null; r.g = null; r.msg = `${p.name} left, so the game ended`; }
  if (r.hostId === p.id) r.hostId = (r.players.find(x => x.connected) || r.players[0]).id;
  push(r);
}

io.on('connection', socket => {
  socket.data = {};
  const ctx = () => { const r = rooms.get(socket.data.code); return [r, r && r.players.find(x => x.id === socket.data.pid)]; };

  socket.on('create', (d = {}, ack = () => {}) => {
    const name = clean(d.name), token = String(d.token || '');
    if (!name) return ack({ error: 'Enter a name' });
    if (token.length < 16) return ack({ error: 'Bad session' });
    const p = newPlayer(name, token), r = { code: gen(), hostId: p.id, players: [p], phase: 'lobby', game: null, g: null, msg: '', emptySince: null };
    rooms.set(r.code, r); attach(socket, r, p); ack({ ok: true, code: r.code }); push(r);
  });

  socket.on('join', (d = {}, ack = () => {}) => {
    const code = String(d.code || '').toUpperCase().trim(), token = String(d.token || '');
    const r = rooms.get(code); if (!r) return ack({ error: 'Room not found' });
    if (token.length < 16) return ack({ error: 'Bad session' });
    let p = r.players.find(x => x.token === token);
    if (!p) {
      const name = clean(d.name);
      if (!name) return ack({ error: 'Enter a name' });
      if (r.phase !== 'lobby') return ack({ error: 'Game already in progress' });
      if (r.players.length >= 6) return ack({ error: 'Room is full' });
      p = newPlayer(name, token); r.players.push(p);
    }
    attach(socket, r, p); ack({ ok: true, code }); push(r);
  });

  socket.on('start', (d = {}, ack = () => {}) => {
    const [r, p] = ctx(); if (!r || p.id !== r.hostId || r.phase !== 'lobby') return;
    const def = G[d.game]; if (!def) return ack({ error: 'Unknown game' });
    const n = r.players.length;
    if (n < def.min || n > def.max) return ack({ error: def.min === def.max ? `Needs exactly ${def.min} players` : `Needs ${def.min}–${def.max} players` });
    r.game = d.game; r.g = def.init(r); r.phase = r.g.win ? 'over' : 'play'; r.msg = '';
    ack({ ok: true }); push(r);
  });

  socket.on('act', (a = {}) => {
    const [r, p] = ctx(); if (!r || r.phase !== 'play' || typeof a !== 'object' || !a) return;
    const m = G[r.game].act(r, p.id, a); if (m === null) return;
    if (m) r.msg = m;
    if (r.g.win) r.phase = 'over';
    push(r);
  });

  socket.on('lobby', () => {
    const [r, p] = ctx(); if (!r || p.id !== r.hostId || r.phase === 'lobby') return;
    r.phase = 'lobby'; r.game = null; r.g = null; r.msg = ''; push(r);
  });

  socket.on('leave', () => leave(socket));

  socket.on('disconnect', () => {
    const [r, p] = ctx(); if (!r || !p || p.sock !== socket.id) return;
    p.connected = false; p.sock = null;
    const live = r.players.filter(x => x.connected);
    if (!live.length) { r.emptySince = Date.now(); return; }
    if (r.hostId === p.id) r.hostId = live[0].id;
    push(r);
  });
});

setInterval(() => { for (const [c, r] of rooms) if (r.emptySince && Date.now() - r.emptySince > 10 * 60 * 1000) rooms.delete(c); }, 60 * 1000).unref();
server.listen(PORT, () => console.log('Card Room server on :' + PORT));
module.exports = { server, io };
