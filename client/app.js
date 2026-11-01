(() => {
const RK = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'], SU = '♠♥♦♣';
const rk = c => c % 13, su = c => (c / 13) | 0, adj = (a, b) => { const d = Math.abs(rk(a) - rk(b)); return d === 1 || d === 12; };
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const $ = s => document.querySelector(s), app = $('#app');
const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
let urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

let token = store.get('cr_token');
if (!token) { const b = new Uint8Array(24); crypto.getRandomValues(b); token = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); store.set('cr_token', token); }

const socket = io(window.SERVER_URL, { transports: ['websocket', 'polling'] });
let st = null, skew = 0, sel = [], selS = null, eight = null, lead = null, wild = null, usel = [], locked = false, lockT, lastAct = 0, unread = 0, tt;

const name = () => store.get('cr_name');
const nm = id => (st.players.find(p => p.id === id) || {}).name || '?';
const mobile = () => matchMedia('(max-width:899px)').matches;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }
function copy(text, msg) {
  const done = () => toast(msg || 'Copied');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => toast('Copy failed'));
  else { const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch { toast('Copy failed'); } a.remove(); }
}
const inviteUrl = () => location.origin + location.pathname + '?room=' + st.code;
async function invite() {
  const url = inviteUrl();
  if (navigator.share && matchMedia('(pointer:coarse)').matches) { try { await navigator.share({ title: 'Join my Card Room', text: 'Join my card game!', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copy(url, 'Invite link copied');
}
function setUrl(code) { try { history.replaceState(null, '', code ? '?room=' + code : location.pathname); } catch {} }

/* ---------- socket ---------- */
socket.on('connect', () => {
  $('#conn').classList.remove('show');
  const saved = store.get('cr_code'), c = urlRoom || saved;
  if (c && (name() || c === saved)) rejoin(c);
});
const down = () => { const c = $('#conn'); c.textContent = 'Reconnecting…'; c.classList.add('show'); };
socket.on('disconnect', down); socket.on('connect_error', down);
socket.on('state', s => { st = s; skew = s.now - Date.now(); locked = false; render(); });
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
function reset() { urlRoom = ''; st = null; sel = []; selS = null; eight = null; usel = []; wild = null; lead = null; store.set('cr_code', ''); setUrl(''); document.body.classList.remove('side-open'); render(); }
function send(a, fast) {
  const now = Date.now(); if (locked && !fast) return;
  if (now - lastAct < (fast ? 60 : 150)) return; lastAct = now;
  if (!fast) { locked = true; clearTimeout(lockT); lockT = setTimeout(() => { locked = false; }, 800); } // blocks double-taps until the server answers
  socket.emit('act', a);
}

/* ---------- chat ---------- */
function addChat(m, quiet) {
  const log = $('#clog'), d = document.createElement('div'), b = document.createElement('b');
  d.className = 'cm' + (st && m.i === st.you ? ' me' : ''); b.textContent = m.n; d.append(b, document.createTextNode(m.x));
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.appendChild(d);
  while (log.children.length > 80) log.firstChild.remove();
  if (near || (st && m.i === st.you)) log.scrollTop = log.scrollHeight;
  if (!quiet && mobile() && !document.body.classList.contains('side-open') && !(st && m.i === st.you)) { unread++; const bd = $('#badge'); bd.textContent = unread; bd.hidden = false; }
}
$('#cform').addEventListener('submit', e => { e.preventDefault(); const i = $('#cin'), t = i.value.trim(); if (!t) return; socket.emit('chat', { text: t }); i.value = ''; });
$('#fab').addEventListener('click', () => { document.body.classList.add('side-open'); unread = 0; $('#badge').hidden = true; const l = $('#clog'); l.scrollTop = l.scrollHeight; });
$('#sclose').addEventListener('click', () => document.body.classList.remove('side-open'));

/* ---------- cards ---------- */
const card = (c, o = {}) => {
  const red = su(c) === 1 || su(c) === 2 ? ' red' : '', t = RK[rk(c)] + SU[su(c)], tag = o.btn ? 'button' : 'div';
  return `<${tag} class="card${red} ${o.cls || ''}" ${o.attrs || ''} aria-label="${t}"><i class="tl">${RK[rk(c)]}\n${SU[su(c)]}</i><b class="mid">${SU[su(c)]}</b><i class="br">${RK[rk(c)]}\n${SU[su(c)]}</i></${tag}>`;
};
const back = (cls = '') => `<div class="card back ${cls}"></div>`;
const UNO = [];
for (let c = 0; c < 4; c++) { UNO.push({ c, v: 0 }); for (let v = 1; v <= 12; v++) UNO.push({ c, v }, { c, v }); }
for (let i = 0; i < 4; i++) UNO.push({ c: 4, v: 13 }, { c: 4, v: 14 });
const UL = v => v <= 9 ? String(v) : ['⊘', '⇄', '+2', '★', '+4'][v - 10], UC = ['Red', 'Yellow', 'Green', 'Blue'];
const ucard = (c, o = {}) => { const l = UL(UNO[c].v), tag = o.btn ? 'button' : 'div';
  return `<${tag} class="card uno u${UNO[c].c} ${o.cls || ''}" ${o.attrs || ''}><i class="tl">${l}</i><b class="mid"><span>${l}</span></b><i class="br">${l}</i></${tag}>`; };
const uPlayable = (g, c) => { const u = UNO[c]; return u.c === 4 || u.c === g.color || u.v === UNO[g.top].v; };

/* ---------- shared view bits ---------- */
function waitId() {
  const g = st.g; if (!g || st.phase !== 'play') return null;
  if (st.game === 'uno') return g.between || g.win ? null : g.pickColor || (g.challenge && g.challenge.by) || g.turn;
  return st.game === 'speed' ? null : g.turn;
}
const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const tbar = () => st.phase !== 'play' ? '' : st.game === 'speed' ? '<div class="tbar"><span id="ttxt">⏱ 0:00</span></div>'
  : st.deadline ? '<div class="tbar"><i id="tfill"></i><span id="ttxt"></span></div>' : '';
setInterval(() => {
  if (!st || st.phase !== 'play') return; const t = $('#ttxt'); if (!t) return;
  if (st.game === 'speed') { t.textContent = '⏱ ' + fmt(Math.max(0, Math.floor((Date.now() + skew - st.startedAt) / 1000))); return; }
  const f = $('#tfill'); if (!f || !st.deadline) return;
  const rem = Math.max(0, st.deadline - (Date.now() + skew)), who = waitId();
  f.style.width = (st.dtotal ? rem / st.dtotal * 100 : 0) + '%';
  f.parentNode.classList.toggle('low', rem < 8000 && st.dkind === 'turn');
  t.textContent = (st.dkind === 'between' ? 'Next round in ' : who === st.you ? 'Your turn · ' : who ? nm(who) + "'s turn · " : '') + Math.ceil(rem / 1000) + 's';
}, 250);
const chips = (turn, info) => `<div class="chips">${st.players.map(p => `<div class="chip ${p.id === turn ? 'turn' : ''} ${p.connected ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}${p.id === st.you ? ' (you)' : ''}${p.away ? ' · away' : ''}${info ? `<b>${info(p.id)}</b>` : ''}</div>`).join('')}</div>`;
const board = () => { const g = st.g, sc = g.scores; return `<div class="score">${[...st.players].sort((a, b) => sc[b.id] - sc[a.id]).map(p => `<div><span>${esc(p.name)}</span><span class="bar"><i style="width:${Math.min(100, sc[p.id] / g.target * 100)}%"></i></span><b>${sc[p.id]}</b></div>`).join('')}</div>`; };
const over = () => { if (st.phase !== 'over') return ''; const w = st.g.win, host = st.hostId === st.you;
  return `<div class="winner"><div class="trophy">🏆</div><h2>${w === 'tie' ? "It's a draw" : w === st.you ? 'You win!' : esc(nm(w)) + ' wins!'}</h2>${st.game === 'uno' ? board() : ''}${host ? '<button class="btn" data-a="lobby">Back to lobby</button>' : '<p class="mut">Waiting for the host…</p>'}</div>`; };
const picker = (act, ex = '') => `<div class="picker">${UC.map((n, i) => `<button class="btn u${i} swatch" data-a="${act}" data-k="${i}" style="${ex}">${n}</button>`).join('')}</div>`;

/* ---------- views ---------- */
function home() {
  document.body.classList.remove('inroom');
  $('#hdr').innerHTML = '<span class="brand">🃏 Card Room</span>';
  app.innerHTML = `<section class="hero"><h1>Card Room</h1><p class="mut">Real-time multiplayer card games. Bluff, Speed, Crazy Eights and UNO.</p></section>
  ${urlRoom ? `<div class="panel invite"><h2>You're invited to room <span class="mono">${esc(urlRoom)}</span></h2><p class="mut" style="margin:0">Enter your name to join the game.</p></div>` : ''}
  <div class="panel"><label for="name">Your name</label><input id="name" maxlength="16" placeholder="e.g. Dhruv" value="${esc(name())}" autocomplete="nickname">
  <div class="row" style="margin-top:10px">${urlRoom ? `<button class="btn" data-a="join" data-code="${esc(urlRoom)}">Join room ${esc(urlRoom)}</button>` : '<button class="btn" data-a="create">Create room</button>'}</div></div>
  <div class="panel"><label for="code">${urlRoom ? 'Or' : 'Have a'} room code${urlRoom ? '' : '?'}</label><div class="row"><input id="code" maxlength="4" placeholder="ABCD" autocomplete="off"><button class="btn ghost" data-a="join">Join</button></div>
  ${urlRoom ? '<div class="row" style="margin-top:10px"><button class="btn ghost" data-a="create">Create a new room instead</button></div>' : ''}</div>`;
}
function lobby() {
  const host = st.hostId === st.you, n = st.players.length, fit = (a, b) => n >= a && n <= b;
  const games = [['bluff', 'Bluff', 'Shed your cards. Lie about what you play and call out liars. Pass if you dare.', '2–6 players', fit(2, 6)],
    ['speed', 'Speed', 'Real-time. Play cards one rank above or below the centre piles.', '2 players', fit(2, 2)],
    ['crazy8', 'Crazy Eights', 'Match suit or rank. Eights are wild. First to empty their hand wins.', '2–6 players', fit(2, 6)],
    ['uno', 'UNO', 'Classic rules, multi-card plays and a 500-point match.', '2–6 players', fit(2, 6)]];
  return `<div class="panel"><h2>Invite friends</h2><div class="row"><input readonly value="${esc(inviteUrl())}" onclick="this.select()" aria-label="Invite link"><button class="btn" data-a="invite">${navigator.share && matchMedia('(pointer:coarse)').matches ? 'Share' : 'Copy link'}</button></div>
  <p class="help" style="text-align:left">${n} player${n > 1 ? 's' : ''} in the room · up to 6 · turn timer ${st.settings.turnSecs}s${st.settings.locked ? ' · 🔒 locked' : ''}</p></div>
  ${st.msg ? `<p class="msg">${esc(st.msg)}</p>` : ''}
  <div class="games">${games.map(g => `<div class="game"><h3>${g[1]}</h3><p>${g[2]}</p><span class="tag">${g[3]}</span>
  <button class="btn" data-a="start" data-g="${g[0]}" ${host && g[4] ? '' : 'disabled'}>${host ? (g[4] ? 'Start' : 'Need ' + g[3]) : 'Host starts'}</button></div>`).join('')}</div>`;
}
function bluff() {
  const g = st.g, me = st.you, myT = st.phase === 'play' && g.turn === me, L = g.last, lastEmpty = L && g.counts[L.uid] === 0;
  sel = sel.filter(c => g.hand.includes(c)); if (!myT) lead = null;
  let h = tbar() + chips(st.phase === 'play' ? g.turn : null, id => g.counts[id]);
  h += `<div class="table"><div class="pile">${g.pileN ? back('pop') : '<div class="card empty"></div>'}Pile: ${g.pileN}</div>
  <div class="status" style="color:#fff">${L ? `${esc(nm(L.uid))} says <b>${L.n} × ${RK[L.rank]}</b>` : 'No claim yet'}</div></div>`;
  if (g.reveal) h += `<div class="reveal">${esc(nm(g.reveal.uid))} had: ${g.reveal.cards.map(c => card(c, { cls: 'mini pop' + (rk(c) === g.reveal.rank ? ' glow' : ' dim') })).join('')}</div>`;
  if (st.phase === 'play') h += `<div class="status">${myT ? '👉 Your turn' : esc(nm(g.turn)) + "'s turn"}${L ? ` · claim <b>${RK[g.rank]}</b>` : ' · new round'}</div>`;
  if (myT && !L) h += `<p class="help">You lead: pick the rank you will claim</p><div class="row c" style="gap:6px">${RK.map((r, i) => `<button class="btn sm ${lead === i ? '' : 'ghost'}" data-a="brank" data-r="${i}">${r}</button>`).join('')}</div>`;
  h += `<div class="hand${g.hand.length > 12 ? ' dense' : ''}">${g.hand.map(c => card(c, { btn: 1, cls: sel.includes(c) ? 'sel' : '', attrs: `data-a="bsel" data-c="${c}"` })).join('')}</div>`;
  if (myT) h += `<div class="row c">${lastEmpty
    ? `<button class="btn warn" data-a="accept">Accept: ${esc(nm(L.uid))} went out</button><button class="btn danger" data-a="call">Call bluff!</button>`
    : `<button class="btn" data-a="bplay" ${sel.length && (L || lead !== null) ? '' : 'disabled'}>Play ${sel.length || ''} as ${RK[L ? g.rank : lead === null ? 0 : lead]}</button>${L ? '<button class="btn ghost" data-a="pass">Pass</button><button class="btn danger" data-a="call">Call bluff!</button>' : ''}`}</div>
  <p class="help">Pick 1–4 cards and claim they're all the stated rank. Others can pass or call you out. If everyone passes, the pile is discarded and you lead again.</p>`;
  return h;
}
function speed() {
  const g = st.g, me = st.you, opp = st.players.find(p => p.id !== me), mc = g.counts[me], oc = g.counts[opp.id];
  const info = (p, c) => `<div class="chips"><div class="chip ${p.connected ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}${p.id === me ? ' (you)' : ''} <b>hand ${c.hand}</b><b>draw ${c.draw}</b><b>spare ${c.res}</b></div></div>`;
  if (selS !== null && !g.hand.includes(selS)) selS = null;
  const piles = g.tops.map((c, i) => c === null ? '<div class="card big empty"></div>' : card(c, { btn: 1, cls: 'big' + (selS !== null && adj(selS, c) ? ' glow' : ''), attrs: `data-a="spile" data-p="${i}"` })).join('');
  return `${tbar()}${info(opp, oc)}<div class="table">${piles}</div>${info(st.players.find(p => p.id === me), mc)}
  <div class="hand">${g.hand.map(c => card(c, { btn: 1, cls: c === selS ? 'sel' : '', attrs: `data-a="scard" data-c="${c}"` })).join('')}</div>
  <p class="help">Tap a card to play it on a pile one rank higher or lower (A–K wraps). Piles flip automatically when nobody can play. Be fast!</p>`;
}
function crazy8() {
  const g = st.g, me = st.you, myT = st.phase === 'play' && g.turn === me, t = g.top;
  const ok = c => rk(c) === 7 || su(c) === g.suit || rk(c) === rk(t), stuck = !g.hand.some(ok);
  let h = tbar() + chips(st.phase === 'play' ? g.turn : null, id => g.counts[id] + ' cards');
  h += `<div class="table"><div class="pile">${g.drawN ? back() : '<div class="card empty"></div>'}Draw: ${g.drawN}</div>
  <div class="pile">${card(t, { cls: 'big pop' })}<span>Suit: <b style="color:${g.suit === 1 || g.suit === 2 ? '#ff8a8a' : '#fff'}">${SU[g.suit]}</b></span></div></div>`;
  if (st.phase === 'play') h += `<div class="status">${myT ? '👉 Your turn' : esc(nm(g.turn)) + "'s turn"}</div>`;
  if (eight !== null && myT) h += `<div class="status">Choose a suit</div><div class="picker">${[0, 1, 2, 3].map(s => `<button class="btn suit ${s === 1 || s === 2 ? 'red' : ''}" data-a="suit" data-s="${s}">${SU[s]}</button>`).join('')}</div>`;
  h += `<div class="hand${g.hand.length > 12 ? ' dense' : ''}">${g.hand.map(c => card(c, { btn: 1, cls: (myT && !ok(c) ? 'dim ' : '') + (c === eight ? 'sel' : ''), attrs: `data-a="c8" data-c="${c}" ${myT && ok(c) ? '' : 'data-no="1"'}` })).join('')}</div>`;
  if (myT && stuck) h += `<div class="row c"><button class="btn warn" data-a="draw">${g.drawN ? 'Draw a card' : 'Pass'}</button></div>`;
  return h + '<p class="help">Match the suit or rank of the top card. Eights are wild. You can only draw when you have no playable card.</p>';
}
function unoView() {
  const g = st.g, me = st.you, play = st.phase === 'play' && !g.between;
  const myT = play && !g.pickColor && !g.challenge && g.turn === me;
  usel = usel.filter(c => g.hand.includes(c)); if (!myT) usel = [];
  if (wild !== null && (!myT || !g.hand.includes(wild))) wild = null;
  const first = usel.length ? UNO[usel[0]] : null;
  const can = c => { if (!myT) return false; if (first) return c === usel[0] || (UNO[c].v === first.v && UNO[c].c !== 4); return g.drawn !== null ? c === g.drawn : uPlayable(g, c); };
  let h = tbar() + chips(play ? waitId() : null, id => g.counts[id] + ' · ' + g.scores[id] + 'pts');
  h += `<div class="table"><div class="pile">${g.drawN ? '<div class="card uno u4"><b class="mid"><span>UNO</span></b></div>' : '<div class="card empty"></div>'}Draw: ${g.drawN}</div>
  <div class="pile">${ucard(g.top, { cls: 'big pop' })}<span>Colour <b class="swatch u${g.color}">${UC[g.color]}</b> · ${g.dir === 1 ? '↻' : '↺'}</span></div></div>`;
  if (g.between) h += `<div class="winner"><h2>${g.roundWin === me ? 'You win' : esc(nm(g.roundWin)) + ' wins'} round ${g.round}!</h2><p class="mut">+${g.roundPts} points · first to ${g.target} wins the match</p>${board()}</div>`;
  else if (play) {
    let s;
    if (g.pickColor) s = g.pickColor === me ? '🎨 You are the dealer: choose the starting colour' : esc(nm(g.pickColor)) + ' is choosing the starting colour';
    else if (g.challenge) s = g.challenge.by === me ? `Wild +4 from ${esc(nm(g.challenge.player))}: challenge it or draw 4?` : `${esc(nm(g.challenge.by))} may challenge ${esc(nm(g.challenge.player))}'s Wild +4`;
    else s = myT ? (g.drawn !== null ? '👉 Play the card you drew, or keep it' : '👉 Your turn') : esc(nm(g.turn)) + "'s turn";
    h += `<div class="status">${s}</div>`;
    if (g.pickColor === me) h += picker('dealer');
    if (g.challenge && g.challenge.by === me) h += '<div class="row c"><button class="btn danger" data-a="challenge">Challenge</button><button class="btn warn" data-a="accept">Draw 4</button></div>';
    if (wild !== null) h += `<div class="status">Choose a colour</div>${picker('ucolor')}`;
  }
  h += `<div class="hand${g.hand.length > 10 ? ' dense' : ''}">${g.hand.map(c => { const ok = can(c); return ucard(c, { btn: 1, cls: (myT && !ok ? 'dim ' : '') + (usel.includes(c) || c === wild ? 'sel' : ''), attrs: `data-a="uplay" data-c="${c}" ${ok ? '' : 'data-no="1"'}` }); }).join('')}</div>`;
  const risk = g.unoRisk;
  h += `<div class="row c">${myT && usel.length ? `<button class="btn" data-a="uplaysel">Play ${usel.length} card${usel.length > 1 ? 's' : ''}</button><button class="btn ghost" data-a="uclear">Clear</button>`
    : myT ? (g.drawn === null ? '<button class="btn warn" data-a="udraw">Draw a card</button>' : '<button class="btn ghost" data-a="upass">Keep &amp; pass</button>') : ''}
  ${play && g.hand.length <= 2 && g.hand.length > 0 ? `<button class="btn ${risk === me ? 'danger pulse' : 'ghost'}" data-a="uuno">UNO!</button>` : ''}
  ${risk && risk !== me ? `<button class="btn danger pulse" data-a="ucatch">Catch ${esc(nm(risk))}!</button>` : ''}</div>
  <p class="help">Match colour or number. Tap several cards with the same number or symbol to play them together; the last one sets the colour. Say UNO before your next turn starts or get caught (+2). Wild +4 can be challenged.</p>`;
  return h;
}
function room() {
  if (st.phase === 'lobby') return lobby();
  return (st.msg ? `<p class="msg">${esc(st.msg)}</p>` : '') + { bluff, speed, crazy8, uno: unoView }[st.game]() + over();
}
function side() {
  const host = st.hostId === st.you;
  $('#plist').innerHTML = st.players.map(p => `<li class="${p.connected ? '' : 'off'}"><span class="dot"></span><span class="nm">${esc(p.name)}${p.id === st.you ? ' (you)' : ''}</span>
  ${p.id === st.hostId ? '<span class="tag gold">host</span>' : ''}${p.away ? '<span class="tag">away</span>' : ''}${!p.connected ? '<span class="tag">offline</span>' : ''}
  ${host && p.id !== st.you ? `<button class="ico" data-a="makehost" data-id="${p.id}" title="Make host" aria-label="Make host">👑</button><button class="ico" data-a="kick" data-id="${p.id}" title="Remove player" aria-label="Remove player">✕</button>` : ''}</li>`).join('');
  const hc = $('#hostctl');
  if (!host) { hc.innerHTML = ''; return; }
  if (hc.contains(document.activeElement) && hc.firstChild) { // don't clobber the control being used
    $('#turnSecs').value = st.settings.turnSecs; $('#lock').checked = st.settings.locked; $('#endg').hidden = st.phase === 'lobby'; return;
  }
  hc.innerHTML = `<b>Host controls</b><label>Turn timer <select id="turnSecs">${[20, 30, 45, 60, 90].map(s => `<option value="${s}" ${st.settings.turnSecs === s ? 'selected' : ''}>${s}s</option>`).join('')}</select></label>
  <label><input type="checkbox" id="lock" ${st.settings.locked ? 'checked' : ''}> Lock room (no new players)</label>
  <button class="btn ghost sm" id="endg" data-a="lobby" ${st.phase === 'lobby' ? 'hidden' : ''}>End game · back to lobby</button>`;
}
function render() {
  if (!st) return home();
  document.body.classList.add('inroom');
  $('#hdr').innerHTML = `<span class="brand">🃏 Card Room</span><div class="hdr-r"><button class="code-chip" data-a="copycode" title="Copy room code">${esc(st.code)}</button><button class="btn sm" data-a="invite">Invite</button><button class="btn sm ghost" data-a="leave">Leave</button></div>`;
  app.innerHTML = room(); side();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t || t.disabled) return;
  const a = t.dataset.a, g = st && st.g;
  if (a === 'create' || a === 'join') {
    const n = $('#name').value.trim().slice(0, 16), code = (t.dataset.code || $('#code').value).trim().toUpperCase();
    if (!n) return toast('Enter your name first');
    store.set('cr_name', n);
    const cb = r => { if (r && r.ok) { store.set('cr_code', r.code || code); setUrl(r.code || code); } else if (r && r.error) toast(r.error); };
    if (a === 'create') socket.emit('create', { name: n, token }, cb);
    else { if (code.length !== 4) return toast('Enter the 4-letter room code'); socket.emit('join', { code, name: n, token }, cb); }
  }
  else if (a === 'leave') { socket.emit('leave'); reset(); }
  else if (a === 'invite') invite();
  else if (a === 'copycode') copy(st.code, 'Room code copied');
  else if (a === 'start') socket.emit('start', { game: t.dataset.g }, r => r && r.error && toast(r.error));
  else if (a === 'lobby') { if (st.phase === 'lobby' || st.phase === 'over' || confirm('End the current game for everyone?')) socket.emit('lobby'); }
  else if (a === 'kick') { if (confirm('Remove this player from the room?')) socket.emit('kick', { id: t.dataset.id }, r => r && r.error && toast(r.error)); }
  else if (a === 'makehost') socket.emit('makehost', { id: t.dataset.id }, r => r && r.error && toast(r.error));
  /* bluff */
  else if (a === 'bsel') { const c = +t.dataset.c, i = sel.indexOf(c); if (i >= 0) sel.splice(i, 1); else if (sel.length < 4) sel.push(c); render(); }
  else if (a === 'brank') { lead = +t.dataset.r; render(); }
  else if (a === 'bplay') { send({ type: 'play', cards: sel.slice(), rank: lead }); sel = []; lead = null; }
  else if (a === 'call' || a === 'accept' || a === 'pass') send({ type: a });
  /* speed */
  else if (a === 'scard') {
    const c = +t.dataset.c, ok = [0, 1].filter(i => g.tops[i] !== null && adj(c, g.tops[i]));
    if (ok.length === 1) { send({ type: 'play', card: c, pile: ok[0] }, true); selS = null; } else selS = ok.length ? (selS === c ? null : c) : null;
    render();
  }
  else if (a === 'spile') { if (selS !== null) { send({ type: 'play', card: selS, pile: +t.dataset.p }, true); selS = null; render(); } }
  /* crazy eights */
  else if (a === 'c8') { if (t.dataset.no) return; const c = +t.dataset.c; if (rk(c) === 7) { eight = eight === c ? null : c; render(); } else send({ type: 'play', card: c }); }
  else if (a === 'suit') { send({ type: 'play', card: eight, suit: +t.dataset.s }); eight = null; }
  else if (a === 'draw') send({ type: 'draw' });
  /* uno */
  else if (a === 'uplay') {
    if (t.dataset.no) return; const c = +t.dataset.c, u = UNO[c];
    if (usel.length) {
      if (usel.includes(c)) usel = usel[0] === c ? [] : usel.filter(x => x !== c); else usel.push(c);
      return render();
    }
    if (u.c === 4) { wild = wild === c ? null : c; return render(); }
    const same = g.hand.filter(x => x !== c && UNO[x].v === u.v && UNO[x].c !== 4);
    if (same.length && g.drawn === null && u.v <= 12) { usel = [c]; render(); } // other cards share this number: offer a multi-play
    else send({ type: 'play', cards: [c] });
  }
  else if (a === 'uplaysel') { send({ type: 'play', cards: usel.slice() }); usel = []; }
  else if (a === 'uclear') { usel = []; render(); }
  else if (a === 'ucolor') { send({ type: 'play', cards: [wild], color: +t.dataset.k }); wild = null; }
  else if (a === 'dealer') send({ type: 'color', color: +t.dataset.k });
  else if (a === 'udraw') send({ type: 'draw' });
  else if (a === 'upass') send({ type: 'pass' });
  else if (a === 'challenge') send({ type: 'challenge' });
  else if (a === 'uuno') send({ type: 'uno' }, true);
  else if (a === 'ucatch') send({ type: 'catch' }, true);
});
document.addEventListener('change', e => {
  if (e.target.id === 'turnSecs') socket.emit('settings', { turnSecs: +e.target.value });
  if (e.target.id === 'lock') socket.emit('settings', { locked: e.target.checked });
});
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id) { const b = app.querySelector(e.target.id === 'code' ? '[data-a="join"]:not([data-code])' : '[data-a="create"],[data-a="join"][data-code]'); if (b) b.click(); } });
render();
})();
