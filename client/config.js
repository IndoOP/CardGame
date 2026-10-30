// Point this at your deployed socket.io server (Render/Railway/Fly), e.g. "https://card-room.onrender.com"
window.SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : 'https://cardgame-ek3o.onrender.com';
