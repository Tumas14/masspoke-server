const { getGuild, listGuilds } = require('./db');
const {
  fetchDiscordUser,
  fetchUserGuilds,
  refreshAccessToken,
} = require('./discordAuth');

/** userId -> Set of socket ids */
const userSockets = new Map();

function trackSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}

function untrackSocket(userId, socketId) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSockets.delete(userId);
}

async function resolveAccessToken(auth) {
  if (!auth) return null;
  if (auth.accessToken) return auth.accessToken;

  if (auth.refreshToken) {
    const tokens = await refreshAccessToken(auth.refreshToken);
    return tokens.access_token;
  }
  return null;
}

/**
 * Check which configured guilds this user may join (has masspoke role).
 * Uses bot client for member role lookup when available.
 */
async function guildsUserCanJoin(discordClient, accessToken) {
  const userGuilds = await fetchUserGuilds(accessToken);
  const configured = await listGuilds();
  const configuredIds = new Set(configured.map((g) => g.guildId));
  const mutual = userGuilds.filter((g) => configuredIds.has(g.id));

  const allowed = [];
  for (const g of mutual) {
    const cfg = await getGuild(g.id);
    if (!cfg || !discordClient) continue;

    const guild = discordClient.guilds.cache.get(g.id);
    if (!guild) continue;

    try {
      const user = await fetchDiscordUser(accessToken);
      const member = await guild.members.fetch(user.id);
      if (member.roles.cache.has(cfg.roleId)) {
        allowed.push(cfg);
      }
    } catch (err) {
      console.log(`[Socket] Role check failed for guild ${g.id}:`, err.message);
    }
  }
  return allowed;
}

function attachSocketHub(io, getDiscordClient) {
  io.use(async (socket, next) => {
    try {
      const accessToken = await resolveAccessToken(socket.handshake.auth || {});
      if (!accessToken) {
        return next(new Error('Unauthorized: missing Discord token'));
      }

      const user = await fetchDiscordUser(accessToken);
      socket.data.userId = user.id;
      socket.data.username = user.global_name || user.username;
      socket.data.accessToken = accessToken;
      socket.data.refreshToken = socket.handshake.auth?.refreshToken || null;
      next();
    } catch (err) {
      console.log('[Socket] Auth failed:', err.message);
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;
    trackSocket(userId, socket.id);
    console.log(`[Socket] Connected ${socket.data.username} (${userId})`);

    try {
      const discordClient = getDiscordClient();
      const allowed = await guildsUserCanJoin(
        discordClient,
        socket.data.accessToken
      );
      for (const g of allowed) {
        socket.join(`guild:${g.guildId}`);
      }
      socket.emit('ready', {
        userId,
        username: socket.data.username,
        guilds: allowed.map((g) => g.guildId),
      });
      console.log(
        `[Socket] ${socket.data.username} joined ${allowed.length} guild room(s)`
      );
    } catch (err) {
      console.error('[Socket] Join rooms failed:', err);
      socket.emit('error_message', { message: 'Failed to sync guild roles' });
    }

    socket.on('refresh_guilds', async () => {
      try {
        const discordClient = getDiscordClient();
        for (const room of [...socket.rooms]) {
          if (room.startsWith('guild:')) socket.leave(room);
        }
        const allowed = await guildsUserCanJoin(
          discordClient,
          socket.data.accessToken
        );
        for (const g of allowed) {
          socket.join(`guild:${g.guildId}`);
        }
        socket.emit('ready', {
          userId,
          username: socket.data.username,
          guilds: allowed.map((g) => g.guildId),
        });
      } catch (err) {
        console.error('[Socket] refresh_guilds failed:', err);
      }
    });

    socket.on('disconnect', () => {
      untrackSocket(userId, socket.id);
      console.log(`[Socket] Disconnected ${socket.data.username}`);
    });
  });
}

/** Remove user from a guild room across all their sockets (role lost). */
function revokeGuildAccess(io, userId, guildId) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (s) {
      s.leave(`guild:${guildId}`);
      s.emit('guild_revoked', { guildId });
    }
  }
}

function emitPoke(io, guildId, payload) {
  io.to(`guild:${guildId}`).emit('poke', payload);
}

module.exports = {
  attachSocketHub,
  revokeGuildAccess,
  emitPoke,
  guildsUserCanJoin,
};
