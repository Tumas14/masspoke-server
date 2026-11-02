const express = require('express');
const crypto = require('crypto');
const config = require('./config');
const {
  getAuthorizeUrl,
  exchangeCode,
  fetchDiscordUser,
  createPendingSession,
  consumePendingSession,
  refreshAccessToken,
} = require('./discordAuth');

function createAuthRouter() {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json({
      oauthConfigured: config.oauthConfigured,
      botConfigured: config.botConfigured,
      publicUrl: config.publicUrl,
      redirectUri: config.discordRedirectUri,
    });
  });

  /** Electron opens this in the system browser */
  router.get('/discord', (req, res) => {
    if (!config.oauthConfigured) {
      return res
        .status(503)
        .send(
          'Discord OAuth is not configured yet. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in server .env.'
        );
    }

    const state = crypto.randomBytes(16).toString('hex');
    // state is only for CSRF; Electron does not need to store it for MVP
    res.redirect(getAuthorizeUrl(state));
  });

  /**
   * Discord redirects here when DISCORD_REDIRECT_URI points at the server.
   * Preferred Electron flow uses loopback; this path supports server-side redirect URI too.
   */
  router.get('/discord/callback', async (req, res) => {
    try {
      if (!config.oauthConfigured) {
        return res.status(503).send('OAuth not configured');
      }
      const { code, error } = req.query;
      if (error) return res.status(400).send(`Discord error: ${error}`);
      if (!code) return res.status(400).send('Missing code');

      const tokens = await exchangeCode(String(code));
      const user = await fetchDiscordUser(tokens.access_token);
      const sessionCode = createPendingSession({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        userId: user.id,
        username: user.global_name || user.username,
      });

      const loopback = new URL(config.discordRedirectUri);
      loopback.searchParams.set('session', sessionCode);
      res.redirect(loopback.toString());
    } catch (err) {
      console.error('[Auth] callback error:', err);
      res.status(500).send('Login failed. You can close this window.');
    }
  });

  /** Electron loopback posts the OAuth code here for exchange */
  router.post('/discord/exchange', express.json(), async (req, res) => {
    try {
      if (!config.oauthConfigured) {
        return res.status(503).json({
          error: 'OAuth not configured. Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.',
        });
      }

      const { code, session } = req.body || {};

      if (session) {
        const pending = consumePendingSession(String(session));
        if (!pending) {
          return res.status(400).json({ error: 'Invalid or expired session code' });
        }
        return res.json({
          accessToken: pending.accessToken,
          refreshToken: pending.refreshToken,
          expiresIn: pending.expiresIn,
          userId: pending.userId,
          username: pending.username,
        });
      }

      if (!code) {
        return res.status(400).json({ error: 'Missing code or session' });
      }

      const tokens = await exchangeCode(String(code));
      const user = await fetchDiscordUser(tokens.access_token);
      return res.json({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        userId: user.id,
        username: user.global_name || user.username,
      });
    } catch (err) {
      console.error('[Auth] exchange error:', err);
      res.status(500).json({ error: err.message || 'Exchange failed' });
    }
  });

  router.post('/discord/refresh', express.json(), async (req, res) => {
    try {
      if (!config.oauthConfigured) {
        return res.status(503).json({ error: 'OAuth not configured' });
      }
      const { refreshToken } = req.body || {};
      if (!refreshToken) {
        return res.status(400).json({ error: 'Missing refreshToken' });
      }
      const tokens = await refreshAccessToken(String(refreshToken));
      const user = await fetchDiscordUser(tokens.access_token);
      res.json({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
        userId: user.id,
        username: user.global_name || user.username,
      });
    } catch (err) {
      console.error('[Auth] refresh error:', err);
      res.status(401).json({ error: 'Refresh failed' });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
