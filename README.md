# 🃏 Card Room

Real-time multiplayer card games (War, Blackjack Duel, Speed, Bluff, Crazy Eights, UNO) built with Socket.IO.

- `server/` – Node + Express + Socket.IO. Server-authoritative: hands stay private, every move is validated, players can reconnect.
- `client/` – static site, no build step. Deploy on Vercel.

## Games
- **⚔️ War (2 players):** Classic card battle duel! Flip your cards simultaneously; high card wins the trick. Tied ranks declare **WAR!** with face-down spoils cards and a deciding showdown!
- **🃏 Blackjack Duel (2 players):** Head-to-head 21 showdown. Hit or stand to outplay your opponent in a best-of-5 rounds casino duel.
- **⚡ Speed (2 players):** Real-time card slinging. Play cards one rank above or below center piles with lightning reflexes.
- **🎭 Bluff (2–6 players):** Shed your hand. Lie about what you play, call out bluffs, or pass if you dare.
- **🎱 Crazy Eights (2–6 players):** Match suit or rank. Eights are wild. Clear your hand first to win.
- **🌈 UNO (2–6 players):** Classic rules, multi-card plays, Wild challenges, and 500-point match scoring.

## UI Dynamics & Game Feel
- **Visuals:** Casino green velvet felt table with rim lighting, depth shadows, natural card hand fanning, and 3D hover elevations.
- **Card Motion & Dynamics:** Physical card throw animations flying smoothly from hand to table, table impact bounce, and dynamic legal play glows.
- **Sound Effects Engine:** High-performance synthesized Web Audio effects (card snaps, draws, poker chip clicks, turn chimes, victory fanfare, timer ticks) with an in-header mute toggle.
- **Celebration:** Physics-based confetti burst on victory.
- **Real-Time Reactions:** Quick emoji reaction bar (👏, 🔥, 😮, 😂, 🃏, 💀, 💥, ⚔️) that float across the table in real-time.
- **Haptic Feedback:** Vibration alerts for turn changes and high-stakes plays on supported devices.

## Features
- **Invite links:** `https://your-site/?room=ABCD`, with a Copy/Share button (native share sheet on phones).
- **Turn timer:** The host picks 20–90 s. After a timeout the server plays for you. Disconnected players get a grace period, then autoplay.
- **Host powers:** Kick/ban players, hand over host, lock the room, change the timer, end game.
- **Chat & Reactions:** Rate-limited room chat and floating emoji reactions.
- **Spam protection:** per-socket token-bucket rate limits, payload size cap, per-IP connection cap, validated inputs, and handler try/catch so a bad packet can't crash the process. The client also blocks double-taps.
- **UNO (classic rules):** 108-card deck, flip edge cases, multi-card plays of the same number/symbol in one turn (the last card sets the colour), Wild +4 challenge, UNO call + catch window, round scoring and a 500-point match. No +2/+4 stacking (classic).

## Run locally
```bash
cd server && npm install && npm start      # http://localhost:3001
cd client && npx serve .                   # or: python3 -m http.server 3000
```
Open the client in two browser windows, create a room in one and join with the code or invite link in the other.

## Deploy
Vercel serverless functions can't hold WebSocket connections, so the app is split:

1. **Server → Render / Railway / Fly.io** (needs a long-running Node process)
   - Render: New Web Service → root directory `server`, build `npm install`, start `npm start`.
   - Environment variable: `CLIENT_ORIGIN=https://your-app.vercel.app` (comma-separate multiple origins).
2. **Client → Vercel**
   - Import the repo, set **Root Directory** to `client`, framework preset "Other". No build command.
   - Edit `client/config.js` and replace `https://YOUR-SERVER.onrender.com` with your server URL.

Free Render instances sleep when idle, so the first connection can take ~30–60 s.

## Adding a game
Add an object to `server/games.js` with `min`, `max`, `init(room)`, `act(room,id,action)` (return `null` if invalid, else a message string) and `view(room,id)`. For turn timers also add `waiting(room)` (id the game waits on) and `auto(room,id)` (an action to play for an idle player). Export it, then add a render function and a lobby card in `client/app.js`.

## Notes
State lives in server memory; restarting the server ends all rooms. Run a single server instance (or add the Socket.IO Redis adapter to scale out). Leaving or being kicked mid-game ends the game for everyone.
