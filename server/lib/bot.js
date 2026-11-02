const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('./config');
const { getGuild, upsertGuild } = require('./db');
const { emitPoke, revokeGuildAccess } = require('./socketHub');

let client = null;

function getClient() {
  return client;
}

function startBot(io) {
  if (!config.botConfigured) {
    console.warn('[Bot] DISCORD_TOKEN missing — bot not started');
    return null;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.GuildMember],
  });

  client.once('clientReady', () => {
    console.log(`[Bot] Connected as ${client.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();

    // Admin setup: !mpconfig #channel @role  OR  !mpconfig <channelId> <roleId>
    if (content.startsWith('!mpconfig')) {
      await handleConfigCommand(message);
      return;
    }

    if (!content.startsWith('!mp')) return;

    try {
      const cfg = await getGuild(message.guild.id);
      if (!cfg) {
        console.log(
          `[Masspoke] Guild ${message.guild.id} not configured (!mpconfig)`
        );
        return;
      }

      if (message.channel.id !== cfg.channelId) return;

      const member =
        message.member ||
        (await message.guild.members.fetch(message.author.id));
      if (!member.roles.cache.has(cfg.roleId)) {
        console.log(
          `[Seguridad] ${message.author.tag} missing masspoke role in ${message.guild.name}`
        );
        return;
      }

      const pokeMessage = content.slice(3).trim() || '¡Poke recibido!';
      console.log(
        `[Masspoke] ${message.author.displayName} @ ${message.guild.name}: "${pokeMessage}"`
      );

      await message.react('✅').catch((err) =>
        console.log('No se pudo reaccionar:', err.message)
      );

      emitPoke(io, message.guild.id, {
        sender: message.author.displayName,
        message: pokeMessage,
        guildId: message.guild.id,
        guildName: message.guild.name,
      });
    } catch (error) {
      console.error('[Error] Processing !mp:', error);
    }
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const cfg = await getGuild(newMember.guild.id);
      if (!cfg) return;

      const had = oldMember.roles.cache.has(cfg.roleId);
      const has = newMember.roles.cache.has(cfg.roleId);
      if (had && !has) {
        console.log(
          `[Seguridad] Role removed for ${newMember.user.tag} in ${newMember.guild.name}`
        );
        revokeGuildAccess(io, newMember.id, newMember.guild.id);
      }
    } catch (err) {
      console.error('[Bot] guildMemberUpdate error:', err);
    }
  });

  client.login(config.discordToken).catch((err) => {
    console.error('[Bot] Login failed:', err.message);
  });

  return client;
}

async function handleConfigCommand(message) {
  const member =
    message.member || (await message.guild.members.fetch(message.author.id));
  const canManage =
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!canManage) {
    await message.reply('Only server admins can run `!mpconfig`.').catch(() => {});
    return;
  }

  const channel =
    message.mentions.channels.first() ||
    message.guild.channels.cache.get(message.content.split(/\s+/)[1]);
  const role =
    message.mentions.roles.first() ||
    message.guild.roles.cache.get(message.content.split(/\s+/)[2]);

  if (!channel || !role) {
    await message
      .reply(
        'Usage: `!mpconfig #channel @role`\nExample: `!mpconfig #masspoke @masspoke`'
      )
      .catch(() => {});
    return;
  }

  await upsertGuild({
    guildId: message.guild.id,
    channelId: channel.id,
    roleId: role.id,
  });

  await message
    .reply(
      `Masspoke configured for this server.\nChannel: <#${channel.id}>\nRole: <@&${role.id}>\nUsers with that role who are logged into the app will receive \`!mp\` pokes from that channel.`
    )
    .catch(() => {});

  console.log(
    `[Config] Guild ${message.guild.id} → channel ${channel.id}, role ${role.id}`
  );
}

module.exports = {
  startBot,
  getClient,
};
