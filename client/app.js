(() => {
const RK = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'], SU = '♠♥♦♣';
const rk = c => c % 13, su = c => (c / 13) | 0, adj = (a, b) => { const d = Math.abs(rk(a) - rk(b)); return d === 1 || d === 12; };
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const $ = s => document.querySelector(s), app = $('#app');
const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }
};

let urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

let token = store.get('cr_token');
if (!token) {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  token = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  store.set('cr_token', token);
}

const socket = io(window.SERVER_URL, { transports: ['websocket', 'polling'] });
let st = null, prevSt = null, skew = 0;
let sel = [], selS = null, eight = null, lead = null, wild = null, usel = [];
let locked = false, lockT, lastAct = 0, unread = 0, tt, prevTurn = null;

/* ---------- Sound & Audio FX Engine (Web Audio API) ---------- */
const SFX = {
  enabled: store.get('cr_sfx') !== '0',
  ctx: null,
  getCtx() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  },
  toggle() {
    this.enabled = !this.enabled;
    store.set('cr_sfx', this.enabled ? '1' : '0');
    if (this.enabled) this.chip();
    return this.enabled;
  },
  playCard() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      // Filtered noise snap
      const bufSize = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.3));
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.setValueAtTime(1400, now); filter.Q.setValueAtTime(3, now);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.4, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      // Low thud
      const osc = ctx.createOscillator(); const oscG = ctx.createGain();
      osc.frequency.setValueAtTime(140, now); osc.frequency.exponentialRampToValueAtTime(45, now + 0.06);
      oscG.gain.setValueAtTime(0.35, now); oscG.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      osc.connect(oscG); oscG.connect(ctx.destination);
      src.start(now); osc.start(now); osc.stop(now + 0.07);
    } catch {}
  },
  drawCard() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      const bufSize = Math.floor(ctx.sampleRate * 0.08);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass';
      filter.frequency.setValueAtTime(600, now); filter.frequency.exponentialRampToValueAtTime(1800, now + 0.08);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start(now);
    } catch {}
  },
  chip() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(1760, now); osc.frequency.exponentialRampToValueAtTime(880, now + 0.04);
      gain.gain.setValueAtTime(0.25, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.05);
    } catch {}
  },
  turn() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      const playTone = (freq, start, dur) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.25, start); gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(start); osc.stop(start + dur);
      };
      playTone(523.25, now, 0.15); // C5
      playTone(659.25, now + 0.12, 0.25); // E5
      if (navigator.vibrate) navigator.vibrate(35);
    } catch {}
  },
  alert() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      [440, 554.37, 659.25].forEach((f, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f, now + i * 0.07);
        gain.gain.setValueAtTime(0.18, now + i * 0.07); gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.07 + 0.25);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.07); osc.stop(now + i * 0.07 + 0.26);
      });
      if (navigator.vibrate) navigator.vibrate([60, 50, 60]);
    } catch {}
  },
  win() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(f, now + i * 0.12);
        gain.gain.setValueAtTime(0.3, now + i * 0.12); gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.5);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 0.52);
      });
      if (navigator.vibrate) navigator.vibrate([100, 80, 150]);
    } catch {}
  },
  tick() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(900, now);
      gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.005, now + 0.03);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.035);
    } catch {}
  }
};

/* ---------- Confetti Cannon Engine ---------- */
const Confetti = {
  canvas: null, ctx: null, particles: [], animId: null,
  init() {
    this.canvas = document.getElementById('confetti-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    const resize = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
  },
  start() {
    if (!this.canvas) this.init();
    if (!this.ctx) return;
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#ec4899', '#fef08a'];
    this.particles = Array.from({ length: 90 }, () => ({
      x: window.innerWidth * (0.3 + Math.random() * 0.4),
      y: window.innerHeight * 0.5 + (Math.random() * 40 - 20),
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 15 - 5,
      size: Math.random() * 8 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 12,
      opacity: 1
    }));
    if (this.animId) cancelAnimationFrame(this.animId);
    this.loop();
  },
  loop() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = 0;
    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35; // gravity
      p.vx *= 0.98; // drag
      p.rot += p.vrot;
      p.opacity -= 0.006;
      if (p.opacity > 0 && p.y < window.innerHeight + 20) {
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    });
    if (alive > 0) this.animId = requestAnimationFrame(() => this.loop());
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
};

/* ---------- Card & Action Motion Dynamics ---------- */
function shakeTable() {
  const el = $('#layout');
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 450);
}

function tableImpact() {
  const t = $('.table');
  if (t) {
    t.classList.remove('impact');
    void t.offsetWidth;
    t.classList.add('impact');
    setTimeout(() => t.classList.remove('impact'), 300);
  }
}

function showBanner(text) {
  const layer = $('#fx-layer');
  if (!layer) return;
  const b = document.createElement('div');
  b.className = 'floating-action-banner';
  b.innerHTML = text;
  layer.appendChild(b);
  setTimeout(() => b.remove(), 1900);
}

function floatReaction(emoji, sourceEl) {
  const layer = $('#fx-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  const rect = sourceEl ? sourceEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
  el.style.left = (rect.left + (Math.random() * 30 - 15)) + 'px';
  el.style.top = (rect.top - 10) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

function flyCard(cardHtml, fromEl, toEl) {
  const layer = $('#fx-layer');
  if (!layer || !fromEl || !toEl) {
    SFX.playCard();
    tableImpact();
    return;
  }
  const f = fromEl.getBoundingClientRect();
  const t = toEl.getBoundingClientRect();
  const clone = document.createElement('div');
  clone.className = 'fly-card';
  clone.innerHTML = cardHtml;
  clone.style.left = f.left + 'px';
  clone.style.top = f.top + 'px';
  clone.style.transform = 'scale(1) rotate(0deg)';
  layer.appendChild(clone);

  requestAnimationFrame(() => {
    const dx = t.left - f.left;
    const dy = t.top - f.top;
    const rot = Math.random() * 20 - 10;
    clone.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(1.02)`;
    setTimeout(() => {
      clone.remove();
      SFX.playCard();
      tableImpact();
    }, 280);
  });
}

const name = () => store.get('cr_name');
const nm = id => (st.players.find(p => p.id === id) || {}).name || '?';
const mobile = () => matchMedia('(max-width:899px)').matches;

function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove('show'), 2600);
}

function copy(text, msg) {
  const done = () => toast(msg || 'Copied');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => toast('Copy failed'));
  else {
    const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a);
    a.select(); try { document.execCommand('copy'); done(); } catch { toast('Copy failed'); } a.remove();
  }
}

const inviteUrl = () => location.origin + location.pathname + '?room=' + st.code;
async function invite() {
  const url = inviteUrl();
  if (navigator.share && matchMedia('(pointer:coarse)').matches) {
    try { await navigator.share({ title: 'Card Room', text: 'Join my card game!', url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copy(url, 'Invite link copied');
}
function setUrl(code) { try { history.replaceState(null, '', code ? '?room=' + code : location.pathname); } catch {} }

/* ---------- Socket Handlers ---------- */
socket.on('connect', () => {
  $('#conn').classList.remove('show');
  const saved = store.get('cr_code'), c = urlRoom || saved;
  if (c && (name() || c === saved)) rejoin(c);
});
const down = () => { const c = $('#conn'); c.textContent = 'Reconnecting…'; c.classList.add('show'); };
socket.on('disconnect', down); socket.on('connect_error', down);

socket.on('state', s => {
  prevSt = st;
  st = s;
  skew = s.now - Date.now();
  locked = false;

  // Sound effects on notable state changes
  if (st.phase === 'play') {
    const curTurn = waitId();
    if (curTurn === st.you && prevTurn !== st.you) {
      SFX.turn();
    }
    prevTurn = curTurn;

    // Check if new action message happened
    if (st.msg && (!prevSt || prevSt.msg !== st.msg)) {
      if (st.msg.includes('WAR!')) {
        SFX.alert();
        shakeTable();
        showBanner('⚔️ WAR DECLARED!');
      } else if (st.msg.includes('beats')) {
        SFX.playCard();
      } else if (st.msg.includes('BLACKJACK')) {
        SFX.alert();
        shakeTable();
        showBanner('🔥 NATURAL BLACKJACK!');
      } else if (st.msg.includes('busted')) {
        SFX.alert();
        showBanner('💥 BUSTED!');
      } else if (st.msg.includes('honest')) {
        SFX.alert();
        showBanner('🎯 HONEST! BLUFF CALLED!');
      } else if (st.msg.includes('a bluff')) {
        SFX.alert();
        showBanner('💥 BLUFF CAUGHT!');
      } else if (st.msg.includes('shouts UNO')) {
        SFX.alert();
        showBanner('📢 UNO!');
      }
    }
  }

  if (st.phase === 'over' && (!prevSt || prevSt.phase !== 'over')) {
    SFX.win();
    Confetti.start();
  }

  render();
});

socket.on('reaction', r => {
  SFX.chip();
  const chipEl = document.querySelector(`.chip[data-pid="${r.id}"]`) || $('.table');
  floatReaction(r.emoji, chipEl);
});

socket.on('toast', toast);
socket.on('kicked', m => { reset(); toast(m); });
socket.on('chatlog', l => { $('#clog').innerHTML = ''; l.forEach(m => addChat(m, true)); });
socket.on('chat', m => addChat(m));

function rejoin(code) {
  socket.emit('join', { code, name: name(), token }, r => {
    if (r && r.ok) { store.set('cr_code', code); setUrl(code); }
    else if (r && r.error) { store.set('cr_code', ''); if (st) reset(); setUrl(''); toast(r.error); }
  });
}

function reset() {
  urlRoom = ''; st = null; prevSt = null; sel = []; selS = null; eight = null; usel = []; wild = null; lead = null;
  store.set('cr_code', ''); setUrl(''); document.body.classList.remove('side-open'); render();
}

function send(a, fast) {
  const now = Date.now();
  if (locked && !fast) return;
  if (now - lastAct < (fast ? 60 : 150)) return;
  lastAct = now;
  if (!fast) {
    locked = true;
    clearTimeout(lockT);
    lockT = setTimeout(() => { locked = false; }, 800);
  }
  socket.emit('act', a);
}

/* ---------- Chat ---------- */
function addChat(m, quiet) {
  const log = $('#clog'), d = document.createElement('div'), b = document.createElement('b');
  d.className = 'cm' + (st && m.i === st.you ? ' me' : ''); b.textContent = m.n; d.append(b, document.createTextNode(m.x));
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.appendChild(d);
  while (log.children.length > 80) log.firstChild.remove();
  if (near || (st && m.i === st.you)) log.scrollTop = log.scrollHeight;
  if (!quiet && mobile() && !document.body.classList.contains('side-open') && !(st && m.i === st.you)) {
    unread++; const bd = $('#badge'); bd.textContent = unread; bd.hidden = false;
  }
}
$('#cform').addEventListener('submit', e => {
  e.preventDefault();
  const i = $('#cin'), t = i.value.trim();
  if (!t) return;
  socket.emit('chat', { text: t });
  i.value = '';
});
$('#fab').addEventListener('click', () => {
  document.body.classList.add('side-open');
  unread = 0; $('#badge').hidden = true;
  const l = $('#clog'); l.scrollTop = l.scrollHeight;
});
$('#sclose').addEventListener('click', () => document.body.classList.remove('side-open'));

/* ---------- Card Renderers ---------- */
const card = (c, o = {}) => {
  const red = su(c) === 1 || su(c) === 2 ? ' red' : '';
  const t = RK[rk(c)] + SU[su(c)];
  const tag = o.btn ? 'button' : 'div';
  const fanStyle = o.fan ? `style="transform: rotate(${o.fan.rot}deg) translateY(${o.fan.y}px);"` : '';
  return `<${tag} class="card${red} ${o.cls || ''}" ${fanStyle} ${o.attrs || ''} aria-label="${t}"><i class="tl">${RK[rk(c)]}\n${SU[su(c)]}</i><b class="mid">${SU[su(c)]}</b><i class="br">${RK[rk(c)]}\n${SU[su(c)]}</i></${tag}>`;
};

const back = (cls = '', style = '') => `<div class="card back ${cls}" style="${style}"></div>`;

const UNO = [];
for (let c = 0; c < 4; c++) { UNO.push({ c, v: 0 }); for (let v = 1; v <= 12; v++) UNO.push({ c, v }, { c, v }); }
for (let i = 0; i < 4; i++) UNO.push({ c: 4, v: 13 }, { c: 4, v: 14 });
const UL = v => v <= 9 ? String(v) : ['⊘', '⇄', '+2', '★', '+4'][v - 10], UC = ['Red', 'Yellow', 'Green', 'Blue'];

const ucard = (c, o = {}) => {
  const l = UL(UNO[c].v), tag = o.btn ? 'button' : 'div';
  const fanStyle = o.fan ? `style="transform: rotate(${o.fan.rot}deg) translateY(${o.fan.y}px);"` : '';
  return `<${tag} class="card uno u${UNO[c].c} ${o.cls || ''}" ${fanStyle} ${o.attrs || ''}><i class="tl">${l}</i><b class="mid"><span>${l}</span></b><i class="br">${l}</i></${tag}>`;
};
const uPlayable = (g, c) => { const u = UNO[c]; return u.c === 4 || u.c === g.color || u.v === UNO[g.top].v; };

/* Helper for card hand fanning */
function cardFan(index, total) {
  if (total <= 1) return { rot: 0, y: 0 };
  const spread = Math.min(2.8, 32 / total);
  const rot = (index - (total - 1) / 2) * spread;
  const y = Math.abs(index - (total - 1) / 2) * 2;
  return { rot: rot.toFixed(1), y: y.toFixed(1) };
}

/* ---------- Shared View Bits ---------- */
function waitId() {
  const g = st.g; if (!g || st.phase !== 'play') return null;
  if (st.game === 'uno') return g.between || g.win ? null : g.pickColor || (g.challenge && g.challenge.by) || g.turn;
  if (st.game === 'speed') return null;
  if (st.game === 'war') {
    const me = st.you;
    if (g.ready && !g.ready[me]) return me;
    return null;
  }
  return g.turn;
}

const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const tbar = () => st.phase !== 'play' ? '' : st.game === 'speed' ? '<div class="tbar"><span id="ttxt">⏱ 0:00</span></div>'
  : st.deadline ? '<div class="tbar"><i id="tfill"></i><span id="ttxt"></span></div>' : '';

setInterval(() => {
  if (!st || st.phase !== 'play') return;
  const t = $('#ttxt'); if (!t) return;
  if (st.game === 'speed') {
    t.textContent = '⏱ ' + fmt(Math.max(0, Math.floor((Date.now() + skew - st.startedAt) / 1000)));
    return;
  }
  const f = $('#tfill'); if (!f || !st.deadline) return;
  const rem = Math.max(0, st.deadline - (Date.now() + skew)), who = waitId();
  f.style.width = (st.dtotal ? rem / st.dtotal * 100 : 0) + '%';
  f.parentNode.classList.toggle('low', rem < 8000 && st.dkind === 'turn');
  if (rem < 7000 && rem > 1000 && Math.floor(rem / 1000) !== Math.floor((rem + 250) / 1000)) {
    SFX.tick();
  }
  t.textContent = (st.dkind === 'between' ? 'Next round in ' : who === st.you ? '👉 Your turn · ' : who ? nm(who) + "'s turn · " : '') + Math.ceil(rem / 1000) + 's';
}, 250);

const chips = (turn, info) => `<div class="chips">${st.players.map(p =>
  `<div class="chip ${p.id === turn ? 'turn' : ''} ${p.connected ? '' : 'off'}" data-pid="${p.id}">
    <span class="dot"></span>${esc(p.name)}${p.id === st.you ? ' (you)' : ''}${p.away ? ' · away' : ''}
    ${info ? `<b>${info(p.id)}</b>` : ''}
  </div>`
).join('')}</div>`;

const reactionDock = () => `
  <div class="reaction-bar" aria-label="Quick reactions">
    ${['👏', '🔥', '😮', '😂', '🃏', '💀', '💥', '⚔️'].map(e =>
      `<button class="reaction-btn" data-a="react" data-emoji="${e}" title="React with ${e}">${e}</button>`
    ).join('')}
  </div>
`;

const board = () => {
  const g = st.g, sc = g.scores;
  return `<div class="score">${[...st.players].sort((a, b) => sc[b.id] - sc[a.id]).map(p =>
    `<div><span>${esc(p.name)}</span><span class="bar"><i style="width:${Math.min(100, sc[p.id] / (g.target || 500) * 100)}%"></i></span><b>${sc[p.id]}</b></div>`
  ).join('')}</div>`;
};

const over = () => {
  if (st.phase !== 'over') return '';
  const w = st.g.win, host = st.hostId === st.you;
  return `<div class="winner">
    <div class="trophy">🏆</div>
    <h2>${w === 'tie' ? "It's a draw!" : w === st.you ? '🎉 You Win the Match!' : esc(nm(w)) + ' Wins the Match!'}</h2>
    ${st.game === 'uno' ? board() : ''}
    ${host ? '<button class="btn" data-a="lobby">Back to Lobby</button>' : '<p class="mut">Waiting for the host…</p>'}
  </div>`;
};

const picker = (act, ex = '') => `<div class="picker">${UC.map((n, i) =>
  `<button class="btn u${i} swatch" data-a="${act}" data-k="${i}" style="${ex}">${n}</button>`
).join('')}</div>`;

/* ---------- Home View ---------- */
function home() {
  document.body.classList.remove('inroom');
  $('#hdr').innerHTML = `
    <span class="brand">🃏 Card Room</span>
    <div class="hdr-r">
      <button class="sfx-btn" data-a="toggle-sfx" title="Toggle sound">${SFX.enabled ? '🔊' : '🔇'}</button>
    </div>
  `;
  app.innerHTML = `
    <section class="hero">
      <h1>Card Room</h1>
      <p class="mut">Fast-paced, real-time multiplayer card games. Play Bluff, Speed, Crazy Eights, UNO, War, and Blackjack with friends.</p>
    </section>
    ${urlRoom ? `<div class="panel invite"><h2>You're invited to room <span class="mono">${esc(urlRoom)}</span></h2><p class="mut" style="margin:0">Enter your name to join the game.</p></div>` : ''}
    <div class="panel">
      <label for="name">Your name</label>
      <input id="name" maxlength="16" placeholder="e.g. Alex" value="${esc(name())}" autocomplete="nickname">
      <div class="row" style="margin-top:12px">
        ${urlRoom ? `<button class="btn" data-a="join" data-code="${esc(urlRoom)}">Join Room ${esc(urlRoom)}</button>` : '<button class="btn" data-a="create">Create Room</button>'}
      </div>
    </div>
    <div class="panel">
      <label for="code">${urlRoom ? 'Or enter' : 'Have a'} room code${urlRoom ? '' : '?'}</label>
      <div class="row">
        <input id="code" maxlength="4" placeholder="ABCD" autocomplete="off">
        <button class="btn ghost" data-a="join">Join</button>
      </div>
      ${urlRoom ? '<div class="row" style="margin-top:10px"><button class="btn ghost" data-a="create">Create a new room instead</button></div>' : ''}
    </div>
  `;
}

/* ---------- Lobby View ---------- */
function lobby() {
  const host = st.hostId === st.you, n = st.players.length, fit = (a, b) => n >= a && n <= b;
  const games = [
    ['war', '⚔️ War', 'Fast-paced 2-player card duel. Highest card wins the trick; ties declare high-stakes WAR with face-down spoils!', '2 players', fit(2, 2), true],
    ['blackjack', '🃏 Blackjack Duel', 'Head-to-head 21 showdown. Hit or stand to outplay your opponent in a best-of-5 rounds casino duel.', '2 players', fit(2, 2), true],
    ['speed', '⚡ Speed', 'Real-time card slinging. Play cards one rank above or below center piles. Fast reflexes win!', '2 players', fit(2, 2), true],
    ['bluff', '🎭 Bluff', 'Shed your hand. Lie about what you play, call out bluffs, or pass if you dare. High drama!', '2–6 players', fit(2, 6), false],
    ['crazy8', '🎱 Crazy Eights', 'Match suit or rank. Eights are wild! Clear your hand first to claim victory.', '2–6 players', fit(2, 6), false],
    ['uno', '🌈 UNO', 'Classic rules, multi-card plays, Wild challenges, and 500-point match scoring.', '2–6 players', fit(2, 6), false]
  ];

  return `
    <div class="panel">
      <h2>Invite Friends</h2>
      <div class="row">
        <input readonly value="${esc(inviteUrl())}" onclick="this.select()" aria-label="Invite link">
        <button class="btn" data-a="invite">${navigator.share && matchMedia('(pointer:coarse)').matches ? 'Share' : 'Copy link'}</button>
      </div>
      <p class="help" style="text-align:left">${n} player${n > 1 ? 's' : ''} in room · up to 6 · turn timer ${st.settings.turnSecs}s${st.settings.locked ? ' · 🔒 locked' : ''}</p>
    </div>
    ${st.msg ? `<p class="msg">${esc(st.msg)}</p>` : ''}
    <div class="games">
      ${games.map(g => `
        <div class="game">
          <h3>${g[1]} ${g[5] ? '<span class="badge-2p">2 Players</span>' : ''}</h3>
          <p>${g[2]}</p>
          <span class="tag">${g[3]}</span>
          <button class="btn" data-a="start" data-g="${g[0]}" ${host && g[4] ? '' : 'disabled'}>
            ${host ? (g[4] ? 'Start Game' : 'Need ' + g[3]) : 'Host starts'}
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

/* ---------- Bluff View ---------- */
function bluff() {
  const g = st.g, me = st.you, myT = st.phase === 'play' && g.turn === me, L = g.last, lastEmpty = L && g.counts[L.uid] === 0;
  sel = sel.filter(c => g.hand.includes(c)); if (!myT) lead = null;
  let h = tbar() + chips(st.phase === 'play' ? g.turn : null, id => g.counts[id] + ' cards');
  h += `<div class="table">
    <div class="pile">${g.pileN ? back('pop') : '<div class="card empty"></div>'}<span>Pile: ${g.pileN} cards</span></div>
    <div class="status" style="color:#fff">${L ? `${esc(nm(L.uid))} claims: <b>${L.n} × ${RK[L.rank]}</b>` : 'Leading a new round'}</div>
  </div>`;
  if (g.reveal) {
    h += `<div class="reveal">${esc(nm(g.reveal.uid))} had: ${g.reveal.cards.map(c => card(c, { cls: 'mini pop' + (rk(c) === g.reveal.rank ? ' glow' : ' dim') })).join('')}</div>`;
  }
  if (st.phase === 'play') {
    h += `<div class="status ${myT ? 'highlight' : ''}">${myT ? '👉 Your Turn' : esc(nm(g.turn)) + "'s turn"}${L ? ` · claim <b>${RK[g.rank]}</b>` : ' · choose rank to lead'}</div>`;
  }
  if (myT && !L) {
    h += `<p class="help">You lead: pick the rank you will claim</p><div class="row c" style="gap:6px">${RK.map((r, i) => `<button class="btn sm ${lead === i ? '' : 'ghost'}" data-a="brank" data-r="${i}">${r}</button>`).join('')}</div>`;
  }
  const tot = g.hand.length;
  h += `<div class="hand${tot > 12 ? ' dense' : ''}">
    ${g.hand.map((c, idx) => card(c, { btn: 1, fan: cardFan(idx, tot), cls: sel.includes(c) ? 'sel' : '', attrs: `data-a="bsel" data-c="${c}" id="c-${c}"` })).join('')}
  </div>`;
  if (myT) {
    h += `<div class="row c">${lastEmpty
      ? `<button class="btn warn" data-a="accept">Accept: ${esc(nm(L.uid))} went out</button><button class="btn danger" data-a="call">Call Bluff!</button>`
      : `<button class="btn" data-a="bplay" ${sel.length && (L || lead !== null) ? '' : 'disabled'}>Play ${sel.length || ''} as ${RK[L ? g.rank : lead === null ? 0 : lead]}</button>${L ? '<button class="btn ghost" data-a="pass">Pass</button><button class="btn danger" data-a="call">Call Bluff!</button>' : ''}`}
    </div>`;
  }
  h += `<p class="help">Select 1–4 cards and claim they match the rank. Call bluffs if you think they're lying!</p>${reactionDock()}`;
  return h;
}

/* ---------- Speed View ---------- */
function speed() {
  const g = st.g, me = st.you, opp = st.players.find(p => p.id !== me), mc = g.counts[me], oc = g.counts[opp.id];
  const info = (p, c) => `<div class="chips"><div class="chip ${p.connected ? '' : 'off'}" data-pid="${p.id}"><span class="dot"></span>${esc(p.name)}${p.id === me ? ' (you)' : ''} <b>hand: ${c.hand}</b><b>draw: ${c.draw}</b><b>spare: ${c.res}</b></div></div>`;
  if (selS !== null && !g.hand.includes(selS)) selS = null;
  const piles = g.tops.map((c, i) => c === null ? '<div class="card big empty"></div>' : card(c, { btn: 1, cls: 'big' + (selS !== null && adj(selS, c) ? ' glow' : ''), attrs: `data-a="spile" data-p="${i}" id="spile-${i}"` })).join('');
  const tot = g.hand.length;
  return `${tbar()}${info(opp, oc)}
  <div class="table">${piles}</div>
  ${info(st.players.find(p => p.id === me), mc)}
  <div class="hand">
    ${g.hand.map((c, idx) => {
      const playable = g.tops.some(t => t !== null && adj(c, t));
      return card(c, { btn: 1, fan: cardFan(idx, tot), cls: (c === selS ? 'sel ' : '') + (playable ? 'playable' : ''), attrs: `data-a="scard" data-c="${c}" id="c-${c}"` });
    }).join('')}
  </div>
  <p class="help">Tap a card to play it on a pile one rank higher or lower (A–K wraps). Be fast!</p>${reactionDock()}`;
}

/* ---------- Crazy Eights View ---------- */
function crazy8() {
  const g = st.g, me = st.you, myT = st.phase === 'play' && g.turn === me, t = g.top;
  const ok = c => rk(c) === 7 || su(c) === g.suit || rk(c) === rk(t), stuck = !g.hand.some(ok);
  let h = tbar() + chips(st.phase === 'play' ? g.turn : null, id => g.counts[id] + ' cards');
  h += `<div class="table">
    <div class="pile" id="c8-draw">${g.drawN ? back() : '<div class="card empty"></div>'}<span>Draw (${g.drawN})</span></div>
    <div class="pile" id="c8-disc">${card(t, { cls: 'big pop' })}<span>Suit: <b style="color:${g.suit === 1 || g.suit === 2 ? '#ff8a8a' : '#fff'}">${SU[g.suit]}</b></span></div>
  </div>`;
  if (st.phase === 'play') {
    h += `<div class="status ${myT ? 'highlight' : ''}">${myT ? '👉 Your Turn' : esc(nm(g.turn)) + "'s turn"}</div>`;
  }
  if (eight !== null && myT) {
    h += `<div class="status">Choose Suit for your 8:</div><div class="picker">${[0, 1, 2, 3].map(s => `<button class="btn suit ${s === 1 || s === 2 ? 'red' : ''}" data-a="suit" data-s="${s}">${SU[s]}</button>`).join('')}</div>`;
  }
  const tot = g.hand.length;
  h += `<div class="hand${tot > 12 ? ' dense' : ''}">
    ${g.hand.map((c, idx) => {
      const legal = myT && ok(c);
      return card(c, { btn: 1, fan: cardFan(idx, tot), cls: (myT && !ok(c) ? 'dim ' : '') + (c === eight ? 'sel ' : '') + (legal ? 'playable' : ''), attrs: `data-a="c8" data-c="${c}" id="c-${c}" ${legal ? '' : 'data-no="1"'}` });
    }).join('')}
  </div>`;
  if (myT && stuck) {
    h += `<div class="row c"><button class="btn warn" data-a="draw">${g.drawN ? 'Draw a Card' : 'Pass'}</button></div>`;
  }
  h += `<p class="help">Match the suit or rank. Eights are wild. Draw if you have no playable card.</p>${reactionDock()}`;
  return h;
}

/* ---------- UNO View ---------- */
function unoView() {
  const g = st.g, me = st.you, play = st.phase === 'play' && !g.between;
  const myT = play && !g.pickColor && !g.challenge && g.turn === me;
  usel = usel.filter(c => g.hand.includes(c)); if (!myT) usel = [];
  if (wild !== null && (!myT || !g.hand.includes(wild))) wild = null;
  const first = usel.length ? UNO[usel[0]] : null;
  const can = c => {
    if (!myT) return false;
    if (first) return c === usel[0] || (UNO[c].v === first.v && UNO[c].c !== 4);
    return g.drawn !== null ? c === g.drawn : uPlayable(g, c);
  };
  let h = tbar() + chips(play ? waitId() : null, id => g.counts[id] + ' cards · ' + g.scores[id] + 'pts');
  h += `<div class="table">
    <div class="pile" id="uno-draw">${g.drawN ? '<div class="card uno u4"><b class="mid"><span>UNO</span></b></div>' : '<div class="card empty"></div>'}<span>Draw (${g.drawN})</span></div>
    <div class="pile" id="uno-disc">${ucard(g.top, { cls: 'big pop' })}<span>Colour <b class="swatch u${g.color}">${UC[g.color]}</b> · ${g.dir === 1 ? '↻ Clockwise' : '↺ Counter'}</span></div>
  </div>`;
  if (g.between) {
    h += `<div class="winner"><h2>${g.roundWin === me ? '🎉 You Win' : esc(nm(g.roundWin)) + ' Wins'} Round ${g.round}!</h2><p class="mut">+${g.roundPts} points · First to ${g.target} wins match</p>${board()}</div>`;
  } else if (play) {
    let s;
    if (g.pickColor) s = g.pickColor === me ? '🎨 You are dealer: choose the starting colour' : esc(nm(g.pickColor)) + ' is choosing starting colour';
    else if (g.challenge) s = g.challenge.by === me ? `Wild +4 from ${esc(nm(g.challenge.player))}: challenge it or draw 4?` : `${esc(nm(g.challenge.by))} may challenge Wild +4`;
    else s = myT ? (g.drawn !== null ? '👉 Play drawn card or pass' : '👉 Your Turn') : esc(nm(g.turn)) + "'s turn";
    h += `<div class="status ${myT ? 'highlight' : ''}">${s}</div>`;
    if (g.pickColor === me) h += picker('dealer');
    if (g.challenge && g.challenge.by === me) h += '<div class="row c"><button class="btn danger" data-a="challenge">Challenge (+6 if false, +4 if caught)</button><button class="btn warn" data-a="accept">Draw 4</button></div>';
    if (wild !== null) h += `<div class="status">Choose Colour:</div>${picker('ucolor')}`;
  }
  const tot = g.hand.length;
  h += `<div class="hand${tot > 10 ? ' dense' : ''}">
    ${g.hand.map((c, idx) => {
      const ok = can(c);
      return ucard(c, { btn: 1, fan: cardFan(idx, tot), cls: (myT && !ok ? 'dim ' : '') + (usel.includes(c) || c === wild ? 'sel ' : '') + (ok ? 'playable' : ''), attrs: `data-a="uplay" data-c="${c}" id="c-${c}" ${ok ? '' : 'data-no="1"'}` });
    }).join('')}
  </div>`;
  const risk = g.unoRisk;
  h += `<div class="row c">
    ${myT && usel.length ? `<button class="btn" data-a="uplaysel">Play ${usel.length} Card${usel.length > 1 ? 's' : ''}</button><button class="btn ghost" data-a="uclear">Clear</button>`
      : myT ? (g.drawn === null ? '<button class="btn warn" data-a="udraw">Draw a Card</button>' : '<button class="btn ghost" data-a="upass">Keep &amp; Pass</button>') : ''}
    ${play && g.hand.length <= 2 && g.hand.length > 0 ? `<button class="btn ${risk === me ? 'danger pulse' : 'ghost'}" data-a="uuno">📢 Say UNO!</button>` : ''}
    ${risk && risk !== me ? `<button class="btn danger pulse" data-a="ucatch">🚨 Catch ${esc(nm(risk))}!</button>` : ''}
  </div>`;
  h += `<p class="help">Match colour or symbol. Multi-card play is allowed for matching numbers. Say UNO before your next turn or get caught (+2)!</p>${reactionDock()}`;
  return h;
}

/* ---------- NEW GAME 1: War (Card Duel) View ---------- */
function warView() {
  const g = st.g, me = st.you, opp = st.players.find(p => p.id !== me);
  const myCounts = g.counts[me], oppCounts = g.counts[opp.id];
  const myPlayed = g.played[me], oppPlayed = g.played[opp.id];
  const iReady = g.ready && g.ready[me];
  const oppReady = g.ready && g.ready[opp.id];

  let h = tbar();
  h += chips(null, id => `Deck: ${g.counts[id].draw} · Won: ${g.counts[id].won}`);

  h += `<div class="table">
    <div class="duel-arena">
      <div class="duel-side">
        <span class="duel-label">${esc(opp.name)} ${oppReady ? '✓ Ready' : '…'}</span>
        ${oppPlayed !== undefined ? card(oppPlayed, { cls: 'pop' }) : oppReady ? back('pop') : '<div class="card empty"></div>'}
      </div>

      <div class="duel-vs">VS</div>

      <div class="duel-side">
        <span class="duel-label">You ${iReady ? '✓ Ready' : '…'}</span>
        ${myPlayed !== undefined ? card(myPlayed, { cls: 'pop' }) : iReady ? back('pop') : '<div class="card empty"></div>'}
      </div>
    </div>

    ${g.isWar ? `<div class="war-banner">⚔️ WAR DECLARED! ⚔️</div>` : ''}
    <div class="pile" style="margin-top:6px">
      <span>Bounty at stake: <b>${g.bountyN} cards</b> · Round ${g.round}</span>
    </div>
  </div>`;

  if (st.phase === 'play') {
    if (iReady && !oppReady) {
      h += `<div class="status">Waiting for ${esc(opp.name)} to battle…</div>`;
    } else if (!iReady) {
      h += `<div class="status highlight">👉 Ready for battle! Flip your card</div>`;
      h += `<div class="row c">
        <button class="btn warn" style="font-size:17px; padding:14px 28px" data-a="wflip" id="btn-war-flip">
          ⚔️ BATTLE! (Flip Card)
        </button>
      </div>`;
    }
  }

  // Display previous trick history if available
  if (g.history && !iReady) {
    const hist = g.history;
    const wonMe = hist.winner === me;
    const tied = hist.winner === null;
    h += `<div class="status" style="font-size:15px; color:${wonMe ? 'var(--ac)' : tied ? 'var(--danger)' : 'var(--gold)'}">
      ${tied ? '⚔️ War was triggered by tie!' : wonMe ? `🎉 You won the battle (+${hist.count} cards)` : `${esc(nm(hist.winner))} won the battle (+${hist.count} cards)`}
    </div>`;
  }

  h += `<p class="help">High card takes both! Aces are high. Ties trigger WAR with 3 face-down spoils cards!</p>${reactionDock()}`;
  return h;
}

/* ---------- NEW GAME 2: Blackjack Duel (21 Showdown) View ---------- */
function bjView() {
  const g = st.g, me = st.you, opp = st.players.find(p => p.id !== me);
  const myT = st.phase === 'play' && !g.between && g.turn === me;
  const myScore = g.scores[me], oppScore = g.scores[opp.id];

  let h = tbar();
  h += `<div class="chips">
    <div class="chip ${st.phase === 'play' && g.turn === opp.id ? 'turn' : ''}" data-pid="${opp.id}">
      <span class="dot"></span>${esc(opp.name)}
      <span class="round-dots">${Array.from({ length: g.target }).map((_, i) => `<span class="round-dot ${i < oppScore ? 'won' : ''}"></span>`).join('')}</span>
      <b>${g.stood[opp.id] ? 'Stood' : 'Playing'}</b>
    </div>
    <div class="chip ${myT ? 'turn' : ''}" data-pid="${me}">
      <span class="dot"></span>You
      <span class="round-dots">${Array.from({ length: g.target }).map((_, i) => `<span class="round-dot ${i < myScore ? 'won' : ''}"></span>`).join('')}</span>
      <b>${g.stood[me] ? 'Stood' : 'Playing'}</b>
    </div>
  </div>`;

  h += `<div class="table">
    <div class="duel-arena">
      <div class="duel-side">
        <span class="duel-label">${esc(opp.name)}</span>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:center">
          ${g.oppHand.map(c => card(c, { cls: 'pop' })).join('')}
          ${Array.from({ length: Math.max(0, g.oppTotalCount - g.oppHand.length) }).map(() => back('pop')).join('')}
        </div>
        <div class="bj-val-chip ${g.oppVal > 21 ? 'bust' : ''}">Total: ${g.oppVal !== null ? g.oppVal : '?'}</div>
      </div>

      <div class="duel-vs">21</div>

      <div class="duel-side">
        <span class="duel-label">Your Hand</span>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:center">
          ${g.hand.map(c => card(c, { cls: 'pop' })).join('')}
        </div>
        <div class="bj-val-chip ${g.val > 21 ? 'bust' : g.val === 21 ? 'nat' : ''}">Total: ${g.val} ${g.val > 21 ? '(Bust!)' : g.val === 21 ? '★ 21' : ''}</div>
      </div>
    </div>
  </div>`;

  if (g.between) {
    const res = g.roundResult;
    h += `<div class="winner">
      <h2>Round ${g.round} Result</h2>
      <p style="font-size:16px; font-weight:700">${esc(g.roundMsg)}</p>
      <p class="mut">First to ${g.target} round wins takes match (${myScore} - ${oppScore})</p>
    </div>`;
  } else if (st.phase === 'play') {
    h += `<div class="status ${myT ? 'highlight' : ''}">${myT ? '👉 Your Turn: Hit or Stand?' : esc(nm(g.turn)) + "'s turn to decide"}</div>`;
    if (myT) {
      h += `<div class="row c" style="gap:14px; margin-top:8px">
        <button class="btn warn" style="font-size:16px; padding:12px 24px" data-a="bjhit" id="btn-bj-hit">🃏 Hit (+ Card)</button>
        <button class="btn ghost" style="font-size:16px; padding:12px 24px" data-a="bjstand" id="btn-bj-stand">✋ Stand (${g.val})</button>
      </div>`;
    }
  }

  h += `<p class="help">Get closest to 21 without going over. Face cards are 10, Aces 1 or 11. First to ${g.target} wins takes the match!</p>${reactionDock()}`;
  return h;
}

/* ---------- Main Room View ---------- */
function room() {
  if (st.phase === 'lobby') return lobby();
  const gameViews = {
    bluff,
    speed,
    crazy8,
    uno: unoView,
    war: warView,
    blackjack: bjView
  };
  const viewFn = gameViews[st.game] || (() => '<p>Unknown game</p>');
  return (st.msg ? `<p class="msg">${esc(st.msg)}</p>` : '') + viewFn() + over();
}

/* ---------- Sidebar View ---------- */
function side() {
  const host = st.hostId === st.you;
  $('#plist').innerHTML = st.players.map(p => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="dot"></span>
      <span class="nm">${esc(p.name)}${p.id === st.you ? ' (you)' : ''}</span>
      ${p.id === st.hostId ? '<span class="tag gold">host</span>' : ''}
      ${p.away ? '<span class="tag">away</span>' : ''}
      ${!p.connected ? '<span class="tag">offline</span>' : ''}
      ${host && p.id !== st.you ? `
        <button class="ico" data-a="makehost" data-id="${p.id}" title="Make host" aria-label="Make host">👑</button>
        <button class="ico" data-a="kick" data-id="${p.id}" title="Remove player" aria-label="Remove player">✕</button>
      ` : ''}
    </li>
  `).join('');

  const hc = $('#hostctl');
  if (!host) { hc.innerHTML = ''; return; }
  if (hc.contains(document.activeElement) && hc.firstChild) {
    $('#turnSecs').value = st.settings.turnSecs;
    $('#lock').checked = st.settings.locked;
    $('#endg').hidden = st.phase === 'lobby';
    return;
  }
  hc.innerHTML = `
    <b>Host Controls</b>
    <label>Turn timer <select id="turnSecs">${[20, 30, 45, 60, 90].map(s => `<option value="${s}" ${st.settings.turnSecs === s ? 'selected' : ''}>${s}s</option>`).join('')}</select></label>
    <label><input type="checkbox" id="lock" ${st.settings.locked ? 'checked' : ''}> Lock room (no new players)</label>
    <button class="btn ghost sm" id="endg" data-a="lobby" ${st.phase === 'lobby' ? 'hidden' : ''}>End game · Back to lobby</button>
  `;
}

/* ---------- Render ---------- */
function render() {
  if (!st) return home();
  document.body.classList.add('inroom');
  $('#hdr').innerHTML = `
    <span class="brand">🃏 Card Room</span>
    <div class="hdr-r">
      <button class="sfx-btn" data-a="toggle-sfx" title="Toggle sound">${SFX.enabled ? '🔊' : '🔇'}</button>
      <button class="code-chip" data-a="copycode" title="Copy room code">${esc(st.code)}</button>
      <button class="btn sm" data-a="invite">Invite</button>
      <button class="btn sm ghost" data-a="leave">Leave</button>
    </div>
  `;
  app.innerHTML = room();
  side();
}

/* ---------- Click Events Delegation ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]');
  if (!t || t.disabled) return;
  const a = t.dataset.a, g = st && st.g;

  if (a === 'toggle-sfx') {
    SFX.toggle();
    render();
    return;
  }

  if (a === 'react') {
    const emoji = t.dataset.emoji;
    socket.emit('reaction', { emoji });
    SFX.chip();
    floatReaction(emoji, t);
    return;
  }

  if (a === 'create' || a === 'join') {
    const n = $('#name').value.trim().slice(0, 16), code = (t.dataset.code || $('#code').value).trim().toUpperCase();
    if (!n) return toast('Enter your name first');
    store.set('cr_name', n);
    SFX.chip();
    const cb = r => {
      if (r && r.ok) { store.set('cr_code', r.code || code); setUrl(r.code || code); }
      else if (r && r.error) toast(r.error);
    };
    if (a === 'create') socket.emit('create', { name: n, token }, cb);
    else {
      if (code.length !== 4) return toast('Enter the 4-letter room code');
      socket.emit('join', { code, name: n, token }, cb);
    }
  }
  else if (a === 'leave') { SFX.chip(); socket.emit('leave'); reset(); }
  else if (a === 'invite') { SFX.chip(); invite(); }
  else if (a === 'copycode') { SFX.chip(); copy(st.code, 'Room code copied'); }
  else if (a === 'start') { SFX.chip(); socket.emit('start', { game: t.dataset.g }, r => r && r.error && toast(r.error)); }
  else if (a === 'lobby') {
    SFX.chip();
    if (st.phase === 'lobby' || st.phase === 'over' || confirm('End the current game for everyone?')) socket.emit('lobby');
  }
  else if (a === 'kick') { if (confirm('Remove this player from the room?')) socket.emit('kick', { id: t.dataset.id }, r => r && r.error && toast(r.error)); }
  else if (a === 'makehost') socket.emit('makehost', { id: t.dataset.id }, r => r && r.error && toast(r.error));

  /* Bluff */
  else if (a === 'bsel') {
    const c = +t.dataset.c, i = sel.indexOf(c);
    if (i >= 0) sel.splice(i, 1); else if (sel.length < 4) sel.push(c);
    SFX.chip();
    render();
  }
  else if (a === 'brank') { lead = +t.dataset.r; SFX.chip(); render(); }
  else if (a === 'bplay') {
    const targetEl = $('.table .pile');
    if (targetEl && sel.length) {
      flyCard(card(sel[0]), $(`#c-${sel[0]}`), targetEl);
    }
    send({ type: 'play', cards: sel.slice(), rank: lead });
    sel = []; lead = null;
  }
  else if (a === 'call' || a === 'accept' || a === 'pass') {
    SFX.chip();
    send({ type: a });
  }

  /* Speed */
  else if (a === 'scard') {
    const c = +t.dataset.c, ok = [0, 1].filter(i => g.tops[i] !== null && adj(c, g.tops[i]));
    if (ok.length === 1) {
      const targetEl = $(`#spile-${ok[0]}`);
      if (targetEl) flyCard(card(c), t, targetEl);
      send({ type: 'play', card: c, pile: ok[0] }, true);
      selS = null;
    } else {
      selS = ok.length ? (selS === c ? null : c) : null;
      SFX.chip();
    }
    render();
  }
  else if (a === 'spile') {
    if (selS !== null) {
      flyCard(card(selS), $(`#c-${selS}`), t);
      send({ type: 'play', card: selS, pile: +t.dataset.p }, true);
      selS = null;
      render();
    }
  }

  /* Crazy Eights */
  else if (a === 'c8') {
    if (t.dataset.no) return;
    const c = +t.dataset.c;
    if (rk(c) === 7) {
      eight = eight === c ? null : c;
      SFX.chip();
      render();
    } else {
      const disc = $('#c8-disc');
      if (disc) flyCard(card(c), t, disc);
      send({ type: 'play', card: c });
    }
  }
  else if (a === 'suit') {
    const disc = $('#c8-disc');
    if (disc && eight !== null) flyCard(card(eight), $(`#c-${eight}`), disc);
    send({ type: 'play', card: eight, suit: +t.dataset.s });
    eight = null;
  }
  else if (a === 'draw') {
    SFX.drawCard();
    send({ type: 'draw' });
  }

  /* UNO */
  else if (a === 'uplay') {
    if (t.dataset.no) return;
    const c = +t.dataset.c, u = UNO[c];
    if (usel.length) {
      if (usel.includes(c)) usel = usel[0] === c ? [] : usel.filter(x => x !== c);
      else usel.push(c);
      SFX.chip();
      return render();
    }
    if (u.c === 4) {
      wild = wild === c ? null : c;
      SFX.chip();
      return render();
    }
    const same = g.hand.filter(x => x !== c && UNO[x].v === u.v && UNO[x].c !== 4);
    if (same.length && g.drawn === null && u.v <= 12) {
      usel = [c];
      SFX.chip();
      render();
    } else {
      const disc = $('#uno-disc');
      if (disc) flyCard(ucard(c), t, disc);
      send({ type: 'play', cards: [c] });
    }
  }
  else if (a === 'uplaysel') {
    const disc = $('#uno-disc');
    if (disc && usel.length) flyCard(ucard(usel[0]), $(`#c-${usel[0]}`), disc);
    send({ type: 'play', cards: usel.slice() });
    usel = [];
  }
  else if (a === 'uclear') { usel = []; SFX.chip(); render(); }
  else if (a === 'ucolor') {
    const disc = $('#uno-disc');
    if (disc && wild !== null) flyCard(ucard(wild), $(`#c-${wild}`), disc);
    send({ type: 'play', cards: [wild], color: +t.dataset.k });
    wild = null;
  }
  else if (a === 'dealer') { SFX.chip(); send({ type: 'color', color: +t.dataset.k }); }
  else if (a === 'udraw') { SFX.drawCard(); send({ type: 'draw' }); }
  else if (a === 'upass') { SFX.chip(); send({ type: 'pass' }); }
  else if (a === 'challenge') { SFX.alert(); send({ type: 'challenge' }); }
  else if (a === 'uuno') { SFX.alert(); send({ type: 'uno' }, true); }
  else if (a === 'ucatch') { SFX.alert(); send({ type: 'catch' }, true); }

  /* War */
  else if (a === 'wflip') {
    SFX.playCard();
    tableImpact();
    send({ type: 'flip' }, true);
  }

  /* Blackjack */
  else if (a === 'bjhit') {
    SFX.drawCard();
    send({ type: 'hit' });
  }
  else if (a === 'bjstand') {
    SFX.chip();
    send({ type: 'stand' });
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'turnSecs') socket.emit('settings', { turnSecs: +e.target.value });
  if (e.target.id === 'lock') socket.emit('settings', { locked: e.target.checked });
});

app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id) {
    const b = app.querySelector(e.target.id === 'code' ? '[data-a="join"]:not([data-code])' : '[data-a="create"],[data-a="join"][data-code]');
    if (b) b.click();
  }
});

render();
})();
