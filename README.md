# 🃏 Card Room

Real-time multiplayer card games (Bluff, Speed, Crazy Eights) built with Socket.IO.

- `server/` – Node + Express + Socket.IO. Server-authoritative: hands are private, moves are validated, players can reconnect.
- `client/` – static site (no build step). Deploy on Vercel.

## Run locally
```bash
cd server && npm install && npm start      # http://localhost:3001
cd client && npx serve .                   # or: python3 -m http.server 3000
```
Open the client in two browser windows, create a room in one, join with the code in the other.

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
Add an object to `server/games.js` with `min`, `max`, `init(room)`, `act(room,id,action)` (return `null` if invalid, else a message string) and `view(room,id)` (the private state sent to each player), export it, then add a render function and a lobby card in `client/app.js`.

## Notes
State lives in server memory; restarting the server ends all rooms. Run a single server instance (or add the Socket.IO Redis adapter to scale out).
