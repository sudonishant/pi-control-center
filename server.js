const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const { spawn } = require('child_process');
const { Duplex } = require('stream');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const net = require('net');
const url = require('url');
const crypto = require('crypto');

function createAdbStream(host, port = 22) {
  const adb = spawn('adb', ['shell', 'toybox', 'nc', host, String(port)]);
  
  const stream = new Duplex({
    read(size) {},
    write(chunk, encoding, callback) {
      if (adb.stdin.writable) {
        adb.stdin.write(chunk, encoding, callback);
      } else {
        callback(new Error('ADB stdin closed'));
      }
    }
  });

  adb.stdout.on('data', (data) => stream.push(data));
  adb.stdout.on('end', () => stream.push(null));
  adb.stderr.on('data', (err) => console.error('ADB Tunnel stderr:', err.toString()));
  
  adb.on('close', () => stream.emit('close'));
  adb.on('error', (err) => stream.emit('error', err));

  return stream;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Electron, curl, localhost)
      if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        return callback(null, true);
      }
      return callback(null, true);
    }
  }
});

const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active SSH/SFTP connections
// Key: Socket ID, Value: { sshClient, sftpClient, statsInterval, sessionToken, targetHost }
const connections = new Map();

// Helper to get active SSH connection
function getConnection(socketId) {
  return connections.get(socketId);
}

// Helper to safely cleanup local temporary files
function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Failed to cleanup temp file ${filePath}:`, err.message);
  }
}

// API for File Download
app.get('/api/download', (req, res) => {
  const { socketId, sessionToken, remotePath } = req.query;
  const conn = connections.get(socketId);

  if (!conn || !conn.sshClient) {
    return res.status(401).json({ error: 'Not connected to Raspberry Pi' });
  }

  // Validate session token
  if (!sessionToken || sessionToken !== conn.sessionToken) {
    return res.status(403).json({ error: 'Unauthorized: Invalid session token' });
  }

  if (!remotePath || typeof remotePath !== 'string') {
    return res.status(400).json({ error: 'Invalid remote path' });
  }

  conn.sshClient.sftp((err, sftp) => {
    if (err) {
      return res.status(500).json({ error: 'SFTP connection failed: ' + err.message });
    }

    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        return res.status(404).json({ error: 'File not found' });
      }

      const filename = path.basename(remotePath);
      res.setHeader('Content-disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-type', 'application/octet-stream');

      const readStream = sftp.createReadStream(remotePath);
      readStream.on('error', (streamErr) => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read file: ' + streamErr.message });
        }
      });

      readStream.pipe(res);
    });
  });
});

// API for File Upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  const { socketId, sessionToken, remoteDir } = req.body;
  const file = req.file;
  const conn = connections.get(socketId);

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!conn || !conn.sshClient) {
    safeUnlink(file.path);
    return res.status(401).json({ error: 'Not connected to Raspberry Pi' });
  }

  // Validate session token
  if (!sessionToken || sessionToken !== conn.sessionToken) {
    safeUnlink(file.path);
    return res.status(403).json({ error: 'Unauthorized: Invalid session token' });
  }

  conn.sshClient.sftp((err, sftp) => {
    if (err) {
      safeUnlink(file.path);
      return res.status(500).json({ error: 'SFTP connection failed: ' + err.message });
    }

    const remotePath = path.posix.join(remoteDir || '/', file.originalname);
    const writeStream = sftp.createWriteStream(remotePath);
    const readStream = fs.createReadStream(file.path);

    writeStream.on('close', () => {
      safeUnlink(file.path);
      res.json({ success: true, message: 'File uploaded successfully' });
    });

    writeStream.on('error', (err) => {
      safeUnlink(file.path);
      res.status(500).json({ error: 'Failed to write file to remote Pi: ' + err.message });
    });

    readStream.pipe(writeStream);
  });
});

// Helper for formatting file size bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Phone Storage Base directory
const STORAGE_BASE = process.env.STORAGE_BASE || path.join(__dirname, 'uploads');
if (!fs.existsSync(STORAGE_BASE)) {
  fs.mkdirSync(STORAGE_BASE, { recursive: true });
}

function safePhonePath(reqPath) {
  let target = reqPath || '/';
  if (target === '/' || target === '') {
    return STORAGE_BASE;
  }
  const resolved = path.resolve(STORAGE_BASE, target.replace(/^(\/|\\)+/, ''));
  if (!resolved.startsWith(STORAGE_BASE)) {
    return STORAGE_BASE;
  }
  return resolved;
}

// Device Security Token & Quick PIN
const os = require('os');
const DEVICE_PAIRING_TOKEN = process.env.DEVICE_TOKEN || crypto.randomBytes(16).toString('hex');
const DEVICE_PAIRING_PIN = process.env.DEVICE_PIN || Math.floor(100000 + Math.random() * 900000).toString();
let globalTunnelUrl = null;

function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// -------------------------------------------------------------
// GLOBAL REMOTE ACCESS & PAIRING APIS
// -------------------------------------------------------------

// API to get Local & Global Remote URLs and Security PIN
app.get('/api/phone/remote-info', (req, res) => {
  const localIp = getLocalNetworkIp();
  const localPort = process.env.PORT || 3000;
  
  res.json({
    localIp,
    localUrl: `http://${localIp}:${localPort}`,
    globalUrl: globalTunnelUrl || `http://${localIp}:${localPort}`,
    pairingToken: DEVICE_PAIRING_TOKEN,
    pin: DEVICE_PAIRING_PIN,
    deviceName: os.hostname() || 'Android Phone'
  });
});

// API to set custom Global Tunnel URL
app.post('/api/phone/set-tunnel', (req, res) => {
  const { tunnelUrl } = req.body;
  if (tunnelUrl) {
    globalTunnelUrl = tunnelUrl;
    io.emit('tunnel-updated', { globalUrl: tunnelUrl });
  }
  res.json({ success: true, globalUrl: globalTunnelUrl });
});

// -------------------------------------------------------------
// WI-FI PHONE FILE MANAGEMENT APIS
// -------------------------------------------------------------

// 1. List Files & Directories
app.get('/api/phone/files', (req, res) => {
  const reqPath = req.query.path || '/';
  const targetDir = safePhonePath(reqPath);

  fs.readdir(targetDir, { withFileTypes: true }, (err, entries) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read directory: ' + err.message });
    }

    const files = entries.map((entry) => {
      const fullPath = path.join(targetDir, entry.name);
      let size = 0;
      let mtime = new Date();
      try {
        const stats = fs.statSync(fullPath);
        size = stats.size;
        mtime = stats.mtime;
      } catch (e) {}

      const relativePath = path.relative(STORAGE_BASE, fullPath);
      const isDir = entry.isDirectory();

      return {
        name: entry.name,
        path: '/' + relativePath.replace(/\\/g, '/'),
        isDir,
        size,
        sizeFormatted: formatBytes(size),
        mtime,
        ext: path.extname(entry.name).toLowerCase()
      };
    });

    files.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    const currentRel = '/' + path.relative(STORAGE_BASE, targetDir).replace(/\\/g, '/');

    res.json({
      currentPath: currentRel === '/.' ? '/' : currentRel,
      files
    });
  });
});

// 2. Upload Files to Phone Storage over Wi-Fi
app.post('/api/phone/upload', upload.array('files'), (req, res) => {
  const targetDir = safePhonePath(req.body.path || '/');
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    for (const file of req.files) {
      const destPath = path.join(targetDir, file.originalname);
      fs.renameSync(file.path, destPath);
    }
    res.json({ success: true, message: `${req.files.length} file(s) uploaded successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// 3. Download File from Phone over Wi-Fi
app.get('/api/phone/download', (req, res) => {
  const filePath = safePhonePath(req.query.path);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath);
});

// 4. File Preview (Media, Image, Audio, Video, Text)
app.get('/api/phone/preview', (req, res) => {
  const filePath = safePhonePath(req.query.path);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return res.status(404).send('File not found');
  }
  res.sendFile(filePath);
});

// 5. Create Directory
app.post('/api/phone/mkdir', (req, res) => {
  const { path: reqPath, folderName } = req.body;
  const parentDir = safePhonePath(reqPath);
  const newDirPath = path.join(parentDir, folderName || 'New Folder');
  try {
    fs.mkdirSync(newDirPath, { recursive: true });
    res.json({ success: true, message: 'Folder created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete File or Directory
app.post('/api/phone/delete', (req, res) => {
  const { path: reqPath } = req.body;
  const targetPath = safePhonePath(reqPath);
  try {
    if (fs.statSync(targetPath).isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Rename File or Directory
app.post('/api/phone/rename', (req, res) => {
  const { oldPath, newName } = req.body;
  const targetPath = safePhonePath(oldPath);
  const parentDir = path.dirname(targetPath);
  const newPath = path.join(parentDir, newName);
  try {
    fs.renameSync(targetPath, newPath);
    res.json({ success: true, message: 'Renamed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Socket.io Handlers
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Real-time Phone Camera Streaming & Control WebSockets
  socket.on('camera-stream-frame', (data) => {
    socket.broadcast.emit('camera-frame', data);
  });

  socket.on('camera-snapshot-trigger', (options) => {
    io.emit('take-snapshot', options);
  });

  socket.on('flashlight-toggle', (state) => {
    io.emit('flashlight-state', state);
  });

  socket.on('clipboard-update', (text) => {
    io.emit('clipboard-sync', text);
  });

  socket.on('trigger-alarm', () => {
    io.emit('play-alarm-sound');
  });

  socket.on('trigger-vibrate', () => {
    io.emit('device-vibrate');
  });

  socket.on('device-stats-report', (stats) => {
    socket.broadcast.emit('device-stats-update', stats);
  });

  socket.on('send-toast', (message) => {
    io.emit('display-toast', message);
  });

  // 1. Establish SSH connection
  socket.on('ssh-connect', (config) => {
    // If existing connection, clear it first
    clearSocketConnection(socket.id);

    const sshConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      readyTimeout: 15000,
    };

    if (config.authType === 'password') {
      sshConfig.password = config.password;
    } else {
      sshConfig.privateKey = config.privateKey;
      if (config.passphrase) {
        sshConfig.passphrase = config.passphrase;
      }
    }

    const ssh = new Client();

    ssh.on('ready', () => {
      console.log(`SSH connection established for socket ${socket.id}`);
      const sessionToken = crypto.randomBytes(32).toString('hex');
      connections.set(socket.id, {
        sshClient: ssh,
        sftpClient: null,
        statsInterval: null,
        sessionToken,
        targetHost: config.host
      });

      socket.emit('ssh-connected', {
        host: config.host,
        username: config.username,
        sessionToken
      });

      // Start fetching stats
      startStatsInterval(socket);
    });

    ssh.on('error', (err) => {
      if (!sshConfig.sock && (err.code === 'ENETUNREACH' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED')) {
        console.warn(`Direct connection to ${config.host} failed (${err.code}). Retrying via ADB Duplex Stream bridge...`);
        try {
          const adbStream = createAdbStream(config.host, config.port || 22);
          const fallbackConfig = { ...sshConfig, sock: adbStream };
          delete fallbackConfig.host;
          delete fallbackConfig.port;

          const retrySsh = new Client();
          retrySsh.on('ready', () => {
            console.log(`SSH connection established via ADB Stream for socket ${socket.id}`);
            const sessionToken = crypto.randomBytes(32).toString('hex');
            connections.set(socket.id, {
              sshClient: retrySsh,
              sftpClient: null,
              statsInterval: null,
              sessionToken,
              targetHost: config.host
            });

            socket.emit('ssh-connected', {
              host: config.host,
              username: config.username,
              sessionToken
            });

            startStatsInterval(socket);
          });

          retrySsh.on('error', (retryErr) => {
            console.error(`ADB Stream SSH error for socket ${socket.id}:`, retryErr);
            socket.emit('ssh-error', `Connection error: ${retryErr.message}`);
            clearSocketConnection(socket.id);
          });

          retrySsh.on('close', () => {
            console.log(`SSH connection closed for socket ${socket.id}`);
            socket.emit('ssh-disconnected');
            clearSocketConnection(socket.id);
          });

          retrySsh.connect(fallbackConfig);
          return;
        } catch (retryException) {
          console.error('Failed to create ADB stream fallback:', retryException);
        }
      }

      console.error(`SSH connection error for socket ${socket.id}:`, err);
      socket.emit('ssh-error', `Connection error: ${err.message}`);
      clearSocketConnection(socket.id);
    });

    ssh.on('close', () => {
      console.log(`SSH connection closed for socket ${socket.id}`);
      socket.emit('ssh-disconnected');
      clearSocketConnection(socket.id);
    });

    try {
      ssh.connect(sshConfig);
    } catch (e) {
      socket.emit('ssh-error', `Invalid configuration: ${e.message}`);
    }
  });

  // 2. Start SSH Terminal (Pty)
  socket.on('terminal-start', (size) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) {
      return socket.emit('ssh-error', 'SSH connection not established');
    }

    conn.sshClient.shell({
      term: 'xterm-256color',
      cols: (size && size.cols) || 80,
      rows: (size && size.rows) || 24
    }, (err, stream) => {
      if (err) {
        return socket.emit('terminal-error', `Failed to open shell: ${err.message}`);
      }

      conn.shellStream = stream;

      stream.on('data', (data) => {
        socket.emit('terminal-output', data.toString('utf-8'));
      });

      stream.on('close', () => {
        socket.emit('terminal-closed');
        conn.shellStream = null;
      });

      stream.on('error', (streamErr) => {
        socket.emit('terminal-error', streamErr.message);
      });
    });
  });

  // 3. Write data to SSH Terminal
  socket.on('terminal-input', (data) => {
    const conn = getConnection(socket.id);
    if (conn && conn.shellStream) {
      conn.shellStream.write(data);
    }
  });

  // 4. Resize SSH Terminal window
  socket.on('terminal-resize', (size) => {
    const conn = getConnection(socket.id);
    if (conn && conn.shellStream && size) {
      conn.shellStream.setWindow(size.rows, size.cols, 0, 0);
    }
  });

  // 5. File Manager - List Directory
  socket.on('sftp-list', (remoteDir) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) {
      return socket.emit('sftp-error', 'SSH connection not established');
    }

    conn.sshClient.sftp((err, sftp) => {
      if (err) {
        return socket.emit('sftp-error', `SFTP error: ${err.message}`);
      }

      sftp.readdir(remoteDir, (err, list) => {
        if (err) {
          return socket.emit('sftp-error', `Failed to read directory "${remoteDir}": ${err.message}`);
        }

        // Parse attributes and format the file list
        const files = list.map(item => {
          const isDir = (item.attrs.mode & 0o170000) === 0o040000;
          return {
            name: item.filename,
            isDir,
            size: item.attrs.size,
            mtime: item.attrs.mtime * 1000, // to milliseconds
            permissions: parsePermissions(item.attrs.mode),
          };
        });

        socket.emit('sftp-files', { currentDir: remoteDir, files });
      });
    });
  });

  // 6. File Manager - Create Directory
  socket.on('sftp-mkdir', (dirPath) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) return;

    conn.sshClient.sftp((err, sftp) => {
      if (err) return socket.emit('sftp-error', err.message);

      sftp.mkdir(dirPath, (err) => {
        if (err) return socket.emit('sftp-error', `Failed to create folder: ${err.message}`);
        socket.emit('sftp-success', { action: 'mkdir', path: dirPath });
      });
    });
  });

  // 7. File Manager - Delete File/Folder safely using single-quote shell escaping
  socket.on('sftp-delete', (targetPath) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) return;

    if (!targetPath || typeof targetPath !== 'string') {
      return socket.emit('sftp-error', 'Invalid target path');
    }

    // Safely single-quote escape path for shell execution to prevent command injection
    const safePath = "'" + targetPath.replace(/'/g, "'\\''") + "'";

    conn.sshClient.exec(`rm -rf ${safePath}`, (err, stream) => {
      if (err) return socket.emit('sftp-error', `Delete failed: ${err.message}`);

      stream.on('close', (code) => {
        if (code === 0) {
          socket.emit('sftp-success', { action: 'delete', path: targetPath });
        } else {
          socket.emit('sftp-error', `Delete failed with exit code ${code}`);
        }
      });
    });
  });

  // 8. File Manager - Rename File/Folder
  socket.on('sftp-rename', ({ oldPath, newPath }) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) return;

    conn.sshClient.sftp((err, sftp) => {
      if (err) return socket.emit('sftp-error', err.message);

      sftp.rename(oldPath, newPath, (err) => {
        if (err) return socket.emit('sftp-error', `Rename failed: ${err.message}`);
        socket.emit('sftp-success', { action: 'rename', path: newPath });
      });
    });
  });

  // 9. Process Manager - List Processes
  socket.on('get-processes', () => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) return;

    // Fetch PID, User, %CPU, %MEM, and Command, sorted by CPU usage
    conn.sshClient.exec("ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 35", (err, stream) => {
      if (err) return socket.emit('process-error', err.message);

      let dataBuffer = '';
      stream.on('data', (data) => {
        dataBuffer += data.toString();
      });

      stream.on('close', () => {
        const lines = dataBuffer.trim().split('\n');
        if (lines.length < 2) return socket.emit('processes-list', []);

        // Parse lines (Skip header)
        const processes = lines.slice(1).map(line => {
          const tokens = line.trim().split(/\s+/);
          if (tokens.length < 5) return null;
          return {
            pid: tokens[0],
            user: tokens[1],
            cpu: tokens[2],
            mem: tokens[3],
            command: tokens.slice(4).join(' ')
          };
        }).filter(Boolean);

        socket.emit('processes-list', processes);
      });
    });
  });

  // 10. Process Manager - Kill Process (Strict PID Validation)
  socket.on('kill-process', (pid) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) return;

    // Validate that pid is strictly integer digits to prevent command injection
    if (!pid || !/^\d+$/.test(String(pid).trim())) {
      return socket.emit('process-error', 'Invalid process ID format');
    }

    const safePid = String(pid).trim();
    conn.sshClient.exec(`kill -9 ${safePid}`, (err, stream) => {
      if (err) return socket.emit('process-error', `Kill failed: ${err.message}`);

      stream.on('close', (code) => {
        socket.emit('process-killed', { pid: safePid, success: code === 0 });
      });
    });
  });

  // 11. System Action - Reboot/Shutdown
  socket.on('system-action', (action) => {
    const conn = getConnection(socket.id);
    if (!conn || !conn.sshClient) return;

    const cmd = action === 'reboot' ? 'sudo reboot' : 'sudo poweroff';

    conn.sshClient.exec(cmd, (err, stream) => {
      if (err) {
        return socket.emit('system-action-result', { action, success: false, error: err.message });
      }

      socket.emit('system-action-result', { action, success: true });
      clearSocketConnection(socket.id);
    });
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    clearSocketConnection(socket.id);
  });
});

// Clear SSH connections & Intervals
function clearSocketConnection(socketId) {
  const conn = connections.get(socketId);
  if (conn) {
    if (conn.statsInterval) clearInterval(conn.statsInterval);
    if (conn.shellStream) conn.shellStream.end();
    if (conn.sshClient) {
      try {
        conn.sshClient.end();
      } catch (e) {}
    }
    connections.delete(socketId);
  }
}

// Fast Telemetry Stats Polling Loop (reads /proc/stat snapshot instead of slow vmstat 1 2)
function startStatsInterval(socket) {
  const conn = connections.get(socket.id);
  if (!conn) return;

  // Poll metrics every 3 seconds instantly
  conn.statsInterval = setInterval(() => {
    const currentConn = connections.get(socket.id);
    if (!currentConn || !currentConn.sshClient) {
      clearInterval(conn.statsInterval);
      return;
    }

    // Instant non-blocking metrics query: free, df, thermal temp, top CPU snapshot, uptime
    const cmd = `free -b | grep Mem; df -B1 / | tail -n 1; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0; head -n 1 /proc/stat; uptime`;

    currentConn.sshClient.exec(cmd, (err, stream) => {
      if (err) return;

      let buffer = '';
      stream.on('data', (data) => {
        buffer += data.toString();
      });

      stream.on('close', () => {
        try {
          const stats = parseSystemStats(buffer, currentConn);
          socket.emit('system-stats', stats);
        } catch (parseErr) {
          console.error("Error parsing stats:", parseErr);
        }
      });
    });
  }, 3000);
}

// Parse system stats from command output
function parseSystemStats(output, connState) {
  const lines = output.trim().split('\n');
  if (lines.length < 5) return {};

  const stats = {};

  // 1. Parse RAM (free -b)
  const ramTokens = lines[0].trim().split(/\s+/);
  if (ramTokens.length >= 4) {
    const total = parseInt(ramTokens[1]);
    const used = parseInt(ramTokens[2]);
    stats.ram = {
      total,
      used,
      free: total - used,
      percentage: Math.round((used / total) * 100)
    };
  }

  // 2. Parse Disk (df -B1 /)
  const diskTokens = lines[1].trim().split(/\s+/);
  if (diskTokens.length >= 5) {
    const total = parseInt(diskTokens[1]);
    const used = parseInt(diskTokens[2]);
    const free = parseInt(diskTokens[3]);
    stats.disk = {
      total,
      used,
      free,
      percentage: Math.round((used / total) * 100)
    };
  }

  // 3. Parse Temperature
  const tempVal = parseInt(lines[2].trim());
  stats.temperature = tempVal > 0 ? parseFloat((tempVal / 1000).toFixed(1)) : 0;

  // 4. Parse CPU (/proc/stat calculation)
  // e.g. cpu  2255 34 2290 2262596 12756 0 229 0 0 0
  const cpuTokens = lines[3].trim().split(/\s+/);
  if (cpuTokens[0] === 'cpu' && cpuTokens.length >= 5) {
    const user = parseInt(cpuTokens[1]) || 0;
    const nice = parseInt(cpuTokens[2]) || 0;
    const system = parseInt(cpuTokens[3]) || 0;
    const idle = parseInt(cpuTokens[4]) || 0;
    const totalCpu = user + nice + system + idle;

    if (connState.lastCpuTotal) {
      const totalDelta = totalCpu - connState.lastCpuTotal;
      const idleDelta = idle - connState.lastCpuIdle;
      const cpuUsage = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0;
      stats.cpu = { percentage: Math.min(100, Math.max(0, cpuUsage)) };
    } else {
      stats.cpu = { percentage: 0 };
    }

    connState.lastCpuTotal = totalCpu;
    connState.lastCpuIdle = idle;
  } else {
    stats.cpu = { percentage: 0 };
  }

  // 5. Parse Uptime
  stats.uptime = lines[4].trim();

  return stats;
}

// Convert mode octal to permission string (e.g. -rw-r--r--)
function parsePermissions(mode) {
  const isDir = (mode & 0o170000) === 0o040000;
  let str = isDir ? 'd' : '-';
  str += (mode & 0o400) ? 'r' : '-';
  str += (mode & 0o200) ? 'w' : '-';
  str += (mode & 0o100) ? 'x' : '-';
  str += (mode & 0o040) ? 'r' : '-';
  str += (mode & 0o020) ? 'w' : '-';
  str += (mode & 0o010) ? 'x' : '-';
  str += (mode & 0o004) ? 'r' : '-';
  str += (mode & 0o002) ? 'w' : '-';
  str += (mode & 0o001) ? 'x' : '-';
  return str;
}

// Create WebSocket VNC proxy
const vncWss = new WebSocket.Server({ noServer: true });

// Attach upgrade handler to Express HTTP server
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;
  if (pathname === '/vnc') {
    vncWss.handleUpgrade(request, socket, head, (ws) => {
      vncWss.emit('connection', ws, request);
    });
  }
});

vncWss.on('connection', (ws, request) => {
  const queryParams = new URLSearchParams(url.parse(request.url).query);
  const targetHost = queryParams.get('host');
  const targetPort = parseInt(queryParams.get('port')) || 5900;

  if (!targetHost) {
    ws.close(1008, 'Target host parameter missing');
    return;
  }

  // Restrict VNC proxy target port range
  if (targetPort < 5900 || targetPort > 5999) {
    ws.close(1008, 'Target port disallowed for VNC proxy');
    return;
  }

  console.log(`VNC Proxy: Socket upgrading to TCP connection on ${targetHost}:${targetPort}`);

  const tcpSocket = net.createConnection({ host: targetHost, port: targetPort });

  tcpSocket.on('connect', () => {
    console.log(`VNC Proxy: TCP connected to ${targetHost}:${targetPort}`);
  });

  ws.on('message', (message) => {
    if (tcpSocket.writable) {
      tcpSocket.write(message);
    }
  });

  tcpSocket.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('close', () => {
    console.log('VNC Proxy: WebSocket connection closed');
    tcpSocket.end();
  });

  tcpSocket.on('close', () => {
    console.log('VNC Proxy: Target TCP socket closed');
    ws.close();
  });

  ws.on('error', (err) => {
    console.error('VNC Proxy: WebSocket error:', err.message);
    tcpSocket.end();
  });

  tcpSocket.on('error', (err) => {
    console.error('VNC Proxy: TCP socket error:', err.message);
    ws.close(1011, `VNC target connection error: ${err.message}`);
  });
});

// Start Server with error handling
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Raspberry Pi Control Center server listening on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Assuming server is already running.`);
  } else {
    console.error("Server start error:", err);
  }
});

