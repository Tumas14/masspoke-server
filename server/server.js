const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./lib/config');
const { initDb } = require('./lib/db');
const { createAuthRouter } = require('./lib/authRoutes');
const { attachSocketHub } = require('./lib/socketHub');
const { startBot, getClient } = require('./lib/bot');

async function main() {
  await initDb();

  const app = express();
  app.use(
    cors({
      origin: config.clientOrigin === '*' ? true : config.clientOrigin,
    })
  );
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      oauthConfigured: config.oauthConfigured,
      botConfigured: config.botConfigured,
    });
  });

  app.use('/auth', createAuthRouter());

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: config.clientOrigin === '*' ? true : config.clientOrigin,
    },
  });

  attachSocketHub(io, getClient);
  startBot(io);

  server.listen(config.port, () => {
    console.log(`[Servidor] Listening on port ${config.port}`);
    console.log(`[Servidor] PUBLIC_URL=${config.publicUrl}`);
    if (!config.oauthConfigured) {
      console.warn(
        '[Servidor] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET empty — login will wait until you fill .env'
      );
    }
    if (!config.botConfigured) {
      console.warn('[Servidor] DISCORD_TOKEN empty — bot not started');
    }
  });
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
