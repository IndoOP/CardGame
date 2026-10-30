// Server-authoritative game logic. Each game: min, max, init(room), act(room,id,a), view(room,id)
// act() returns null when invalid (state untouched), otherwise a message string ('' = no message).
const RK = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'], SU = '♠♥♦♣';
const rk = c => c % 13, su = c => (c / 13) | 0, cmp = (a, b) => rk(a) - rk(b) || su(a) - su(b);
const lbl = c => RK[rk(c)] + SU[su(c)];
const deck = () => [...Array(52).keys()];
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ids = r => r.players.map(p => p.id);
const nm = (r, id) => (r.players.find(p => p.id === id) || {}).name || '?';
const nextId = (r, id) => { const P = ids(r); return P[(P.indexOf(id) + 1) % P.length]; };
const isCards = (cs, hand, max) => Array.isArray(cs) && cs.length >= 1 && cs.length <= max &&
  new Set(cs).size === cs.length && cs.every(c => Number.isInteger(c) && hand.includes(c));

/* ---------------- Bluff ---------------- */
const bluff = {
  min: 2, max: 6,
  init(r) {
    const P = ids(r), d = shuf(deck()), hands = {};
    P.forEach(i => hands[i] = []);
    d.forEach((c, i) => hands[P[i % P.length]].push(c));
    P.forEach(i => hands[i].sort(cmp));
    return { hands, turn: P[0], rank: 0, passes: 0, pile: [], last: null, reveal: null, win: null };
  },
  act(r, id, a) {
    const g = r.g; if (g.win || g.turn !== id) return null;
    const L = g.last, hand = g.hands[id];
    if (a.type === 'play') {
      if (!isCards(a.cards, hand, 4)) return null;
      if (L && g.hands[L.uid].length === 0) return null; // must call or accept
      let rank = g.rank;
      if (!L) { // nothing on the table: the leader chooses which rank to claim
        if (!Number.isInteger(a.rank) || a.rank < 0 || a.rank > 12) return null;
        rank = a.rank;
      }
      g.hands[id] = hand.filter(c => !a.cards.includes(c));
      g.pile.push(...a.cards);
      g.last = { uid: id, n: a.cards.length, rank, cards: a.cards.slice() };
      g.reveal = null; g.passes = 0;
      const claimed = RK[rank]; g.rank = (rank + 1) % 13; g.turn = nextId(r, id);
      return `${nm(r, id)} played ${a.cards.length} × ${claimed}`;
    }
    if (!L) return null;
    if (a.type === 'accept') {
      if (g.hands[L.uid].length) return null;
      g.win = L.uid; return `${nm(r, L.uid)} went out!`;
    }
    if (a.type === 'pass') {
      if (g.hands[L.uid].length === 0) return null; // must call or accept
      g.passes++; g.turn = nextId(r, id);
      if (g.turn === L.uid) { // everyone else passed: discard the pile, claimer leads a fresh round
        const n = g.pile.length; g.pile = []; g.last = null; g.passes = 0; g.reveal = null;
        return `Everyone passed: ${n} cards discarded. ${nm(r, L.uid)} leads a new round`;
      }
      return `${nm(r, id)} passed`;
    }
    if (a.type === 'call') {
      const honest = L.cards.every(c => rk(c) === L.rank), loser = honest ? id : L.uid, n = g.pile.length;
      g.reveal = { uid: L.uid, rank: L.rank, cards: L.cards, honest };
      g.hands[loser] = g.hands[loser].concat(g.pile).sort(cmp);
      g.pile = []; g.last = null; g.passes = 0;
      if (g.hands[L.uid].length === 0) g.win = L.uid;
      return `${nm(r, id)} called ${nm(r, L.uid)}: ${honest ? 'honest' : 'a bluff'}! ${nm(r, loser)} takes ${n} cards`;
    }
    return null;
  },
  view(r, id) {
    const g = r.g, counts = {}; ids(r).forEach(i => counts[i] = g.hands[i].length);
    return { hand: g.hands[id] || [], counts, turn: g.turn, rank: g.rank, pileN: g.pile.length,
      last: g.last && { uid: g.last.uid, n: g.last.n, rank: g.last.rank }, reveal: g.reveal, win: g.win };
  }
};

/* ---------------- Speed (2 players, real-time) ---------------- */
const adj = (a, b) => { const d = Math.abs(rk(a) - rk(b)); return d === 1 || d === 12; };
const top = p => p.length ? p[p.length - 1] : null;
const speed = {
  min: 2, max: 2,
  init(r) {
    const P = ids(r), d = shuf(deck()), g = { hand: {}, draw: {}, res: {}, c: [[], []], win: null };
    P.forEach(i => { const h = d.splice(0, 26); g.hand[i] = h.splice(0, 5); g.draw[i] = h.splice(0, 15); g.res[i] = h; });
    this.settle(r, g); return g;
  },
  canMove(r, g) {
    const t = g.c.map(top);
    return ids(r).some(i => g.hand[i].some(c => t.some(x => x !== null && adj(c, x))));
  },
  settle(r, g) { // flip spare cards while nobody can play; finish when spares run out
    const [a, b] = ids(r);
    for (let i = 0; i < 40; i++) {
      if (this.canMove(r, g)) return;
      if (g.res[a].length && g.res[b].length) { g.c[0].push(g.res[a].pop()); g.c[1].push(g.res[b].pop()); }
      else {
        const x = g.hand[a].length + g.draw[a].length, y = g.hand[b].length + g.draw[b].length;
        g.win = x < y ? a : y < x ? b : 'tie'; return;
      }
    }
  },
  act(r, id, a) {
    const g = r.g; if (g.win || a.type !== 'play') return null;
    const h = g.hand[id], pile = g.c[a.pile === 1 ? 1 : 0], t = top(pile);
    if (!Number.isInteger(a.card) || !h.includes(a.card) || t === null || !adj(a.card, t)) return null;
    h.splice(h.indexOf(a.card), 1); pile.push(a.card);
    if (g.draw[id].length) h.push(g.draw[id].pop());
    if (!h.length) g.win = id; else this.settle(r, g);
    return '';
  },
  view(r, id) {
    const g = r.g, o = {};
    ids(r).forEach(i => o[i] = { hand: g.hand[i].length, draw: g.draw[i].length, res: g.res[i].length });
    return { hand: g.hand[id] || [], counts: o, tops: g.c.map(top), win: g.win };
  }
};

/* ---------------- Crazy Eights ---------------- */
const crazy8 = {
  min: 2, max: 6,
  init(r) {
    const P = ids(r), d = shuf(deck()), hands = {};
    P.forEach(i => hands[i] = d.splice(0, 7).sort(cmp));
    const k = d.findIndex(c => rk(c) !== 7), t = d.splice(k, 1)[0];
    return { hands, draw: d, disc: [t], suit: su(t), turn: P[0], win: null };
  },
  act(r, id, a) {
    const g = r.g; if (g.win || g.turn !== id) return null;
    const h = g.hands[id], t = top(g.disc), n = nm(r, id);
    const ok = c => rk(c) === 7 || su(c) === g.suit || rk(c) === rk(t);
    if (a.type === 'play') {
      const c = a.card; if (!Number.isInteger(c) || !h.includes(c) || !ok(c)) return null;
      let s = su(c);
      if (rk(c) === 7) { if (![0, 1, 2, 3].includes(a.suit)) return null; s = a.suit; }
      h.splice(h.indexOf(c), 1); g.disc.push(c); g.suit = s;
      if (!h.length) { g.win = id; return `${n} went out!`; }
      g.turn = nextId(r, id);
      return `${n} played ${lbl(c)}` + (rk(c) === 7 ? ` and chose ${SU[s]}` : '');
    }
    if (a.type === 'draw') {
      if (h.some(ok)) return null; // may only draw when stuck
      if (!g.draw.length && g.disc.length > 1) { const x = g.disc.pop(); g.draw = shuf(g.disc); g.disc = [x]; }
      if (!g.draw.length) { g.turn = nextId(r, id); return `${n} passed (no cards left to draw)`; }
      h.push(g.draw.pop()); h.sort(cmp); return `${n} drew a card`;
    }
    return null;
  },
  view(r, id) {
    const g = r.g, counts = {}; ids(r).forEach(i => counts[i] = g.hands[i].length);
    return { hand: g.hands[id] || [], counts, turn: g.turn, top: top(g.disc), suit: g.suit, drawN: g.draw.length, win: g.win };
  }
};


/* ---------------- UNO ---------------- */
// 108 cards. c: 0 red, 1 yellow, 2 green, 3 blue, 4 wild. v: 0-9 numbers, 10 skip, 11 reverse, 12 draw two, 13 wild, 14 wild draw four
const UNO = [];
for (let c = 0; c < 4; c++) { UNO.push({ c, v: 0 }); for (let v = 1; v <= 12; v++) UNO.push({ c, v }, { c, v }); }
for (let i = 0; i < 4; i++) UNO.push({ c: 4, v: 13 }, { c: 4, v: 14 });
const UCOL = ['Red', 'Yellow', 'Green', 'Blue'];
const ucmp = (a, b) => UNO[a].c - UNO[b].c || UNO[a].v - UNO[b].v;
const udesc = c => { const u = UNO[c]; return u.c === 4 ? (u.v === 13 ? 'Wild' : 'Wild +4') : `${UCOL[u.c]} ${u.v <= 9 ? u.v : ['Skip', 'Reverse', '+2'][u.v - 10]}`; };
const uStep = (r, g, id, k) => { const P = ids(r), n = P.length; return P[(((P.indexOf(id) + g.dir * k) % n) + n) % n]; };
function uTake(g, hand, n) { // draw up to n cards, reshuffling the discard pile if needed; returns last card drawn or null
  let last = null;
  for (let i = 0; i < n; i++) {
    if (!g.draw.length && g.disc.length > 1) { const t = g.disc.pop(); g.draw = shuf(g.disc); g.disc = [t]; }
    if (!g.draw.length) break;
    last = g.draw.pop(); hand.push(last);
  }
  hand.sort(ucmp); return last;
}
function uOk(g, hand, c) {
  const u = UNO[c];
  if (u.c === 4) return u.v === 13 || hand.every(x => UNO[x].c !== g.color); // wild +4 only when no card of current colour
  return u.c === g.color || u.v === UNO[g.disc[g.disc.length - 1]].v;
}
const uno = {
  min: 2, max: 6,
  init(r) {
    const P = ids(r), d = shuf([...Array(108).keys()]), hands = {};
    P.forEach(i => hands[i] = d.splice(0, 7).sort(ucmp));
    const k = d.findIndex(c => UNO[c].v <= 9), t = d.splice(k, 1)[0];
    return { hands, draw: d, disc: [t], color: UNO[t].c, dir: 1, turn: P[0], drawn: null, win: null };
  },
  act(r, id, a) {
    const g = r.g; if (g.win || g.turn !== id) return null;
    const h = g.hands[id], n = nm(r, id);
    if (a.type === 'play') {
      const c = a.card;
      if (!Number.isInteger(c) || !h.includes(c) || (g.drawn !== null && c !== g.drawn) || !uOk(g, h, c)) return null;
      const u = UNO[c];
      if (u.c === 4 && ![0, 1, 2, 3].includes(a.color)) return null;
      h.splice(h.indexOf(c), 1); g.disc.push(c); g.color = u.c === 4 ? a.color : u.c; g.drawn = null;
      let m = `${n} played ${udesc(c)}` + (u.c === 4 ? ` (${UCOL[g.color]})` : '');
      if (!h.length) { g.win = id; return m + ' and went out!'; }
      if (h.length === 1) m += ' — UNO!';
      const nxt = uStep(r, g, id, 1);
      if (u.v === 10) { g.turn = uStep(r, g, id, 2); m += `, ${nm(r, nxt)} is skipped`; }
      else if (u.v === 11) { g.dir = -g.dir; g.turn = ids(r).length === 2 ? id : uStep(r, g, id, 1); m += ', direction reversed'; }
      else if (u.v === 12 || u.v === 14) { const k = u.v === 12 ? 2 : 4; uTake(g, g.hands[nxt], k); g.turn = uStep(r, g, id, 2); m += `, ${nm(r, nxt)} draws ${k}`; }
      else g.turn = nxt;
      return m;
    }
    if (a.type === 'draw') {
      if (g.drawn !== null) return null;
      const c = uTake(g, h, 1);
      if (c === null) { g.turn = uStep(r, g, id, 1); return `${n} had nothing to draw and passed`; }
      if (!uOk(g, h, c)) { g.turn = uStep(r, g, id, 1); return `${n} drew a card and passed`; }
      g.drawn = c; return `${n} drew a card`; // may play it (only it) or keep and pass
    }
    if (a.type === 'pass') {
      if (g.drawn === null) return null;
      g.drawn = null; g.turn = uStep(r, g, id, 1); return `${n} kept the card and passed`;
    }
    return null;
  },
  view(r, id) {
    const g = r.g, counts = {}; ids(r).forEach(i => counts[i] = g.hands[i].length);
    return { hand: g.hands[id] || [], counts, turn: g.turn, top: g.disc[g.disc.length - 1], color: g.color, dir: g.dir,
      drawN: g.draw.length, drawn: g.turn === id ? g.drawn : null, win: g.win };
  }
};

module.exports = { bluff, speed, crazy8, uno };
