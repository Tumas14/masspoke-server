// Change MASSPOKE_SERVER_URL to override; electron-store can also override at runtime.
module.exports = {
  // Free Render staging (Nure Kowser). For local bot testing use http://localhost:3000
  SERVER_URL:
    process.env.MASSPOKE_SERVER_URL || 'https://masspoke-test.onrender.com',
  OAUTH_LOOPBACK_HOST: '127.0.0.1',
  OAUTH_LOOPBACK_PORT: 3847,
};
