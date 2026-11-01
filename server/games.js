// Server-authoritative game logic.
// Each game: min, max, init(room), act(room,id,action), view(room,id)
//   optional: waiting(room) -> id the game is waiting on (turn timer), auto(room,id) -> action to play for an idle player,
//             between(room) -> true during an interstitial, nextRound(room)
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
const rnd = n => Math.floor(Math.random() * n);

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
  waiting: r => r.g.win ? null : r.g.turn,
  auto(r, id) {
    const g = r.g, L = g.last;
    if (L) return { type: g.hands[L.uid].length === 0 ? 'accept' : 'pass' };
    const c = g.hands[id][0]; return { type: 'play', cards: [c], rank: rk(c) };
  },
  act(r, id, a) {
    const g = r.g; if (g.win || g.turn !== id) return null;
    const L = g.last, hand = g.hands[id];
    if (a.type === 'play') {
      if (!isCards(a.cards, hand, 4)) return null;
      if (L && g.hands[L.uid].length === 0) return null; // must call or accept
      let rank = g.rank;
      if (!L) { if (!Number.isInteger(a.rank) || a.rank < 0 || a.rank > 12) return null; rank = a.rank; }
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
      if (g.hands[L.uid].length === 0) return null;
      g.passes++; g.turn = nextId(r, id);
      if (g.turn === L.uid) {
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
  settle(r, g) {
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
  waiting: r => r.g.win ? null : r.g.turn,
  auto(r, id) {
    const g = r.g, h = g.hands[id], t = top(g.disc);
    const c = h.find(x => rk(x) === 7 || su(x) === g.suit || rk(x) === rk(t));
    return c === undefined ? { type: 'draw' } : { type: 'play', card: c, suit: rnd(4) };
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
      if (h.some(ok)) return null;
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

/* ---------------- UNO (classic rules, 500-point match) ---------------- */
// 108 cards. c: 0 red, 1 yellow, 2 green, 3 blue, 4 wild. v: 0-9 numbers, 10 skip, 11 reverse, 12 draw two, 13 wild, 14 wild draw four
const UNO = [];
for (let c = 0; c < 4; c++) { UNO.push({ c, v: 0 }); for (let v = 1; v <= 12; v++) UNO.push({ c, v }, { c, v }); }
for (let i = 0; i < 4; i++) UNO.push({ c: 4, v: 13 }, { c: 4, v: 14 });
const UCOL = ['Red', 'Yellow', 'Green', 'Blue'], TARGET = 500;
const ucmp = (a, b) => UNO[a].c - UNO[b].c || UNO[a].v - UNO[b].v;
const uPts = c => { const v = UNO[c].v; return v <= 9 ? v : v <= 12 ? 20 : 50; };
const udesc = c => { const u = UNO[c]; return u.c === 4 ? (u.v === 13 ? 'Wild' : 'Wild +4') : `${UCOL[u.c]} ${u.v <= 9 ? u.v : ['Skip', 'Reverse', '+2'][u.v - 10]}`; };
const uStep = (r, g, id, k) => { const P = ids(r), n = P.length; return P[(((P.indexOf(id) + g.dir * k) % n) + n) % n]; };
function uTake(g, hand, n) {
  let last = null;
  for (let i = 0; i < n; i++) {
    if (!g.draw.length && g.disc.length > 1) { const t = g.disc.pop(); g.draw = shuf(g.disc); g.disc = [t]; }
    if (!g.draw.length) break;
    last = g.draw.pop(); hand.push(last);
  }
  hand.sort(ucmp); return last;
}
// Normal legality. Wilds are always playable; Wild +4 misuse is policed by the challenge rule.
function uOk(g, c) {
  const u = UNO[c];
  return u.c === 4 || u.c === g.color || u.v === UNO[g.disc[g.disc.length - 1]].v;
}
function uDeal(r, g) {
  const P = ids(r), n = P.length, f = g.first % n, first = P[f], dealer = P[(f + n - 1) % n];
  const d = shuf([...Array(108).keys()]); g.hands = {};
  P.forEach(i => g.hands[i] = d.splice(0, 7).sort(ucmp));
  let t; for (;;) { t = d.pop(); if (UNO[t].v !== 14) break; d.push(t); shuf(d); } // flipped +4 goes back and is reshuffled
  Object.assign(g, { draw: d, disc: [t], color: UNO[t].c, dir: 1, turn: first, drawn: null, pickColor: null, challenge: null,
    unoRisk: null, unoCalled: {}, between: false, roundWin: null, note: '' });
  const v = UNO[t].v;
  if (v === 13) { g.color = 0; g.pickColor = dealer; g.note = `${nm(r, dealer)} picks the starting colour`; }
  else if (v === 10) { g.turn = uStep(r, g, first, 1); g.note = `${nm(r, first)} is skipped`; }
  else if (v === 11) { g.dir = -1; g.turn = dealer; g.note = 'Direction reversed'; }
  else if (v === 12) { uTake(g, g.hands[first], 2); g.turn = uStep(r, g, first, 1); g.note = `${nm(r, first)} draws 2 and is skipped`; }
}
function uRoundEnd(r, id, m) {
  const g = r.g; let pts = 0;
  ids(r).forEach(i => { if (i !== id) g.hands[i].forEach(c => pts += uPts(c)); });
  g.scores[id] += pts; g.roundWin = id; g.roundPts = pts;
  if (g.scores[id] >= TARGET) { g.win = id; return `${m} and wins the match with ${g.scores[id]} points!`; }
  g.between = true; return `${m} and wins round ${g.round} (+${pts} points)`;
}
const uno = {
  min: 2, max: 6,
  init(r) { const g = { scores: {}, round: 1, first: 0 }; ids(r).forEach(i => g.scores[i] = 0); uDeal(r, g); return g; },
  between: r => !!r.g.between && !r.g.win,
  nextRound(r) { const g = r.g; g.round++; g.first = (g.first + 1) % ids(r).length; uDeal(r, g); r.msg = `Round ${g.round}` + (g.note ? ' · ' + g.note : ''); },
  waiting: r => { const g = r.g; return g.win || g.between ? null : g.pickColor || (g.challenge && g.challenge.by) || g.turn; },
  auto(r, id) {
    const g = r.g, h = g.hands[id];
    if (g.pickColor) return { type: 'color', color: rnd(4) };
    if (g.challenge) return { type: 'accept' };
    if (g.drawn !== null) return { type: 'pass' };
    const cnt = [0, 0, 0, 0]; h.forEach(c => { if (UNO[c].c < 4) cnt[UNO[c].c]++; });
    const col = cnt.indexOf(Math.max(...cnt));
    const c = h.find(x => UNO[x].c !== 4 && uOk(g, x)) ?? h.find(x => UNO[x].v === 13);
    return c === undefined ? { type: 'draw' } : { type: 'play', cards: [c], color: col };
  },
  act(r, id, a) {
    const g = r.g; if (g.win || g.between) return null;
    const n = nm(r, id);
    if (a.type === 'uno') { // declare UNO (allowed with 1–2 cards); clears a pending catch window if it is yours
      const k = g.hands[id].length; if (k < 1 || k > 2) return null;
      if (g.unoRisk === id) g.unoRisk = null; else g.unoCalled[id] = true;
      return `${n} shouts UNO!`;
    }
    if (a.type === 'catch') {
      const v = g.unoRisk; if (!v || v === id || g.hands[v].length !== 1) return null;
      uTake(g, g.hands[v], 2); g.unoRisk = null;
      return `${nm(r, v)} forgot to call UNO and was caught by ${n}: +2 cards`;
    }
    if (g.pickColor) {
      if (id !== g.pickColor || a.type !== 'color' || ![0, 1, 2, 3].includes(a.color)) return null;
      g.color = a.color; g.pickColor = null; return `${n} chose ${UCOL[a.color]}`;
    }
    if (g.challenge) {
      const C = g.challenge; if (id !== C.by) return null; g.unoRisk = null;
      if (a.type === 'accept') { uTake(g, g.hands[id], 4); g.challenge = null; g.turn = uStep(r, g, id, 1); return `${n} draws 4 and is skipped`; }
      if (a.type === 'challenge') {
        g.challenge = null;
        if (!C.legal) { uTake(g, g.hands[C.player], 4); return `${n} challenged and was right: ${nm(r, C.player)} held a matching colour and draws 4. ${n} plays on`; }
        uTake(g, g.hands[id], 6); g.turn = uStep(r, g, id, 1); return `Challenge failed! ${n} draws 6 and is skipped`;
      }
      return null;
    }
    if (g.turn !== id) return null;
    const hand = g.hands[id];
    if (a.type === 'draw') {
      if (g.drawn !== null) return null;
      g.unoRisk = null; delete g.unoCalled[id];
      const c = uTake(g, hand, 1);
      if (c === null) { g.turn = uStep(r, g, id, 1); return `${n} had nothing to draw and passed`; }
      if (!uOk(g, c)) { g.turn = uStep(r, g, id, 1); return `${n} drew a card and passed`; }
      g.drawn = c; return `${n} drew a card`;
    }
    if (a.type === 'pass') {
      if (g.drawn === null) return null;
      g.unoRisk = null; g.drawn = null; g.turn = uStep(r, g, id, 1); return `${n} kept the card and passed`;
    }
    if (a.type !== 'play') return null;
    // play one card, or several cards of the same number/symbol in one turn (first card must be legal; last card sets the colour)
    const cs = a.cards;
    if (!Array.isArray(cs) || !cs.length || cs.length > 8 || new Set(cs).size !== cs.length || !cs.every(c => Number.isInteger(c) && hand.includes(c))) return null;
    const u0 = UNO[cs[0]];
    if (cs.length > 1 && (u0.v > 12 || !cs.every(c => UNO[c].v === u0.v))) return null;
    if (g.drawn !== null && !(cs.length === 1 && cs[0] === g.drawn)) return null;
    if (!uOk(g, cs[0])) return null;
    if (u0.c === 4 && ![0, 1, 2, 3].includes(a.color)) return null;
    const legal4 = u0.v !== 14 || hand.every(x => UNO[x].c !== g.color), called = g.unoCalled[id];
    g.unoRisk = null; delete g.unoCalled[id];
    const left = g.hands[id] = hand.filter(c => !cs.includes(c));
    cs.forEach(c => g.disc.push(c));
    g.color = u0.c === 4 ? a.color : UNO[cs[cs.length - 1]].c; g.drawn = null;
    let m = `${n} played ${cs.map(udesc).join(' + ')}` + (u0.c === 4 ? ` (${UCOL[g.color]})` : '');
    if (!left.length) return uRoundEnd(r, id, m);
    if (left.length === 1) { if (!called) g.unoRisk = id; m += called ? ' · UNO!' : ' · one card left'; }
    const N = ids(r).length, nxt = uStep(r, g, id, 1);
    if (u0.v === 13) g.turn = nxt;
    else if (u0.v === 14) { g.challenge = { by: nxt, player: id, legal: legal4 }; g.turn = nxt; m += `. ${nm(r, nxt)} may challenge or draw 4`; }
    else if (u0.v === 12) { const k = 2 * cs.length, v = nxt; uTake(g, g.hands[v], k); g.turn = uStep(r, g, id, 2); m += `, ${nm(r, v)} draws ${k} and is skipped`; }
    else if (u0.v === 10 || u0.v === 11) {
      let skips = 0;
      if (u0.v === 10 || N === 2) skips = cs.length; else if (cs.length % 2) g.dir = -g.dir;
      const k = Math.min(skips, N - 1); g.turn = uStep(r, g, id, 1 + k);
      m += u0.v === 10 ? `, ${k} skipped` : N === 2 ? ', skip' : ', direction reversed';
    } else g.turn = nxt;
    return m;
  },
  view(r, id) {
    const g = r.g, counts = {}; ids(r).forEach(i => counts[i] = g.hands[i].length);
    return { hand: g.hands[id] || [], counts, turn: g.turn, top: g.disc[g.disc.length - 1], color: g.color, dir: g.dir, drawN: g.draw.length,
      drawn: g.turn === id ? g.drawn : null, scores: g.scores, round: g.round, target: TARGET, pickColor: g.pickColor,
      challenge: g.challenge && { by: g.challenge.by, player: g.challenge.player }, unoRisk: g.unoRisk, between: g.between,
      roundWin: g.roundWin, roundPts: g.roundPts, win: g.win };
  }
};

module.exports = { bluff, speed, crazy8, uno };
