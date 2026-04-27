import { app, BrowserWindow } from 'electron';
import path from 'path';
import { setupIPC } from './ipc-handlers';
import type { ProfileManager } from './services/profile-manager/profile-manager';
import { LocalAPIServer } from './services/local-api/local-api-server';

let mainWindow: BrowserWindow | null = null;
let profileManager: ProfileManager | null = null;
let localApiServer: LocalAPIServer | null = null;
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Ken's Browser IM",
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const services = setupIPC();
    profileManager = services.profileManager;

    // Start Local API Server on port 5015
    try {
      localApiServer = new LocalAPIServer(profileManager, 'digitalid-local-api-key');
      await localApiServer.start(5015);
      console.log('Local API Server started on port 5015');
    } catch (apiErr) {
      console.error('Failed to start Local API Server:', apiErr);
      // Continue without API server — app still works
    }
  } catch (err) {
    console.error('Failed to initialize services:', err);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Close all browsers before quitting
app.on('before-quit', (event) => {
  if (isQuitting || !profileManager) return;
  isQuitting = true;
  event.preventDefault();
  Promise.all([
    profileManager?.closeAllProfiles().catch(() => {}),
    localApiServer?.stop().catch(() => {}),
  ]).finally(() => {
    profileManager = null;
    localApiServer = null;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
