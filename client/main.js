const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const io = require('socket.io-client');
const Store = require('electron-store');
const config = require('./config');

const store = new Store();
let mainWindow;
let loginWindow;
let socket;
let loopbackServer;

const SERVER_URL = store.get('serverUrl', config.SERVER_URL);

function createPokeWindow() {
  const savedPos = store.get('windowPosition', { x: undefined, y: undefined });

  mainWindow = new BrowserWindow({
    width: 380,
    height: 180,
    x: savedPos.x,
    y: savedPos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  connectSocket();

  mainWindow.on('move', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowPosition', { x, y });
  });
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 400,
    height: 360,
    resizable: false,
    maximizable: false,
    title: 'Masspoke Login',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  loginWindow.loadFile(path.join(__dirname, 'login.html'));
  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}

function connectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  const accessToken = store.get('accessToken');
  const refreshToken = store.get('refreshToken');
  if (!accessToken) return;

  socket = io(SERVER_URL, {
    reconnection: true,
    auth: { accessToken, refreshToken },
  });

  socket.on('connect', () => {
    console.log('[Masspoke] Socket connected');
  });

  socket.on('connect_error', async (err) => {
    console.log('[Masspoke] Socket auth/connect error:', err.message);
    if (String(err.message).toLowerCase().includes('unauthorized')) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        connectSocket();
      } else {
        clearSession();
        if (mainWindow) {
          mainWindow.close();
          mainWindow = null;
        }
        createLoginWindow();
      }
    }
  });

  socket.on('poke', (data) => {
    if (mainWindow) mainWindow.webContents.send('trigger-poke', data);
  });

  socket.on('guild_revoked', (data) => {
    console.log('[Masspoke] Guild access revoked:', data.guildId);
  });
}

async function tryRefreshToken() {
  const refreshToken = store.get('refreshToken');
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${SERVER_URL}/auth/discord/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    store.set('accessToken', data.accessToken);
    if (data.refreshToken) store.set('refreshToken', data.refreshToken);
    store.set('userId', data.userId);
    store.set('username', data.username);
    return true;
  } catch {
    return false;
  }
}

function clearSession() {
  store.delete('accessToken');
  store.delete('refreshToken');
  store.delete('userId');
  store.delete('username');
}

function stopLoopback() {
  if (loopbackServer) {
    loopbackServer.close();
    loopbackServer = null;
  }
}

function startLoopbackAndLogin() {
  stopLoopback();

  loopbackServer = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, `http://${config.OAUTH_LOOPBACK_HOST}:${config.OAUTH_LOOPBACK_PORT}`);
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const session = reqUrl.searchParams.get('session');
      const error = reqUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h3>Login cancelled</h3><p>You can close this window.</p>');
        notifyLogin(false, `Discord error: ${error}`);
        stopLoopback();
        return;
      }

      const body = session ? { session } : { code };
      const exchangeRes = await fetch(`${SERVER_URL}/auth/discord/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await exchangeRes.json();
      if (!exchangeRes.ok) {
        throw new Error(data.error || 'Exchange failed');
      }

      store.set('accessToken', data.accessToken);
      store.set('refreshToken', data.refreshToken);
      store.set('userId', data.userId);
      store.set('username', data.username);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h3>Masspoke login OK</h3><p>You can close this window and return to the app.</p>');
      notifyLogin(true, `Logged in as ${data.username}`);
      stopLoopback();

      if (loginWindow) {
        loginWindow.close();
        loginWindow = null;
      }
      if (!mainWindow) createPokeWindow();
    } catch (err) {
      console.error('[Masspoke] OAuth callback error:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h3>Login failed</h3><p>You can close this window.</p>');
      notifyLogin(false, err.message || 'Login failed');
      stopLoopback();
    }
  });

  loopbackServer.listen(config.OAUTH_LOOPBACK_PORT, config.OAUTH_LOOPBACK_HOST, () => {
    // Prefer server-hosted authorize URL (handles missing OAuth config messaging)
    shell.openExternal(`${SERVER_URL}/auth/discord`);
  });

  loopbackServer.on('error', (err) => {
    notifyLogin(false, `Could not start local login listener: ${err.message}`);
  });
}

function notifyLogin(ok, message) {
  if (loginWindow) {
    loginWindow.webContents.send('login-status', { ok, message });
  }
}

ipcMain.on('start-discord-login', () => {
  startLoopbackAndLogin();
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setIgnoreMouseEvents(ignore, options);
});

ipcMain.on('select-audio-file', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audios', extensions: ['mp3', 'wav'] }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    event.reply('audio-selected', result.filePaths[0]);
  }
});

ipcMain.on('logout', () => {
  clearSession();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  createLoginWindow();
});

app.whenReady().then(() => {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
  });

  if (store.get('accessToken')) {
    createPokeWindow();
  } else {
    createLoginWindow();
  }
});

app.on('window-all-closed', () => {
  stopLoopback();
  if (process.platform !== 'darwin') app.quit();
});
