// Change MASSPOKE_SERVER_URL to override; electron-store can also override at runtime.
module.exports = {
  // Client Render (Tumas) — masspoke-server.onrender.com. Local: http://localhost:3000
  SERVER_URL:
    process.env.MASSPOKE_SERVER_URL || 'https://masspoke-server.onrender.com',
  OAUTH_LOOPBACK_HOST: '127.0.0.1',
  OAUTH_LOOPBACK_PORT: 3847,
};
