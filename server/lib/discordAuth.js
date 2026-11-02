const crypto = require('crypto');
const config = require('./config');

/** Short-lived codes so Electron loopback can finish login without exposing Discord tokens in URL long-term */
const pendingCodes = new Map();

function createPendingSession(payload) {
  const code = crypto.randomBytes(24).toString('hex');
  pendingCodes.set(code, {
    ...payload,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return code;
}

function consumePendingSession(code) {
  const entry = pendingCodes.get(code);
  pendingCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.discordClientId,
    response_type: 'code',
    redirect_uri: config.discordRedirectUri,
    scope: 'identify guilds',
    state,
    prompt: 'none',
  });
  // prompt=none fails if not logged in; use consent for first login
  params.set('prompt', 'consent');
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.discordRedirectUri,
  });

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
  }

  return tokenRes.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Discord user: ${res.status}`);
  return res.json();
}

async function fetchUserGuilds(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Discord guilds: ${res.status}`);
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Refresh failed: ${tokenRes.status} ${text}`);
  }

  return tokenRes.json();
}

module.exports = {
  createPendingSession,
  consumePendingSession,
  getAuthorizeUrl,
  exchangeCode,
  fetchDiscordUser,
  fetchUserGuilds,
  refreshAccessToken,
};
