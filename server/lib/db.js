const { Pool } = require('pg');
const config = require('./config');

/** @type {Map<string, { guildId: string, channelId: string, roleId: string }>} */
const memoryGuilds = new Map();

/** @type {Map<string, { guildId: string, userId: string, baseName: string, vocation: string|null, level: number|null }>} */
const memoryTags = new Map();

let pool = null;
let usingMemory = true;

async function initDb() {
  if (!config.databaseUrl) {
    usingMemory = true;
    console.log('[DB] DATABASE_URL empty — using in-memory guild store');
    return;
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_tags (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      base_name TEXT NOT NULL,
      vocation TEXT,
      level INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  usingMemory = false;
  console.log('[DB] Connected to Postgres');
}

async function upsertGuild({ guildId, channelId, roleId }) {
  if (usingMemory) {
    memoryGuilds.set(guildId, { guildId, channelId, roleId });
    return memoryGuilds.get(guildId);
  }

  await pool.query(
    `INSERT INTO guilds (guild_id, channel_id, role_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (guild_id)
     DO UPDATE SET channel_id = EXCLUDED.channel_id,
                   role_id = EXCLUDED.role_id,
                   updated_at = NOW()`,
    [guildId, channelId, roleId]
  );
  return { guildId, channelId, roleId };
}

async function getGuild(guildId) {
  if (usingMemory) {
    return memoryGuilds.get(guildId) || null;
  }

  const { rows } = await pool.query(
    'SELECT guild_id AS "guildId", channel_id AS "channelId", role_id AS "roleId" FROM guilds WHERE guild_id = $1',
    [guildId]
  );
  return rows[0] || null;
}

async function listGuilds() {
  if (usingMemory) {
    return Array.from(memoryGuilds.values());
  }

  const { rows } = await pool.query(
    'SELECT guild_id AS "guildId", channel_id AS "channelId", role_id AS "roleId" FROM guilds'
  );
  return rows;
}

function tagKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function getMemberTag(guildId, userId) {
  if (usingMemory) {
    return memoryTags.get(tagKey(guildId, userId)) || null;
  }

  const { rows } = await pool.query(
    `SELECT guild_id AS "guildId", user_id AS "userId", base_name AS "baseName",
            vocation, level
     FROM member_tags WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  return rows[0] || null;
}

async function upsertMemberTag({ guildId, userId, baseName, vocation, level }) {
  const row = { guildId, userId, baseName, vocation, level };
  if (usingMemory) {
    memoryTags.set(tagKey(guildId, userId), row);
    return row;
  }

  await pool.query(
    `INSERT INTO member_tags (guild_id, user_id, base_name, vocation, level, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET base_name = EXCLUDED.base_name,
                   vocation = EXCLUDED.vocation,
                   level = EXCLUDED.level,
                   updated_at = NOW()`,
    [guildId, userId, baseName, vocation, level]
  );
  return row;
}

function isMemory() {
  return usingMemory;
}

module.exports = {
  initDb,
  upsertGuild,
  getGuild,
  listGuilds,
  getMemberTag,
  upsertMemberTag,
  isMemory,
};
