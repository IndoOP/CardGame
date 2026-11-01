# 🃏 Card Room

Real-time multiplayer card games (Bluff, Speed, Crazy Eights, UNO) built with Socket.IO.

- `server/` – Node + Express + Socket.IO. Server-authoritative: hands stay private, every move is validated, players can reconnect.
- `client/` – static site, no build step. Deploy on Vercel.

## Features
- **Invite links:** `https://your-site/?room=ABCD`, with a Copy/Share button (native share sheet on phones).
- **Turn timer:** the host picks 20–90 s. After a timeout the server plays for you. After two timeouts in a row you're marked *away* and autoplayed quickly until you act again. Disconnected players get a 12 s grace period, then autoplay. In Speed, a player offline for 30 s forfeits.
- **Host powers:** kick (and ban) players, hand over host, lock the room, change the timer, end the game.
- **Chat** in every room (messages are stripped of markup and rate limited).
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
