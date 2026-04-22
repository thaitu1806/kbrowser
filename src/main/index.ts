import { app, BrowserWindow } from 'electron';
import path from 'path';
import { setupIPC } from './ipc-handlers';
import type { ProfileManager } from './services/profile-manager/profile-manager';

let mainWindow: BrowserWindow | null = null;
let profileManager: ProfileManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Digital Identity Management',
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

app.whenReady().then(() => {
  const services = setupIPC();
  profileManager = services.profileManager;
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Close all browsers before quitting
app.on('before-quit', async (event) => {
  if (profileManager) {
    event.preventDefault();
    await profileManager.closeAllProfiles();
    profileManager = null;
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
