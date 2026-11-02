require('dotenv').config();

function requiredHint(name) {
  return process.env[name] || '';
}

const config = {
  port: Number(process.env.PORT) || 3000,
  discordToken: requiredHint('DISCORD_TOKEN'),
  discordClientId: requiredHint('DISCORD_CLIENT_ID'),
  discordClientSecret: requiredHint('DISCORD_CLIENT_SECRET'),
  discordRedirectUri:
    process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1:3847/callback',
  sessionSecret:
    process.env.SESSION_SECRET || 'dev-change-me-masspoke-session-secret',
  databaseUrl: process.env.DATABASE_URL || '',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
};

config.oauthConfigured = Boolean(
  config.discordClientId && config.discordClientSecret
);
config.botConfigured = Boolean(config.discordToken);

module.exports = config;
