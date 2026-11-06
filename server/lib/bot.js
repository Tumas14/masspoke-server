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
      GatewayIntentBits.GuildVoiceStates,
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

    if (content === '!mm' || content.startsWith('!mm ')) {
      await handleMassMove(message);
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

const MOVE_BATCH_SIZE = 5;

async function handleMassMove(message) {
  try {
    const cfg = await getGuild(message.guild.id);
    if (!cfg) {
      await message
        .reply(
          'This server is not configured. An admin must run `!mpconfig #channel @role` first.'
        )
        .catch(() => {});
      return;
    }

    const caller =
      message.member ||
      (await message.guild.members.fetch(message.author.id));
    if (!caller.roles.cache.has(cfg.roleId)) {
      await message
        .reply('You need the Masspoke role to use `!mm`.')
        .catch(() => {});
      return;
    }

    const destination = caller.voice?.channel;
    if (!destination) {
      await message
        .reply('Join a voice channel first, then type `!mm`.')
        .catch(() => {});
      return;
    }

    const me = message.guild.members.me;
    const canMove = Boolean(me?.permissions.has(PermissionFlagsBits.MoveMembers));
    const canConnect = Boolean(
      me && destination.permissionsFor(me)?.has(PermissionFlagsBits.Connect)
    );
    if (!canMove || !canConnect) {
      await message
        .reply(
          'The bot needs **Move Members** and **Connect** on that voice channel, and its role must be above the people it moves.'
        )
        .catch(() => {});
      return;
    }

    await message.guild.members.fetch();

    let alreadyHere = 0;
    let notInVoice = 0;
    const toMove = [];

    for (const member of message.guild.members.cache.values()) {
      if (member.user.bot || !member.roles.cache.has(cfg.roleId)) continue;
      if (member.id === caller.id) continue;

      const current = member.voice?.channel;
      if (!current) {
        notInVoice += 1;
        continue;
      }
      if (current.id === destination.id) {
        alreadyHere += 1;
        continue;
      }
      toMove.push(member);
    }

    const { moved, failed } = await moveInBatches(toMove, destination);

    console.log(
      `[MassMove] ${caller.displayName} @ ${message.guild.name} → ${destination.name}: moved ${moved}, already ${alreadyHere}, not in voice ${notInVoice}, failed ${failed}`
    );

    await message
      .reply(
        `Mass move to **${destination.name}**.\nMoved: ${moved}\nAlready there: ${alreadyHere}\nNot in voice: ${notInVoice}\nFailed: ${failed}`
      )
      .catch(() => {});
  } catch (error) {
    console.error('[Error] Processing !mm:', error);
    await message
      .reply('Mass move failed. Check that the bot is above the Masspoke role and can move members.')
      .catch(() => {});
  }
}

async function moveInBatches(members, channel) {
  let moved = 0;
  let failed = 0;

  for (let i = 0; i < members.length; i += MOVE_BATCH_SIZE) {
    const batch = members.slice(i, i + MOVE_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (member) => {
        try {
          await member.voice.setChannel(channel);
          return true;
        } catch (err) {
          console.error(
            `[MassMove] Failed to move ${member.user?.tag || member.id}:`,
            err.message
          );
          return false;
        }
      })
    );
    for (const ok of results) {
      if (ok) moved += 1;
      else failed += 1;
    }
  }

  return { moved, failed };
}

module.exports = {
  startBot,
  getClient,
};
