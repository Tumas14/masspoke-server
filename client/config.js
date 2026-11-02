// Change MASSPOKE_SERVER_URL after Render deploy, or set at runtime via electron-store override.
module.exports = {
  // Local default while developing; replace with https://YOUR-SERVICE.onrender.com later
  SERVER_URL: process.env.MASSPOKE_SERVER_URL || 'http://localhost:3000',
  OAUTH_LOOPBACK_HOST: '127.0.0.1',
  OAUTH_LOOPBACK_PORT: 3847,
};
