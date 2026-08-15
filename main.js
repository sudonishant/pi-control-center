// Force sandbox disabling at the process environment level before anything loads
process.env.ELECTRON_DISABLE_SANDBOX = '1';

const { app, BrowserWindow } = require('electron');
const path = require('path');

// Fix for SIGSEGV on Linux/Kali by disabling hardware acceleration & sandbox
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage'); // Fixes /dev/shm permission crashes
  app.disableHardwareAcceleration();
}

// Run the Express/Socket.io backend server in the background
require('./server.js');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'PiControl - Command Center',
    icon: path.join(__dirname, 'public', 'icons', 'icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Force clear cache and service workers to apply VNC fixes instantly
  mainWindow.webContents.session.clearCache();
  mainWindow.webContents.session.clearStorageData({
    storages: ['serviceworkers', 'cachestorage']
  });

  let serverReady = false;

  // Safe retry handler if the local server is still binding to the port on launch
  mainWindow.webContents.on('did-fail-load', () => {
    if (!serverReady) {
      console.log('Server not ready yet, retrying load in 500ms...');
      setTimeout(() => {
        if (mainWindow) mainWindow.loadURL('http://localhost:3000').catch(() => {});
      }, 500);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    serverReady = true;
    console.log('PiControl GUI loaded successfully!');
  });

  // Load the running Express application URL
  mainWindow.loadURL('http://localhost:3000').catch(() => {});

  // Hide the default browser window menu bar for a clean native-app look
  mainWindow.setMenuBarVisibility(false);

  // Keep developer tools open for now so user can see any errors
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle handlers
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
