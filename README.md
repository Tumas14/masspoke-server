# Masspoke

Discord bot plus a Windows desktop overlay. One bot and one cloud server cover every Discord server. Each server keeps its own channel, role, pokes, and voice moves.

Live server: https://masspoke-server.onrender.com

Wake it (free Render sleeps when idle): https://masspoke-server.onrender.com/health

Wait until the page shows `"ok": true`. The bot is online only after that.

## What each part does

| Piece | What it is for |
| --- | --- |
| Discord bot | Reads `!mpconfig`, `!mp`, and `!mm` |
| Desktop app | Shows the poke popup. Not used for mass move |
| Postgres on Render | Remembers each server's channel and role |
| `!mp` | Poke people who have the role and the app open |
| `!mm` | Move people who have the role and are already in a voice channel |

A redeploy does not wipe server setup. Do not run `!mpconfig` again after a deploy unless you want to change the channel or role.

## Discord application (once)

The bot runs under one Discord application. Do not create a new application per server.

In the Developer Portal, on that application:

1. Bot token is stored on Render as `DISCORD_TOKEN`. Resetting the token means updating Render and redeploying.
2. Turn on the privileged intents **Message Content** and **Server Members**.
3. OAuth2 redirect must include exactly `http://127.0.0.1:3847/callback` so the desktop app can log in.
4. Client ID and Client Secret are stored on Render as `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. The Client ID is public. The secret and the bot token are not.

`GuildVoiceStates` is enabled in code. It is not a privileged intent, so the portal has no extra switch for it.

## Invite the bot

Anyone with **Manage Server** can add the bot. They do not need the Developer Portal.

Permanent invite (same link for every server):

https://discord.com/oauth2/authorize?client_id=1566843251531448350&scope=bot&permissions=286329856

Open it, choose the server, click **Authorize**.

That permission set includes:

- View Channels
- Send Messages
- Read Message History
- Manage Roles
- Connect
- Move Members

On a server that already has the bot, opening the link again adds any missing permissions.

### Role order

The bot's role must sit **above** the Masspoke role. A bot cannot move or manage members ranked above it.

On Spanish Mafia the bot role is **Bots** (the role with the bot as its member) and the user role is **Masspoke**. Bots is already above Masspoke, with View Channels, Send Messages, Connect, and Move Members on.

Check the bot user itself if a move says the bot lacks permission. The role you edited must be the role the bot account actually has.

## Set up a Discord server (once per server)

1. Invite the bot.
2. Create a text channel and a role, or reuse existing ones.
3. As a server admin, type:

```
!mpconfig #your-channel @your-role
```

Example:

```
!mpconfig #masspoke @Masspoke
```

You can also pass raw IDs: `!mpconfig CHANNEL_ID ROLE_ID`.

4. Give that role to everyone who should receive pokes and be included in a mass move.

The bot replies with the channel and role it saved. That pair is stored per Discord server. Server A cannot poke or move Server B.

Run `!mpconfig` again only when you want to change the channel or the role. A new deploy does not require it.

Admins only: the person who runs `!mpconfig` needs Administrator or Manage Server.

## Poke with `!mp`

This uses the desktop app. It does not move anyone in Discord.

1. Wake https://masspoke-server.onrender.com/health if the bot has been idle.
2. The sender needs the configured role.
3. In the text channel from `!mpconfig`, type:

```
!mp hello
```

The text after `!mp` is the popup message. `!mp` alone still sends a poke.

Who sees it:

- They have that server's role.
- They are logged into the Masspoke desktop app.
- The app is connected.

People without the app get nothing. The command does nothing in other text channels, and it does nothing if the sender lacks the role.

If the role is removed from someone, their app drops that server.

## Mass move with `!mm`

This is Discord only. Nobody needs the desktop app.

You do not name a channel or a person.

1. Wake the health URL if the bot has been idle.
2. Join the voice channel you want people to come to.
3. Use an account that has the Masspoke role.
4. In any text channel the bot can read, type:

```
!mm
```

How the bot decides:

- Destination: the voice channel **you** are in when you type `!mm`.
- Who: other members on **this** server who have the role from `!mpconfig`.
- From: whatever voice channel each of those people is already in. Different channels are fine. They are moved together into yours.

The bot replies with four counts:

- Moved
- Already there
- Not in voice
- Failed

People who are not in a voice channel stay where they are. Discord cannot pull someone into voice. The person who typed `!mm` is not moved. Other Discord servers are not touched.

`!mm` fails or skips people when:

- You are not in a voice channel.
- You do not have the Masspoke role.
- This server has never had `!mpconfig`.
- The bot role is missing Move Members or Connect, or it is below the people it should move.
- The destination voice channel is full.

No server setting and no `!mpconfig` need to be run again after a redeploy if they were already saved.

## Add another Discord server

Same bot, same invite link, same desktop app.

1. Open the invite link and authorize the new server.
2. As an admin on that server, run `!mpconfig #channel @role` once.
3. Give that role to the people who should be included.

No code change. No new Discord application. No new `.exe`.

## Desktop app

The app talks to `https://masspoke-server.onrender.com` (override with `MASSPOKE_SERVER_URL` or the saved `serverUrl` in electron-store).

Login:

1. Open the app.
2. Log in with Discord. The app listens on `http://127.0.0.1:3847/callback`.
3. Leave it running. Pokes show as a small always-on-top popup for about 3 seconds.

The app joins a room only for servers where that Discord user has the configured role. Mass move does not go through the app.

Build the Windows installer from `client/` with electron-builder when you ship a new `.exe`. Changing only the bot does not require a new installer.

## Render

Production service: `masspoke-server` at https://masspoke-server.onrender.com

It deploys from `main` on https://github.com/Tumas14/masspoke-server when that branch is pushed. This GitHub repo is the working copy. Push the same server commit to `Tumas14/masspoke-server` when the live bot should update.

Environment on the Render service (values stay in the dashboard, not in git):

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` = `http://127.0.0.1:3847/callback`
- `SESSION_SECRET`
- `DATABASE_URL` (Render Postgres)
- `PUBLIC_URL` = `https://masspoke-server.onrender.com`
- `CLIENT_ORIGIN`

See `server/.env.example` for the local names. Never commit `server/.env`.

After a deploy, open the health URL. Logs should show `Connected to Postgres`, `Listening on port 10000`, and `Connected as Masspoke-Test#...`.

Free Render sleeps. The first health check after sleep can take up to a minute. Commands typed while it is asleep do nothing until the bot is connected again.

## Level and vocation nicknames

`!add` changes the **server nickname**, not the global Discord username. The result looks like `TUMAS [ED lvl131]`.

- `!add 131` sets your level and keeps the saved vocation
- `!add ED` sets your vocation and keeps the saved level
- `!add 131 ED` sets both
- `!add 131 ED @Name` sets both on that member

Level is any whole number from 1 to 9999. Vocation is `EK`, `RP`, `ED`, `MS`, or `EM`. Sending only one value keeps the other. Anyone can update themselves. Changing someone else requires Administrator or Manage Nicknames.

The bot role needs **Manage Nicknames** and must sit above the member. On Spanish Mafia that role is **Masspoke-Test**, placed under **Admin**.

## Command cheat sheet

| Command | Who | Where | Effect |
| --- | --- | --- | --- |
| `!mpconfig #channel @role` | Server admin | Any text channel | Save this server's poke channel and role. Once, or when changing them |
| `!mp message` | Someone with the role | The saved text channel | Popup for role members who have the app open |
| `!mm` | Someone with the role, already in voice | Any text channel | Move other role members who are in voice into your voice channel |
| `!add 131 ED` | Anyone, on themselves | Any text channel | Set nickname to `Name [ED lvl131]`. Admins can add `@member` |

## Local development

```bash
cd server
cp .env.example .env
# fill tokens, then:
npm install
npm start
```

Point the desktop app at `http://localhost:3000` with `MASSPOKE_SERVER_URL` while testing locally. Leave `DATABASE_URL` empty to use an in-memory guild store that disappears when the process stops.
