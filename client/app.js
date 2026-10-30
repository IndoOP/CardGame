(() => {
const RK = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'], SU = '♠♥♦♣';
const rk = c => c % 13, su = c => (c / 13) | 0, adj = (a, b) => { const d = Math.abs(rk(a) - rk(b)); return d === 1 || d === 12; };
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const $ = s => document.querySelector(s), app = $('#app');
const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };

let token = store.get('cr_token');
if (!token) { const b = new Uint8Array(24); crypto.getRandomValues(b); token = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); store.set('cr_token', token); }

const socket = io(window.SERVER_URL, { transports: ['websocket', 'polling'] });
let st = null, sel = [], selS = null, eight = null, lead = null, wild = null, tt;

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2500); }
function setConn(ok) { const c = $('#conn'); c.className = 'conn' + (ok ? '' : ' off'); c.textContent = ok ? 'Connected' : 'Reconnecting…'; if (ok) setTimeout(() => c.style.opacity = 0, 1200); else c.style.opacity = 1; }
const name = () => store.get('cr_name');
const nm = id => (st.players.find(p => p.id === id) || {}).name || '?';

socket.on('connect', () => { setConn(true); const c = store.get('cr_code'); if (c) rejoin(c); });
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => setConn(false));
socket.on('state', s => { st = s; store.set('cr_code', s.code); render(); });

function rejoin(code) {
  socket.emit('join', { code, name: name(), token }, r => {
    if (r && r.error) { store.set('cr_code', ''); st = null; render(); toast(r.error); }
  });
}
function act(a) { socket.emit('act', a); }

/* ---------- card & shared bits ---------- */
const card = (c, o = {}) => {
  const red = su(c) === 1 || su(c) === 2 ? ' red' : '';
  const tag = o.btn ? 'button' : 'div';
  return `<${tag} class="card${red} ${o.cls || ''}" ${o.attrs || ''}><span>${RK[rk(c)]}</span><span class="s">${SU[su(c)]}</span></${tag}>`;
};
const back = (cls = '') => `<div class="card back ${cls}"></div>`;
const chips = (turn, counts, fmt) => `<div class="chips">${st.players.map(p => `<div class="chip ${p.id === turn ? 'turn' : ''} ${p.connected ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}${p.id === st.you ? ' (you)' : ''}${counts ? `<b>${fmt ? fmt(counts[p.id]) : counts[p.id]}</b>` : ''}</div>`).join('')}</div>`;

/* ---------- UNO cards (must match server/games.js) ---------- */
const UNO = [];
for (let c = 0; c < 4; c++) { UNO.push({ c, v: 0 }); for (let v = 1; v <= 12; v++) UNO.push({ c, v }, { c, v }); }
for (let i = 0; i < 4; i++) UNO.push({ c: 4, v: 13 }, { c: 4, v: 14 });
const UL = v => v <= 9 ? String(v) : ['⊘', '⇄', '+2', '★', '+4'][v - 10], UC = ['Red', 'Yellow', 'Green', 'Blue'];
const ucard = (c, o = {}) => { const tag = o.btn ? 'button' : 'div'; return `<${tag} class="card uno u${UNO[c].c} ${o.cls || ''}" ${o.attrs || ''}><span class="ul">${UL(UNO[c].v)}</span></${tag}>`; };
const uOk = (g, c) => { const u = UNO[c]; if (g.drawn !== null && c !== g.drawn) return false;
  if (u.c === 4) return u.v === 13 || g.hand.every(x => UNO[x].c !== g.color); return u.c === g.color || u.v === UNO[g.top].v; };

/* ---------- views ---------- */
function home() {
  app.innerHTML = `<h1>🃏 Card Room</h1><p class="sub">Play Bluff, Speed, Crazy Eights and UNO with friends in real time.</p>
  <div class="panel"><h2>Your name</h2><input id="name" maxlength="16" placeholder="e.g. Dhruv" value="${esc(name())}" autocomplete="off">
  <div class="row" style="margin-top:8px"><button class="btn" data-a="create">Create room</button></div></div>
  <div class="panel"><h2>Join a room</h2><input id="code" maxlength="4" placeholder="CODE" autocomplete="off">
  <div class="row" style="margin-top:8px"><button class="btn ghost" data-a="join">Join</button></div></div>`;
}
function lobby() {
  const host = st.hostId === st.you, n = st.players.length;
  const games = [['bluff', 'Bluff', 'Shed all your cards. Lie about what you play, and call out liars.', '2–6 players', n >= 2 && n <= 6],
    ['speed', 'Speed', 'Real-time! Play cards one rank above or below the centre piles.', '2 players', n === 2],
    ['uno', 'UNO', 'Match colour or number. Skip, reverse, draw two and wilds. First to empty their hand wins.', '2–6 players', n >= 2 && n <= 6],
    ['crazy8', 'Crazy Eights', 'Match suit or rank. Eights are wild. First to empty their hand wins.', '2–6 players', n >= 2 && n <= 6]];
  return `<div class="panel"><h2>Players (${n}/6)</h2>${chips(null)}
  <p class="help">Share the code <b>${st.code}</b> (tap it above) with friends.</p></div>
  ${st.msg ? `<p class="msg">${esc(st.msg)}</p>` : ''}
  <div class="games">${games.map(g => `<div class="game"><h3>${g[1]}</h3><p>${g[2]}</p><p><b>${g[3]}</b></p>
  <button class="btn" data-a="start" data-g="${g[0]}" ${host && g[4] ? '' : 'disabled'}>${host ? 'Start' : 'Host starts'}</button></div>`).join('')}</div>`;
}
function bluff() {
  const g = st.g, me = st.you, myT = g.turn === me && st.phase === 'play', L = g.last;
  const lastEmpty = L && g.counts[L.uid] === 0;
  sel = sel.filter(c => g.hand.includes(c));
  let h = chips(st.phase === 'play' ? g.turn : null, g.counts);
  h += `<div class="table"><div class="pile">${g.pileN ? back('pop') : '<div class="card empty"></div>'}Pile: ${g.pileN}</div>
  <div class="status">${L ? `${esc(nm(L.uid))} says <b>${L.n} × ${RK[L.rank]}</b>` : 'No claim yet'}</div></div>`;
  if (g.reveal) h += `<div class="reveal">${esc(nm(g.reveal.uid))} had: ${g.reveal.cards.map(c => card(c, { cls: 'mini pop' + (rk(c) === g.reveal.rank ? ' glow' : ' dim') })).join('')}</div>`;
  if (st.phase === 'play') h += `<div class="status">${myT ? '👉 Your turn' : esc(nm(g.turn)) + "'s turn"}${L ? ` · claim: <b>${RK[g.rank]}</b>` : ' · new round'}</div>`;
  if (myT && !L) h += `<p class="help">You lead: pick the rank you will claim</p><div class="row" style="justify-content:center;gap:6px">${RK.map((r, i) => `<button class="btn ${lead === i ? '' : 'ghost'}" style="padding:8px 12px" data-a="brank" data-r="${i}">${r}</button>`).join('')}</div>`;
  h += `<div class="hand">${g.hand.map(c => card(c, { btn: 1, cls: sel.includes(c) ? 'sel' : '', attrs: `data-a="bsel" data-c="${c}"` })).join('')}</div>`;
  if (myT) h += `<div class="row" style="justify-content:center">${lastEmpty
    ? `<button class="btn warn" data-a="accept">Accept — ${esc(nm(L.uid))} went out</button><button class="btn danger" data-a="call">Call bluff!</button>`
    : `<button class="btn" data-a="bplay" ${sel.length && (L || lead !== null) ? '' : 'disabled'}>Play ${sel.length || ''} as ${RK[L ? g.rank : lead === null ? 0 : lead]}</button>${L ? '<button class="btn ghost" data-a="pass">Pass</button><button class="btn danger" data-a="call">Call bluff!</button>' : ''}`}</div>
  <p class="help">Pick 1–4 cards and claim they're all the stated rank. Others can pass or call you out. If everyone passes, the pile is discarded and you lead again.</p>`;
  return h;
}
function speed() {
  const g = st.g, me = st.you, opp = st.players.find(p => p.id !== me), mc = g.counts[me], oc = g.counts[opp.id];
  const info = (p, c) => `<div class="chips"><div class="chip ${p.connected ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}${p.id === me ? ' (you)' : ''} <b>hand ${c.hand}</b><b>draw ${c.draw}</b><b>spare ${c.res}</b></div></div>`;
  if (selS !== null && !g.hand.includes(selS)) selS = null;
  const piles = g.tops.map((c, i) => c === null ? '<div class="card big empty"></div>'
    : card(c, { btn: 1, cls: 'big' + (selS !== null && adj(selS, c) ? ' glow' : ''), attrs: `data-a="spile" data-p="${i}"` })).join('');
  return `${info(opp, oc)}<div class="table">${piles}</div>${info(st.players.find(p => p.id === me), mc)}
  <div class="hand">${g.hand.map(c => card(c, { btn: 1, cls: c === selS ? 'sel' : '', attrs: `data-a="scard" data-c="${c}"` })).join('')}</div>
  <p class="help">Tap a card to play it on a pile that's one rank higher or lower (A–K wraps). Piles flip automatically when nobody can play. Be fast!</p>`;
}
function crazy8() {
  const g = st.g, me = st.you, myT = g.turn === me && st.phase === 'play', t = g.top;
  const ok = c => rk(c) === 7 || su(c) === g.suit || rk(c) === rk(t), stuck = !g.hand.some(ok);
  let h = chips(st.phase === 'play' ? g.turn : null, g.counts, n => n + ' cards');
  h += `<div class="table"><div class="pile">${g.drawN ? back() : '<div class="card empty"></div>'}Draw: ${g.drawN}</div>
  <div class="pile">${card(t, { cls: 'big pop' })}<span>Suit: <b style="color:${g.suit === 1 || g.suit === 2 ? 'var(--red)' : 'inherit'}">${SU[g.suit]}</b></span></div></div>`;
  if (st.phase === 'play') h += `<div class="status">${myT ? '👉 Your turn' : esc(nm(g.turn)) + "'s turn"}</div>`;
  if (eight !== null && myT) h += `<div class="status">Choose a suit</div><div class="suits">${[0, 1, 2, 3].map(s => `<button class="btn ${s === 1 || s === 2 ? 'red' : ''}" data-a="suit" data-s="${s}">${SU[s]}</button>`).join('')}</div>`;
  h += `<div class="hand">${g.hand.map(c => card(c, { btn: 1, cls: (myT && !ok(c) ? 'dim ' : '') + (c === eight ? 'sel' : ''), attrs: `data-a="c8" data-c="${c}" ${myT && ok(c) ? '' : 'data-no="1"'}` })).join('')}</div>`;
  if (myT && stuck) h += `<div class="row" style="justify-content:center"><button class="btn warn" data-a="draw">${g.drawN ? 'Draw a card' : 'Pass'}</button></div>`;
  return h + '<p class="help">Match the suit or rank of the top card. Eights are wild. You can only draw when you have no playable card.</p>';
}
function unoView() {
  const g = st.g, me = st.you, myT = g.turn === me && st.phase === 'play';
  if (wild !== null && (!myT || !g.hand.includes(wild))) wild = null;
  let h = chips(st.phase === 'play' ? g.turn : null, g.counts, n => n + ' cards');
  h += `<div class="table"><div class="pile">${g.drawN ? '<div class="card uno u4"><span class="ul">UNO</span></div>' : '<div class="card empty"></div>'}Draw: ${g.drawN}</div>
  <div class="pile">${ucard(g.top, { cls: 'big pop' })}<span>Colour: <b class="swatch u${g.color}">${UC[g.color]}</b> · ${g.dir === 1 ? '↻' : '↺'}</span></div></div>`;
  if (st.phase === 'play') h += `<div class="status">${myT ? (g.drawn !== null ? '👉 Play the card you drew, or keep it' : '👉 Your turn') : esc(nm(g.turn)) + "'s turn"}</div>`;
  if (wild !== null) h += `<div class="status">Choose a colour</div><div class="suits">${UC.map((n, i) => `<button class="btn swatch u${i}" data-a="ucolor" data-k="${i}">${n}</button>`).join('')}</div>`;
  h += `<div class="hand">${g.hand.map(c => { const ok = myT && uOk(g, c); return ucard(c, { btn: 1, cls: (myT && !ok ? 'dim ' : '') + (c === wild ? 'sel' : ''), attrs: `data-a="uplay" data-c="${c}" ${ok ? '' : 'data-no="1"'}` }); }).join('')}</div>`;
  if (myT) h += `<div class="row" style="justify-content:center">${g.drawn === null ? '<button class="btn warn" data-a="udraw">Draw a card</button>' : '<button class="btn ghost" data-a="upass">Keep &amp; pass</button>'}</div>`;
  return h + '<p class="help">Match the colour or the number/symbol. Wild +4 only when you have no card of the current colour. If you draw a playable card you may play it straight away.</p>';
}
function room() {
  const host = st.hostId === st.you;
  let h = `<div class="bar"><div class="code-chip" data-a="copy" title="Copy room code">${st.code}</div><button class="btn ghost" data-a="leave">Leave</button></div>`;
  if (st.phase === 'lobby') return h + lobby();
  if (st.msg) h += `<p class="msg">${esc(st.msg)}</p>`;
  h += { bluff, speed, crazy8, uno: unoView }[st.game]();
  if (st.phase === 'over') {
    const w = st.g.win;
    h += `<div class="winner"><h2>${w === 'tie' ? '🤝 It\'s a draw' : w === st.you ? '🏆 You win!' : '🏆 ' + esc(nm(w)) + ' wins!'}</h2>
    ${host ? '<button class="btn" data-a="lobby">Back to lobby</button>' : '<p class="help">Waiting for the host…</p>'}</div>`;
  }
  return h;
}
function render() {
  if (!st) return home();
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  app.innerHTML = room();
}

/* ---------- events ---------- */
app.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t || t.disabled) return;
  const a = t.dataset.a;
  if (a === 'create' || a === 'join') {
    const n = $('#name').value.trim().slice(0, 16), code = $('#code').value.trim().toUpperCase();
    if (!n) return toast('Enter your name first');
    store.set('cr_name', n);
    if (a === 'create') socket.emit('create', { name: n, token }, r => r && r.error && toast(r.error));
    else { if (code.length !== 4) return toast('Enter the 4-letter room code'); socket.emit('join', { code, name: n, token }, r => r && r.error && toast(r.error)); }
  }
  else if (a === 'leave') { socket.emit('leave'); st = null; sel = []; selS = null; eight = null; store.set('cr_code', ''); render(); }
  else if (a === 'copy') { navigator.clipboard && navigator.clipboard.writeText(st.code).then(() => toast('Room code copied')).catch(() => {}); }
  else if (a === 'start') socket.emit('start', { game: t.dataset.g }, r => r && r.error && toast(r.error));
  else if (a === 'lobby') socket.emit('lobby');
  else if (a === 'bsel') { const c = +t.dataset.c, i = sel.indexOf(c); if (i >= 0) sel.splice(i, 1); else if (sel.length < 4) sel.push(c); render(); }
  else if (a === 'brank') { lead = +t.dataset.r; render(); }
  else if (a === 'bplay') { act({ type: 'play', cards: sel.slice(), rank: lead }); sel = []; lead = null; }
  else if (a === 'call' || a === 'accept' || a === 'pass') act({ type: a });
  else if (a === 'scard') {
    const c = +t.dataset.c, ok = [0, 1].filter(i => st.g.tops[i] !== null && adj(c, st.g.tops[i]));
    if (ok.length === 1) { act({ type: 'play', card: c, pile: ok[0] }); selS = null; } else selS = ok.length ? (selS === c ? null : c) : null;
    render();
  }
  else if (a === 'spile') { if (selS !== null) { act({ type: 'play', card: selS, pile: +t.dataset.p }); selS = null; render(); } }
  else if (a === 'c8') { if (t.dataset.no) return; const c = +t.dataset.c; if (rk(c) === 7) { eight = eight === c ? null : c; render(); } else act({ type: 'play', card: c }); }
  else if (a === 'suit') { act({ type: 'play', card: eight, suit: +t.dataset.s }); eight = null; }
  else if (a === 'draw') act({ type: 'draw' });
  else if (a === 'uplay') { if (t.dataset.no) return; const c = +t.dataset.c; if (UNO[c].c === 4) { wild = wild === c ? null : c; render(); } else act({ type: 'play', card: c }); }
  else if (a === 'ucolor') { act({ type: 'play', card: wild, color: +t.dataset.k }); wild = null; }
  else if (a === 'udraw') act({ type: 'draw' });
  else if (a === 'upass') act({ type: 'pass' });
});
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const b = e.target.id === 'code' ? 'join' : 'create'; app.querySelector(`[data-a="${b}"]`).click(); } });
render();
})();
