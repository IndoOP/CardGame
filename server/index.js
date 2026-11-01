const express = require('express'), http = require('http'), cors = require('cors'), crypto = require('crypto');
const { Server } = require('socket.io');
const G = require('./games');

const PORT = process.env.PORT || 3001;
const ORIGIN = process.env.CLIENT_ORIGIN || '*'; // comma-separated list in production
const origin = ORIGIN === '*' ? '*' : ORIGIN.split(',').map(s => s.trim());
const TURN_OPTS = [20, 30, 45, 60, 90], MAX_ROOMS = 500, MAX_PER_IP = 25;

process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));

const rooms = new Map(), ipCount = new Map();
const app = express();
app.use(cors({ origin }));
app.get('/', (_, res) => res.json({ ok: true, rooms: rooms.size }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin }, pingInterval: 10000, pingTimeout: 15000, maxHttpBufferSize: 1e4 });

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const gen = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join(''); } while (rooms.has(c)); return c; };
const newPlayer = (name, token) => ({ id: crypto.randomBytes(4).toString('hex'), token, name, sock: null, connected: false, away: false, strikes: 0, offSince: null });
const pl = (r, id) => r.players.find(x => x.id === id);

/* ---------- state sync ---------- */
function snap(r, p) {
  return { code: r.code, hostId: r.hostId, you: p.id, phase: r.phase, game: r.game, msg: r.msg, settings: r.settings,
    deadline: r.deadline, dtotal: r.dtotal, dkind: r.dkind, now: Date.now(), startedAt: r.startedAt,
    players: r.players.map(x => ({ id: x.id, name: x.name, connected: x.connected, away: x.away })),
    g: r.game && r.g ? G[r.game].view(r, p.id) : null };
}
const push = r => r.players.forEach(p => p.sock && io.to(p.sock).emit('state', snap(r, p)));
const sayAll = (r, ev, d) => r.players.forEach(p => p.sock && io.to(p.sock).emit(ev, d));

/* ---------- turn timer / inactivity ---------- */
function arm(r) {
  r.deadline = null; r.dkind = null; r.dtotal = 0;
  if (r.phase !== 'play') return;
  const def = G[r.game];
  let ms = 0;
  if (def.between && def.between(r)) { ms = 9000; r.dkind = 'between'; }
  else if (def.waiting) {
    const id = def.waiting(r), p = id && pl(r, id); if (!p) return;
    ms = !p.connected ? 12000 : p.away ? 2500 : r.settings.turnSecs * 1000; r.dkind = 'turn';
  } else return;
  r.dtotal = ms; r.deadline = Date.now() + ms;
}
function timeout(r) {
  const def = G[r.game];
  if (r.dkind === 'between') { def.nextRound(r); arm(r); return push(r); }
  const id = def.waiting && def.waiting(r), p = id && pl(r, id);
  if (!p) { r.deadline = null; return; }
  p.strikes++; if (p.strikes >= 2) p.away = true; // two missed turns in a row: autoplay quickly until they act again
  const m = def.act(r, id, def.auto(r, id));
  if (m === null) { r.deadline = Date.now() + 3000; return; }
  r.msg = `⏱ ${p.name} ${p.away ? 'is away (auto-played)' : 'ran out of time'}. ${m}`;
  if (r.g.win) r.phase = 'over';
  arm(r); push(r);
}
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    try {
      if (r.phase !== 'play' || !r.players.some(p => p.connected)) continue;
      if (r.game === 'speed') { // real-time game: forfeit if the opponent stays disconnected
        const off = r.players.find(p => !p.connected && p.offSince && now - p.offSince > 30000);
        if (off) { r.g.win = r.players.find(p => p !== off).id; r.phase = 'over'; r.msg = `${off.name} disconnected: forfeit`; arm(r); push(r); continue; }
      }
      if (r.deadline && now >= r.deadline) timeout(r);
    } catch (e) { console.error('tick', e); }
  }
}, 500).unref();

/* ---------- room helpers ---------- */
function toLobby(r, msg) {
  r.phase = 'lobby'; r.game = null; r.g = null; r.msg = msg || ''; r.deadline = null; r.dkind = null; r.startedAt = null;
  r.players.forEach(p => { p.away = false; p.strikes = 0; });
}
function removePlayer(r, p, msg) {
  r.players = r.players.filter(x => x !== p);
  if (!r.players.length) { rooms.delete(r.code); return; }
  if (r.phase !== 'lobby') toLobby(r, msg);
  if (r.hostId === p.id) r.hostId = (r.players.find(x => x.connected) || r.players[0]).id;
  push(r);
}
function attach(socket, r, p) {
  if (socket.data.code && (socket.data.code !== r.code || socket.data.pid !== p.id)) leave(socket);
  p.sock = socket.id; p.connected = true; p.offSince = null; r.emptySince = null;
  socket.data = { code: r.code, pid: p.id };
  socket.emit('chatlog', r.chat);
  if (r.phase === 'play' && G[r.game].waiting && G[r.game].waiting(r) === p.id) arm(r);
}
function leave(socket) {
  const r = rooms.get(socket.data.code), pid = socket.data.pid; socket.data = {};
  const p = r && pl(r, pid); if (p) removePlayer(r, p, `${p.name} left, so the game ended`);
}

io.on('connection', socket => {
  const ip = String((socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '')).split(',')[0].trim();
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  if (ipCount.get(ip) > MAX_PER_IP) { socket.disconnect(true); return; }
  socket.data = {};

  // token-bucket rate limiting per socket and event class
  const buckets = {}; let lastWarn = 0;
  const allow = (key, cap, perSec) => {
    const now = Date.now(), b = buckets[key] || (buckets[key] = { t: cap, l: now });
    b.t = Math.min(cap, b.t + (now - b.l) / 1000 * perSec); b.l = now;
    if (b.t >= 1) { b.t -= 1; return true; }
    if (now - lastWarn > 2000) { lastWarn = now; socket.emit('toast', 'Slow down a little'); }
    return false;
  };
  const on = (ev, cap, perSec, fn) => socket.on(ev, (d, ack) => {
    try {
      ack = typeof ack === 'function' ? ack : () => {}; d = d && typeof d === 'object' ? d : {};
      if (!allow(ev === 'act' ? 'act' : ev === 'chat' ? 'chat' : 'ctl', cap, perSec)) return ack({ error: 'Too many requests' });
      fn(d, ack);
    } catch (e) { console.error(ev, e); try { ack({ error: 'Server error' }); } catch {} }
  });
  const ctx = () => { const r = rooms.get(socket.data.code); return [r, r && pl(r, socket.data.pid)]; };
  const hostCtx = () => { const [r, p] = ctx(); return r && p && p.id === r.hostId ? [r, p] : []; };

  on('create', 6, 0.5, (d, ack) => {
    const name = clean(d.name, 16), token = String(d.token || '');
    if (!name) return ack({ error: 'Enter a name' });
    if (token.length < 16 || token.length > 128) return ack({ error: 'Bad session' });
    if (rooms.size >= MAX_ROOMS) return ack({ error: 'Server is busy, try again later' });
    const p = newPlayer(name, token);
    const r = { code: gen(), hostId: p.id, players: [p], phase: 'lobby', game: null, g: null, msg: '', chat: [], banned: new Set(),
      settings: { turnSecs: 45, locked: false }, deadline: null, dtotal: 0, dkind: null, startedAt: null, emptySince: null };
    rooms.set(r.code, r); attach(socket, r, p); ack({ ok: true, code: r.code }); push(r);
  });

  on('join', 6, 0.5, (d, ack) => {
    const code = clean(d.code, 4).toUpperCase(), token = String(d.token || '');
    const r = rooms.get(code); if (!r) return ack({ error: 'Room not found' });
    if (token.length < 16 || token.length > 128) return ack({ error: 'Bad session' });
    if (r.banned.has(token)) return ack({ error: 'You were removed from this room' });
    let p = r.players.find(x => x.token === token);
    if (!p) {
      const name = clean(d.name, 16);
      if (!name) return ack({ error: 'Enter a name' });
      if (r.settings.locked) return ack({ error: 'Room is locked by the host' });
      if (r.phase !== 'lobby') return ack({ error: 'Game already in progress' });
      if (r.players.length >= 6) return ack({ error: 'Room is full' });
      p = newPlayer(name, token); r.players.push(p);
    }
    attach(socket, r, p); ack({ ok: true, code }); push(r);
  });

  on('start', 8, 2, (d, ack) => {
    const [r] = hostCtx(); if (!r || r.phase !== 'lobby') return ack({ error: 'Not allowed' });
    const def = G[d.game]; if (!def || !Object.prototype.hasOwnProperty.call(G, d.game)) return ack({ error: 'Unknown game' });
    const n = r.players.length;
    if (n < def.min || n > def.max) return ack({ error: def.min === def.max ? `Needs exactly ${def.min} players` : `Needs ${def.min}–${def.max} players` });
    r.players.forEach(p => { p.away = false; p.strikes = 0; });
    r.game = d.game; r.g = def.init(r); r.phase = r.g.win ? 'over' : 'play'; r.msg = r.g.note || ''; r.startedAt = Date.now();
    arm(r); ack({ ok: true }); push(r);
  });

  on('act', 14, 10, d => {
    const [r, p] = ctx(); if (!r || !p || r.phase !== 'play') return;
    const m = G[r.game].act(r, p.id, d); if (m === null) return;
    p.strikes = 0; p.away = false;
    if (m) r.msg = m;
    if (r.g.win) r.phase = 'over';
    arm(r); push(r);
  });

  on('lobby', 6, 1, () => { const [r] = hostCtx(); if (r && r.phase !== 'lobby') { toLobby(r, ''); push(r); } });

  on('settings', 8, 2, (d, ack) => {
    const [r] = hostCtx(); if (!r) return ack({ error: 'Host only' });
    if (TURN_OPTS.includes(d.turnSecs)) r.settings.turnSecs = d.turnSecs;
    if (typeof d.locked === 'boolean') r.settings.locked = d.locked;
    ack({ ok: true }); push(r);
  });

  on('kick', 6, 1, (d, ack) => {
    const [r, me] = hostCtx(); if (!r) return ack({ error: 'Host only' });
    const p = pl(r, String(d.id)); if (!p || p === me) return ack({ error: 'Cannot kick that player' });
    r.banned.add(p.token);
    if (p.sock) { io.to(p.sock).emit('kicked', 'The host removed you from the room'); const s = io.sockets.sockets.get(p.sock); if (s) s.data = {}; }
    removePlayer(r, p, `${p.name} was removed by the host, so the game ended`); ack({ ok: true });
  });

  on('makehost', 6, 1, (d, ack) => {
    const [r, me] = hostCtx(); if (!r) return ack({ error: 'Host only' });
    const p = pl(r, String(d.id)); if (!p || p === me) return ack({ error: 'Invalid player' });
    r.hostId = p.id; ack({ ok: true }); push(r);
  });

  on('chat', 5, 1.2, d => {
    const [r, p] = ctx(); if (!r || !p) return;
    const x = clean(d.text, 200); if (!x) return;
    const m = { n: p.name, i: p.id, x, t: Date.now() };
    r.chat.push(m); if (r.chat.length > 60) r.chat.shift();
    sayAll(r, 'chat', m);
  });

  on('leave', 6, 1, () => leave(socket));

  socket.on('disconnect', () => {
    ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1));
    try {
      const [r, p] = ctx(); if (!r || !p || p.sock !== socket.id) return;
      p.connected = false; p.sock = null; p.offSince = Date.now();
      const live = r.players.filter(x => x.connected);
      if (!live.length) { r.emptySince = Date.now(); return; }
      if (r.hostId === p.id) r.hostId = live[0].id;
      if (r.phase === 'play' && G[r.game].waiting && G[r.game].waiting(r) === p.id) arm(r);
      push(r);
    } catch (e) { console.error('disconnect', e); }
  });
});

setInterval(() => { for (const [c, r] of rooms) if (r.emptySince && Date.now() - r.emptySince > 10 * 60 * 1000) rooms.delete(c); }, 60 * 1000).unref();
server.listen(PORT, () => console.log('Card Room server on :' + PORT));
module.exports = { server, io, rooms };
