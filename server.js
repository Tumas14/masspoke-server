const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');
const { Server } = require('socket.io');

// 1. Configuración del Bot con Intents necesarios
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// 2. Configurar servidor HTTP y WebSockets para el cliente Electron
const server = http.createServer();
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`[Servidor] Escuchando conexiones en el puerto ${PORT}`);
});

// IDs fijos de tu canal y tu rol manual
const TARGET_CHANNEL_ID = '1565376624818389182';
const ALLOWED_ROLE_ID = '1565422239237800157';

client.once('ready', () => {
  console.log(`[Bot] Conectado y listo como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignorar bots y otros canales
  if (message.author.bot) return;
  if (message.channel.id !== TARGET_CHANNEL_ID) return;

  if (message.content.startsWith('!mp')) {
    try {
      // Obtener el miembro del servidor para comprobar sus roles
      const member = message.member || await message.guild.members.fetch(message.author.id);
      
      // Comprobar si tiene el rol permitido
      const hasRole = member.roles.cache.has(ALLOWED_ROLE_ID);

      if (!hasRole) {
        console.log(`[Seguridad] El usuario ${message.author.tag} no tiene el rol Masspoke requerido.`);
        return;
      }

      const pokeMessage = message.content.slice(3).trim() || "¡Poke recibido!";
      console.log(`[Masspoke] Comando válido de ${message.author.displayName}: "${pokeMessage}"`);

      // Reaccionar con tic verde en Discord
      await message.react('✅').catch((err) => console.log('No se pudo reaccionar:', err));

      // Enviar la alerta al cliente Electron
      io.emit('poke', {
        sender: message.author.displayName,
        message: pokeMessage
      });

    } catch (error) {
      console.error('[Error] Al procesar el mensaje:', error);
    }
  }
});

// Pon aquí el Token real de tu Bot de Discord
client.login('MTU2NTM3NDQ2NzEwNDk2NDcyMA.G1R4T0.uI_zwVwqZN3oRdvoHhtZAMgzofCQYVsWrxP47s');