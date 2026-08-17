// PiControl Application Logic
window.onerror = function(message, source, lineno, colno, error) {
  const errorMsg = `JavaScript Error: ${message}\nFile: ${source.split('/').pop()}\nLine: ${lineno}:${colno}`;
  console.error(errorMsg);
  alert(errorMsg);
};
window.addEventListener('unhandledrejection', function(event) {
  const errorMsg = `Unhandled Promise Rejection: ${event.reason ? (event.reason.message || event.reason) : 'unknown'}`;
  console.error(errorMsg);
  alert(errorMsg);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (let registration of registrations) {
      registration.unregister().then(() => console.log('Service Worker unregistered successfully'));
    }
  });
  caches.keys().then(names => {
    for (let name of names) {
      caches.delete(name);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize socket.io connection
  const isFileProtocol = (window.location.protocol === 'file:' || !window.location.hostname);
  let socket = isFileProtocol ? null : io();

  function getActiveSocket(targetHost) {
    if (!socket || (isFileProtocol && targetHost)) {
      const host = targetHost || localStorage.getItem('last_active_pi_host') || '10.82.32.172';
      const socketTargetUrl = isFileProtocol ? `http://${host}:3000` : undefined;
      if (socket) {
        try { socket.disconnect(); } catch (e) {}
      }
      socket = io(socketTargetUrl);
      registerSocketEvents();
    }
    return socket;
  }

  // Cache socket id on connect
  if (socket) {
    socket.on('connect', () => {
      currentSocketId = socket.id;
      console.log('Connected to backend. Socket ID:', currentSocketId);
    });
  }

  // DOM Elements
  const connectionModal = document.getElementById('connection-modal');
  const connectionForm = document.getElementById('connection-form');
  const errorBanner = document.getElementById('connection-error');
  const errorMessage = document.getElementById('error-message');
  const connectSubmitBtn = document.getElementById('connect-submit-btn');

  // Sidebar Elements
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = statusIndicator.querySelector('.status-text');
  const hostDetails = document.querySelector('.host-details');
  const hostUser = document.querySelector('.host-user');
  const hostIp = document.querySelector('.host-ip');
  const disconnectBtn = document.getElementById('disconnect-btn');

  // Header Elements
  const uptimeDisplay = document.getElementById('uptime-display');
  const uptimeVal = document.getElementById('uptime-val');

  // Tab Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const contentViews = document.querySelectorAll('.content-view');
  const pageTitle = document.getElementById('page-title');

  // Dashboard Elements
  const cpuVal = document.getElementById('cpu-val');
  const ramVal = document.getElementById('ram-val');
  const tempVal = document.getElementById('temp-val');
  const diskVal = document.getElementById('disk-val');
  const ramDetails = document.getElementById('ram-details');
  const diskDetails = document.getElementById('disk-details');
  const tempStatus = document.getElementById('temp-status');
  const powerActionsGroup = document.getElementById('power-actions-group');
  const btnReboot = document.getElementById('btn-reboot');
  const btnShutdown = document.getElementById('btn-shutdown');

  // Performance Chart Canvas
  const canvas = document.getElementById('performance-chart');
  const ctx = canvas ? canvas.getContext('2d') : null;

  // File Manager Elements
  const filePathInput = document.getElementById('file-path-input');
  const fileUpBtn = document.getElementById('file-up-btn');
  const fileGoBtn = document.getElementById('file-go-btn');
  const fileNewDirBtn = document.getElementById('file-new-dir-btn');
  const fileUploadInput = document.getElementById('file-upload-input');
  const fileRefreshBtn = document.getElementById('file-refresh-btn');
  const fileListBody = document.getElementById('file-list-body');
  const uploadStatusBanner = document.getElementById('upload-status-banner');
  const uploadStatusText = document.getElementById('upload-status-text');

  // Process Manager Elements
  const processSearchInput = document.getElementById('process-search-input');
  const processRefreshBtn = document.getElementById('process-refresh-btn');
  const processListBody = document.getElementById('process-list-body');

  // Tabs for connection overlay
  const tabNewConnection = document.getElementById('tab-new-connection');
  const tabSavedConnections = document.getElementById('tab-saved-connections');
  const connectionFormContent = document.getElementById('connection-form');
  const savedConnectionsContent = document.getElementById('saved-connections-list');
  const profilesContainer = document.getElementById('profiles-container');

  // Key Auth Toggle
  const authMethods = document.getElementsByName('auth-method');
  const authPasswordGroup = document.getElementById('auth-password-group');
  const authKeyGroup = document.getElementById('auth-key-group');

  // Lucide Icons initialization
  lucide.createIcons();

  // -------------------------------------------------------------
  // Theme Toggle Logic
  // -------------------------------------------------------------
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  let currentTheme = localStorage.getItem('theme') || 'dark';

  if (currentTheme === 'light') {
    document.body.classList.add('light-theme');
    updateThemeIcon('light');
  }

  themeToggleBtn.addEventListener('click', () => {
    if (document.body.classList.contains('light-theme')) {
      document.body.classList.remove('light-theme');
      localStorage.setItem('theme', 'dark');
      updateThemeIcon('dark');
    } else {
      document.body.classList.add('light-theme');
      localStorage.setItem('theme', 'light');
      updateThemeIcon('light');
    }
    // Resize chart
    drawChart();
  });

  function updateThemeIcon(theme) {
    const icon = themeToggleBtn.querySelector('[data-lucide]');
    if (icon) {
      if (theme === 'light') {
        icon.setAttribute('data-lucide', 'moon');
      } else {
        icon.setAttribute('data-lucide', 'sun');
      }
      lucide.createIcons();
    }
  }

  // -------------------------------------------------------------
  // Connection Form & Saved Profiles Logic
  // -------------------------------------------------------------
  // Toggle Auth Fields
  authMethods.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'password') {
        authPasswordGroup.style.display = 'block';
        authKeyGroup.style.display = 'none';
      } else {
        authPasswordGroup.style.display = 'none';
        authKeyGroup.style.display = 'block';
      }
    });
  });

  // Toggle Connection Modal Tabs
  tabNewConnection.addEventListener('click', () => {
    tabNewConnection.classList.add('active');
    tabSavedConnections.classList.remove('active');
    connectionFormContent.classList.add('active');
    savedConnectionsContent.classList.remove('active');
  });

  tabSavedConnections.addEventListener('click', () => {
    tabSavedConnections.classList.add('active');
    tabNewConnection.classList.remove('active');
    savedConnectionsContent.classList.add('active');
    connectionFormContent.classList.remove('active');
    renderSavedProfiles();
  });

  // Password Visibility Toggle
  const togglePasswordBtn = document.getElementById('toggle-password');
  const sshPasswordInput = document.getElementById('ssh-password');
  togglePasswordBtn.addEventListener('click', () => {
    const isPass = sshPasswordInput.type === 'password';
    sshPasswordInput.type = isPass ? 'text' : 'password';
    const icon = togglePasswordBtn.querySelector('[data-lucide]');
    if (icon) icon.setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
    lucide.createIcons();
  });

  // Connection Submit
  connectionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    errorBanner.style.display = 'none';
    connectSubmitBtn.disabled = true;
    connectSubmitBtn.innerHTML = '<i data-lucide="loader" class="spinner"></i> Connecting...';
    lucide.createIcons();

    const host = document.getElementById('ssh-host').value.trim();
    const port = parseInt(document.getElementById('ssh-port').value) || 22;
    const username = document.getElementById('ssh-user').value.trim();
    const authType = document.querySelector('input[name="auth-method"]:checked').value;
    const password = sshPasswordInput.value;
    const privateKey = document.getElementById('ssh-key').value;
    const passphrase = document.getElementById('ssh-passphrase').value;

    const connectionData = { host, port, username, authType, password, privateKey, passphrase };
    localStorage.setItem('last_active_pi_host', host);

    // Emit connection request via active socket
    const activeSocket = getActiveSocket(host);
    activeSocket.emit('ssh-connect', connectionData);

    // Save profile if checked
    const saveProfileChecked = document.getElementById('save-profile').checked;
    const profileName = document.getElementById('profile-name').value.trim() || host;

    if (saveProfileChecked) {
      saveProfile(profileName, connectionData);
    }
  });

  // Disconnect button
  disconnectBtn.addEventListener('click', () => {
    socket.emit('ssh-connect', { host: 'disconnect' }); // forces server reset
    window.location.reload();
  });

  // Connection Results
  socket.on('ssh-connected', (info) => {
    console.log('Successfully connected to:', info);
    activePiHost = info.host;
    activePiUser = info.username;
    currentSessionToken = info.sessionToken;
    // UI state change
    connectionModal.style.opacity = '0';
    setTimeout(() => {
      connectionModal.style.display = 'none';
    }, 400);

    statusIndicator.className = 'status-indicator connected';
    statusText.innerText = 'Connected';
    hostUser.innerText = info.username;
    hostIp.innerText = info.host;
    hostDetails.style.display = 'block';
    disconnectBtn.style.display = 'flex';
    powerActionsGroup.style.display = 'flex';
    uptimeDisplay.style.display = 'flex';

    // Start terminal and list files/processes
    initTerminal();
    socket.emit('sftp-list', currentDirectory);
    socket.emit('get-processes');
  });

  socket.on('ssh-error', (msg) => {
    console.error('SSH connection failed:', msg);
    errorBanner.style.display = 'flex';
    errorMessage.innerText = msg;
    connectSubmitBtn.disabled = false;
    connectSubmitBtn.innerHTML = '<i data-lucide="link-2"></i> Establish Secure Connection';
    lucide.createIcons();

    statusIndicator.className = 'status-indicator disconnected';
    statusText.innerText = 'Error';
  });

  socket.on('ssh-disconnected', () => {
    console.log('SSH connection disconnected');
    statusIndicator.className = 'status-indicator disconnected';
    statusText.innerText = 'Disconnected';
    hostDetails.style.display = 'none';
    disconnectBtn.style.display = 'none';
    powerActionsGroup.style.display = 'none';
    uptimeDisplay.style.display = 'none';
    connectionModal.style.display = 'flex';
    setTimeout(() => {
      connectionModal.style.opacity = '1';
    }, 50);
  });

  // -------------------------------------------------------------
  // LocalStorage Connection Profiles
  // -------------------------------------------------------------
  function saveProfile(name, config) {
    let profiles = [];
    try {
      profiles = JSON.parse(localStorage.getItem('ssh_profiles')) || [];
    } catch (e) {}

    // Exclude dynamic keys logic & avoid duplicates
    profiles = profiles.filter(p => p.name !== name);
    profiles.push({
      name,
      host: config.host,
      port: config.port,
      username: config.username,
      authType: config.authType,
      password: '', // Do not store plaintext passwords in localStorage for security
      privateKey: config.authType === 'key' ? config.privateKey : '',
      passphrase: ''
    });

    localStorage.setItem('ssh_profiles', JSON.stringify(profiles));
  }

  function renderSavedProfiles() {
    profilesContainer.innerHTML = '';
    let profiles = [];
    try {
      profiles = JSON.parse(localStorage.getItem('ssh_profiles')) || [];
    } catch (e) {}

    if (profiles.length === 0) {
      profilesContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="bookmark"></i>
          <p>No saved profiles yet</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    profiles.forEach((profile, index) => {
      const card = document.createElement('div');
      card.className = 'profile-item';

      card.innerHTML = `
        <div class="profile-details">
          <h4>${escapeHTML(profile.name)}</h4>
          <p>${escapeHTML(profile.username)}@${escapeHTML(profile.host)}:${profile.port}</p>
        </div>
        <div class="profile-actions">
          <button class="btn btn-primary btn-icon-only connect-profile" title="Connect">
            <i data-lucide="play"></i>
          </button>
          <button class="btn btn-danger btn-icon-only delete-profile" title="Delete">
            <i data-lucide="trash"></i>
          </button>
        </div>
      `;

      // Connect Click Handler
      card.querySelector('.connect-profile').addEventListener('click', (e) => {
        e.stopPropagation();
        errorBanner.style.display = 'none';
        tabNewConnection.click(); // switch back to display connection progress loaders
        connectSubmitBtn.disabled = true;
        connectSubmitBtn.innerHTML = '<i data-lucide="loader" class="spinner"></i> Connecting...';
        lucide.createIcons();

        // Populate fields to show visual progress
        document.getElementById('ssh-host').value = profile.host;
        document.getElementById('ssh-port').value = profile.port;
        document.getElementById('ssh-user').value = profile.username;
        if (profile.authType === 'password') {
          document.querySelector('input[name="auth-method"][value="password"]').click();
          sshPasswordInput.value = profile.password;
        } else {
          document.querySelector('input[name="auth-method"][value="key"]').click();
          document.getElementById('ssh-key').value = profile.privateKey;
          document.getElementById('ssh-passphrase').value = profile.passphrase;
        }

        socket.emit('ssh-connect', profile);
      });

      // Delete Profile Click Handler
      card.querySelector('.delete-profile').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await customConfirm(`Delete profile "${profile.name}"?`)) {
          profiles.splice(index, 1);
          localStorage.setItem('ssh_profiles', JSON.stringify(profiles));
          renderSavedProfiles();
        }
      });

      profilesContainer.appendChild(card);
    });

    lucide.createIcons();
  }

  // -------------------------------------------------------------
  // Page Tab Switching
  // -------------------------------------------------------------
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('href').replace('#', 'view-');

      navItems.forEach(i => i.classList.remove('active'));
      contentViews.forEach(v => v.classList.remove('active'));

      item.classList.add('active');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');

      const title = item.querySelector('span').innerText;
      pageTitle.innerText = title;

      // Handle custom resize trigger on terminal load
      if (targetId === 'view-terminal' && term) {
        setTimeout(() => {
          fitAddon.fit();
          socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
        }, 100);
      }

      // Handle auto-connecting Direct Remote Control VNC
      if (targetId === 'view-direct') {
        startDirectVncSession();
      }
    });
  });

  // -------------------------------------------------------------
  // Dashboard Live Stats updates
  // -------------------------------------------------------------
  socket.on('system-stats', (stats) => {
    if (!stats || Object.keys(stats).length === 0) return;

    // 1. CPU
    if (stats.cpu) {
      updateGauge('progress-cpu', stats.cpu.percentage);
      cpuVal.innerText = `${stats.cpu.percentage}%`;
    }

    // 2. Memory (RAM)
    if (stats.ram) {
      updateGauge('progress-ram', stats.ram.percentage);
      ramVal.innerText = `${stats.ram.percentage}%`;
      const usedMB = Math.round(stats.ram.used / (1024 * 1024));
      const totalMB = Math.round(stats.ram.total / (1024 * 1024));
      ramDetails.innerText = `${usedMB} MB / ${totalMB} MB used`;
    }

    // 3. Temperature
    if (stats.temperature !== undefined) {
      // Scale temp relative to 85°C (max throttle threshold of Pi)
      const scaledTempPercentage = Math.min(Math.round((stats.temperature / 85) * 100), 100);
      updateGauge('progress-temp', scaledTempPercentage);
      tempVal.innerText = `${stats.temperature}°C`;

      let condition = 'Cool';
      if (stats.temperature > 70) condition = 'Critical (Throttling)';
      else if (stats.temperature > 55) condition = 'Warm';
      tempStatus.innerText = `Thermal condition: ${condition}`;
    }

    // 4. Disk
    if (stats.disk) {
      updateGauge('progress-disk', stats.disk.percentage);
      diskVal.innerText = `${stats.disk.percentage}%`;
      const freeGB = (stats.disk.free / (1024 * 1024 * 1024)).toFixed(1);
      const totalGB = (stats.disk.total / (1024 * 1024 * 1024)).toFixed(1);
      diskDetails.innerText = `${freeGB} GB / ${totalGB} GB free`;
    }

    // 5. Uptime
    if (stats.uptime) {
      // Uptime comes as raw string from `uptime`
      // e.g. " 14:23:45 up  2:13,  1 user,  load average: 0.12, 0.08, 0.05"
      const parts = stats.uptime.split('up');
      if (parts.length > 1) {
        const uptimeStr = parts[1].split(',')[0].trim();
        uptimeVal.innerText = uptimeStr;
      } else {
        uptimeVal.innerText = stats.uptime;
      }
    }

    // Add to chart history
    performanceHistory.push({
      cpu: stats.cpu ? stats.cpu.percentage : 0,
      temp: stats.temperature || 0
    });

    if (performanceHistory.length > MAX_HISTORY) {
      performanceHistory.shift();
    }

    drawChart();
  });

  function updateGauge(className, percentage) {
    const circle = document.querySelector(`.${className}`);
    if (!circle) return;

    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = offset;
  }

  // -------------------------------------------------------------
  // Custom Canvas Chart drawing (No massive ChartJS dependencies)
  // -------------------------------------------------------------
  function drawChart() {
    if (!ctx || !canvas) return;

    // Handle high-dpi displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 180 * dpr; // fixed height ratio
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = 180;

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);

    if (performanceHistory.length < 2) {
      ctx.fillStyle = '#64748B';
      ctx.font = '14px Outfit';
      ctx.fillText('Awaiting live data streams...', width / 2 - 80, height / 2);
      return;
    }

    // Colors based on current theme (CSS Variables fallback)
    const isLightTheme = document.body.classList.contains('light-theme');
    const colorGrid = isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)';
    const colorText = isLightTheme ? '#64748B' : '#94A3B8';

    // Draw Grid Lines
    ctx.strokeStyle = colorGrid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = 20 + (i * (height - 40)) / 4;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(width - 20, y);
      ctx.stroke();

      // Axis labels (0 to 100)
      ctx.fillStyle = colorText;
      ctx.font = '10px Space Mono';
      ctx.fillText(`${100 - i * 25}`, 12, y + 4);
    }

    const paddingLeft = 40;
    const paddingRight = 20;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - 40;
    const stepX = plotWidth / (MAX_HISTORY - 1);

    // Draw CPU Line (Teal/Green)
    drawChartLine(
      performanceHistory.map(d => d.cpu),
      '#00F2C3',
      'rgba(0, 242, 195, 0.1)',
      stepX,
      paddingLeft,
      plotHeight,
      20
    );

    // Draw Temperature Line (Red)
    drawChartLine(
      performanceHistory.map(d => d.temp),
      '#FF3B30',
      'rgba(255, 59, 48, 0.08)',
      stepX,
      paddingLeft,
      plotHeight,
      20
    );

    // Legend
    ctx.font = '11px Outfit';
    ctx.fillStyle = '#00F2C3';
    ctx.fillRect(width - 150, 8, 12, 6);
    ctx.fillText('CPU Usage (%)', width - 132, 14);

    ctx.fillStyle = '#FF3B30';
    ctx.fillRect(width - 250, 8, 12, 6);
    ctx.fillText('Temp (°C)', width - 232, 14);
  }

  function drawChartLine(data, strokeColor, fillGradientColor, stepX, paddingLeft, plotHeight, paddingTop) {
    ctx.beginPath();
    const startIdx = MAX_HISTORY - data.length;

    data.forEach((val, i) => {
      const x = paddingLeft + (startIdx + i) * stepX;
      // map 0-100 to plotHeight
      const y = paddingTop + plotHeight - (val / 100) * plotHeight;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 4;
    ctx.shadowColor = strokeColor;
    ctx.stroke();
    ctx.shadowBlur = 0; // reset shadow

    // Fill underneath the curve
    if (data.length > 1) {
      ctx.lineTo(paddingLeft + (MAX_HISTORY - 1) * stepX, paddingTop + plotHeight);
      ctx.lineTo(paddingLeft + startIdx * stepX, paddingTop + plotHeight);
      ctx.fillStyle = fillGradientColor;
      ctx.fill();
    }
  }

  window.addEventListener('resize', drawChart);

  // -------------------------------------------------------------
  // System Power Action buttons
  // -------------------------------------------------------------
  btnReboot.addEventListener('click', async () => {
    if (await customConfirm("Are you sure you want to reboot the Raspberry Pi?")) {
      socket.emit('system-action', 'reboot');
    }
  });

  btnShutdown.addEventListener('click', async () => {
    if (await customConfirm("Are you sure you want to shutdown the Raspberry Pi?")) {
      socket.emit('system-action', 'shutdown');
    }
  });

  socket.on('system-action-result', async (result) => {
    if (result.success) {
      await customAlert(`System ${result.action} command executed successfully. Disconnecting.`);
      window.location.reload();
    } else {
      await customAlert(`System action failed: ${result.error}`);
    }
  });

  // -------------------------------------------------------------
  // Terminal Interaction via xterm.js
  // -------------------------------------------------------------
  function initTerminal() {
    term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#05070B',
        foreground: '#F1F5F9',
        cursor: '#00F2C3',
        black: '#000000',
        red: '#FF3B30',
        green: '#00F2C3',
        yellow: '#FFCC00',
        blue: '#00D2FF',
        magenta: '#9E00FF',
        cyan: '#00D2FF',
        white: '#FFFFFF'
      },
      fontFamily: 'Space Mono, monospace',
      fontSize: 14,
      scrollback: 1000
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    fitAddon.fit();

    // Start terminal shell on backend
    socket.emit('terminal-start', { cols: term.cols, rows: term.rows });

    // Handle local window resize to update remote shell pty rows/cols
    window.addEventListener('resize', () => {
      if (term) {
        fitAddon.fit();
        socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
      }
    });

    // Write client keyboard input back to SSH channel
    term.onData((data) => {
      socket.emit('terminal-input', data);
    });

    // Write server output to terminal screen
    socket.on('terminal-output', (data) => {
      term.write(data);
    });

    socket.on('terminal-closed', () => {
      term.write('\n\r*** SSH Session Closed ***\n\r');
    });

    socket.on('terminal-error', (msg) => {
      term.write(`\n\r*** Terminal error: ${msg} ***\n\r`);
    });
  }

  // Terminal buttons
  document.getElementById('terminal-clear').addEventListener('click', () => {
    if (term) term.clear();
  });

  const btnFullscreen = document.getElementById('terminal-fullscreen');
  const terminalWrapper = document.querySelector('.terminal-wrapper');
  btnFullscreen.addEventListener('click', () => {
    const isFullscreen = terminalWrapper.classList.toggle('fullscreen');
    const icon = btnFullscreen.querySelector('[data-lucide]');
    if (icon) {
      icon.setAttribute(
        'data-lucide',
        isFullscreen ? 'minimize-2' : 'maximize-2'
      );
    }
    lucide.createIcons();

    setTimeout(() => {
      if (term) {
        fitAddon.fit();
        socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
      }
    }, 150);
  });

  // -------------------------------------------------------------
  // SFTP File Explorer actions
  // -------------------------------------------------------------
  fileRefreshBtn.addEventListener('click', () => {
    socket.emit('sftp-list', currentDirectory);
  });

  fileGoBtn.addEventListener('click', () => {
    const target = filePathInput.value.trim();
    if (target) {
      currentDirectory = target;
      socket.emit('sftp-list', currentDirectory);
    }
  });

  filePathInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fileGoBtn.click();
  });

  fileUpBtn.addEventListener('click', () => {
    if (currentDirectory === '/') return;
    
    // Go up one directory level
    const parts = currentDirectory.split('/').filter(Boolean);
    parts.pop();
    currentDirectory = '/' + parts.join('/');
    filePathInput.value = currentDirectory;
    socket.emit('sftp-list', currentDirectory);
  });

  // Receive folder contents
  socket.on('sftp-files', (data) => {
    currentDirectory = data.currentDir;
    filePathInput.value = currentDirectory;
    fileListBody.innerHTML = '';

    const files = data.files;

    if (files.length === 0) {
      fileListBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-table">
            <div class="empty-state">
              <i data-lucide="folder-open"></i>
              <p>This directory is empty</p>
            </div>
          </td>
        </tr>
      `;
      lucide.createIcons();
      return;
    }

    // Sort: Folders first, then files alphabetically
    files.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    files.forEach(file => {
      const row = document.createElement('tr');
      const timeStr = file.mtime ? new Date(file.mtime).toLocaleString() : '-';
      const sizeStr = file.isDir ? '-' : formatBytes(file.size);
      const icon = file.isDir ? '<i data-lucide="folder" class="file-icon-dir"></i>' : '<i data-lucide="file" class="file-icon-file"></i>';
      const fullPath = joinPath(currentDirectory, file.name);

      row.innerHTML = `
        <td>
          <div class="file-name-cell" data-path="${fullPath}" data-isdir="${file.isDir}">
            ${icon}
            <span>${escapeHTML(file.name)}</span>
          </div>
        </td>
        <td>${sizeStr}</td>
        <td>${timeStr}</td>
        <td><span class="permission-text">${file.permissions}</span></td>
        <td>
          <div class="file-row-actions">
            ${file.isDir ? '' : `
              <button class="btn btn-secondary btn-icon-only download-file-btn" data-path="${fullPath}" title="Download">
                <i data-lucide="download"></i>
              </button>
            `}
            <button class="btn btn-secondary btn-icon-only rename-file-btn" data-path="${fullPath}" data-name="${file.name}" title="Rename">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn btn-danger btn-icon-only delete-file-btn" data-path="${fullPath}" title="Delete">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      `;

      // Navigate into folder on click
      row.querySelector('.file-name-cell').addEventListener('click', (e) => {
        const isDir = e.currentTarget.getAttribute('data-isdir') === 'true';
        const targetPath = e.currentTarget.getAttribute('data-path');
        if (isDir) {
          currentDirectory = targetPath;
          socket.emit('sftp-list', currentDirectory);
        }
      });

      // Download file handler
      if (!file.isDir) {
        row.querySelector('.download-file-btn').addEventListener('click', (e) => {
          const path = e.currentTarget.getAttribute('data-path');
          triggerDownload(path);
        });
      }

      // Rename handler
      row.querySelector('.rename-file-btn').addEventListener('click', async (e) => {
        const path = e.currentTarget.getAttribute('data-path');
        const oldName = e.currentTarget.getAttribute('data-name');
        const newName = await customPrompt(`Enter new name for "${oldName}":`, oldName);
        if (newName && newName !== oldName) {
          const parentDir = getParentDir(path);
          const newPath = joinPath(parentDir, newName);
          socket.emit('sftp-rename', { oldPath: path, newPath });
        }
      });

      // Delete handler
      row.querySelector('.delete-file-btn').addEventListener('click', async (e) => {
        const path = e.currentTarget.getAttribute('data-path');
        if (await customConfirm(`Are you absolutely sure you want to delete this ${file.isDir ? 'folder and all its contents' : 'file'}?\nPath: ${path}`)) {
          socket.emit('sftp-delete', path);
        }
      });

      fileListBody.appendChild(row);
    });

    lucide.createIcons();
  });

  socket.on('sftp-success', ({ action, path }) => {
    console.log(`SFTP action: ${action} succeeded on path: ${path}`);
    socket.emit('sftp-list', currentDirectory);
  });

  socket.on('sftp-error', async (msg) => {
    await customAlert(`File Manager Error: ${msg}`);
  });

  // Create folder
  fileNewDirBtn.addEventListener('click', async () => {
    const dirName = await customPrompt("Enter new folder name:");
    if (dirName) {
      const fullPath = joinPath(currentDirectory, dirName);
      socket.emit('sftp-mkdir', fullPath);
    }
  });

  // File Upload
  fileUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadStatusBanner.style.display = 'flex';
    uploadStatusText.innerText = `Uploading "${file.name}"...`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('socketId', currentSocketId);
    formData.append('sessionToken', currentSessionToken || '');
    formData.append('remoteDir', currentDirectory);

    fetch('/api/upload', {
      method: 'POST',
      body: formData
    })
    .then(res => res.json())
    .then(async data => {
      uploadStatusBanner.style.display = 'none';
      if (data.success) {
        socket.emit('sftp-list', currentDirectory);
      } else {
        await customAlert(`Upload failed: ${data.error}`);
      }
    })
    .catch(async err => {
      uploadStatusBanner.style.display = 'none';
      await customAlert(`Upload error: ${err.message}`);
    });

    // Reset input
    fileUploadInput.value = '';
  });

  function triggerDownload(remotePath) {
    const url = `/api/download?socketId=${encodeURIComponent(currentSocketId)}&sessionToken=${encodeURIComponent(currentSessionToken || '')}&remotePath=${encodeURIComponent(remotePath)}`;
    
    // Create temporary link element to trigger browser download prompt
    const link = document.createElement('a');
    link.href = url;
    link.download = remotePath.split('/').pop();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Helper paths join
  function joinPath(dir, file) {
    if (dir.endsWith('/')) return dir + file;
    return dir + '/' + file;
  }

  function getParentDir(path) {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
  }

  // -------------------------------------------------------------
  // Process Manager UI updates
  // -------------------------------------------------------------
  let rawProcessList = [];

  processRefreshBtn.addEventListener('click', () => {
    socket.emit('get-processes');
  });

  socket.on('processes-list', (processes) => {
    rawProcessList = processes;
    renderProcesses();
  });

  socket.on('process-killed', async (result) => {
    if (result.success) {
      await customAlert(`Process ${result.pid} killed successfully.`);
      socket.emit('get-processes');
    } else {
      await customAlert(`Failed to kill process ${result.pid}. Check if root permission is required.`);
    }
  });

  socket.on('process-error', async (msg) => {
    await customAlert(`Process error: ${msg}`);
  });

  processSearchInput.addEventListener('input', () => {
    renderProcesses();
  });

  function renderProcesses() {
    processListBody.innerHTML = '';
    const query = processSearchInput.value.toLowerCase().trim();

    // Filter raw list
    const filtered = rawProcessList.filter(p => {
      return p.command.toLowerCase().includes(query) || 
             p.user.toLowerCase().includes(query) || 
             p.pid.toString().includes(query);
    });

    if (filtered.length === 0) {
      processListBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-table">
            <div class="empty-state">
              <i data-lucide="search"></i>
              <p>No matching processes found</p>
            </div>
          </td>
        </tr>
      `;
      lucide.createIcons();
      return;
    }

    filtered.forEach(p => {
      const row = document.createElement('tr');
      
      // Highlight high CPU
      const cpuFloat = parseFloat(p.cpu);
      const cpuClass = cpuFloat > 50 ? 'process-cpu-high' : '';

      row.innerHTML = `
        <td>${p.pid}</td>
        <td>${escapeHTML(p.user)}</td>
        <td class="${cpuClass}">${p.cpu}%</td>
        <td>${p.mem}%</td>
        <td>${escapeHTML(p.command)}</td>
        <td>
          <button class="btn btn-danger btn-icon-only kill-proc-btn" data-pid="${p.pid}" title="Kill Process">
            <i data-lucide="x-circle"></i>
          </button>
        </td>
      `;

      // Kill click event
      row.querySelector('.kill-proc-btn').addEventListener('click', async (e) => {
        const pid = e.currentTarget.getAttribute('data-pid');
        if (await customConfirm(`Kill process PID: ${pid}?`)) {
          socket.emit('kill-process', pid);
        }
      });

      processListBody.appendChild(row);
    });

    lucide.createIcons();
  }

  // -------------------------------------------------------------
  // Formats bytes values
  // -------------------------------------------------------------
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Escape HTML helper
  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  // -------------------------------------------------------------
  // VNC Remote Desktop Control
  // -------------------------------------------------------------
  const vncConnectBtn = document.getElementById('vnc-connect-btn');
  const vncDisconnectBtn = document.getElementById('vnc-disconnect-btn');
  const vncPortInput = document.getElementById('vnc-port-input');
  const vncUsernameInput = document.getElementById('vnc-username-input');
  const vncPasswordInput = document.getElementById('vnc-password-input');
  const vncOverlayStatus = document.getElementById('vnc-overlay-status');
  const vncStatusText = document.getElementById('vnc-status-text');

  vncConnectBtn.addEventListener('click', async () => {
    if (!activePiHost) {
      await customAlert("Please connect to your Raspberry Pi via SSH first!");
      return;
    }

    const vncPort = vncPortInput.value.trim() || "5900";
    const vncPassword = vncPasswordInput.value;

    vncStatusText.innerText = "Loading VNC Library...";
    const initialIcon = vncOverlayStatus.querySelector('[data-lucide]');
    if (initialIcon) {
      initialIcon.setAttribute('data-lucide', 'loader');
      initialIcon.classList.add('spinner');
    }
    lucide.createIcons();

    // Construct WebSocket VNC proxy URL on the same host/port as this page
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/vnc?host=${encodeURIComponent(activePiHost)}&port=${vncPort}`;

    const importTimeout = setTimeout(() => {
      vncOverlayStatus.style.display = 'flex';
      const icon = vncOverlayStatus.querySelector('[data-lucide]');
      if (icon) {
        icon.setAttribute('data-lucide', 'monitor');
        icon.classList.remove('spinner');
      }
      vncStatusText.innerText = 'Failed to load VNC Library: Timeout (check network / security policies)';
      lucide.createIcons();
    }, 8000);

    // Dynamically import local noVNC core RFB library
    import('./novnc/core/rfb.js')
      .then((module) => {
        clearTimeout(importTimeout);
        const RFB = module.default;

        vncStatusText.innerText = "Connecting to remote graphical desktop...";

        try {
          rfbInstance = new RFB(document.getElementById('vnc-screen-target'), wsUrl, {
            credentials: { 
              username: vncUsernameInput.value.trim() || '',
              password: vncPassword 
            }
          });

          rfbInstance.scaleViewport = true; // Scale VNC desktop to fit the screen target container
          rfbInstance.clipViewport = false;

          rfbInstance.addEventListener('connect', () => {
            vncOverlayStatus.style.display = 'none';
            vncConnectBtn.style.display = 'none';
            vncDisconnectBtn.style.display = 'inline-flex';
            console.log('VNC remote desktop session established successfully.');
          });

          rfbInstance.addEventListener('disconnect', (e) => {
            console.log('VNC session disconnected:', e.detail);
            vncOverlayStatus.style.display = 'flex';
            const icon = vncOverlayStatus.querySelector('[data-lucide]');
            if (icon) {
              icon.setAttribute('data-lucide', 'monitor');
              icon.classList.remove('spinner');
            }
            vncStatusText.innerText = e.detail.clean 
              ? 'VNC session closed.' 
              : 'Failed to connect. Make sure VNC Server is enabled on the Pi (port ' + vncPort + ').';
            vncConnectBtn.style.display = 'inline-flex';
            vncDisconnectBtn.style.display = 'none';
            rfbInstance = null;
            lucide.createIcons();
          });

          rfbInstance.addEventListener('credentialsrequired', async (e) => {
            const credentials = {};
            const types = e.detail.types;
            
            if (types.includes('username')) {
              const uVal = vncUsernameInput.value.trim() || (await customPrompt("VNC Username:", activePiUser || "nishant") || '');
              if (!uVal) {
                rfbInstance.disconnect();
                return;
              }
              credentials.username = uVal;
            }
            
            if (types.includes('password')) {
              const pass = await customPrompt("VNC Password required:", "", "password");
              if (!pass) {
                rfbInstance.disconnect();
                return;
              }
              credentials.password = pass;
            }
            
            rfbInstance.sendCredentials(credentials);
          });
        } catch (err) {
          vncOverlayStatus.style.display = 'flex';
          vncStatusText.innerText = 'VNC Setup Error: ' + err.message;
          vncConnectBtn.style.display = 'inline-flex';
          vncDisconnectBtn.style.display = 'none';
        }
      })
      .catch((err) => {
        vncOverlayStatus.style.display = 'flex';
        vncStatusText.innerText = 'Failed to load noVNC: ' + err.message;
        vncConnectBtn.style.display = 'inline-flex';
        vncDisconnectBtn.style.display = 'none';
      });
  });

  vncDisconnectBtn.addEventListener('click', () => {
    if (rfbInstance) {
      rfbInstance.disconnect();
    }
  });

  const vncFullscreenBtn = document.getElementById('vnc-fullscreen-btn');
  vncFullscreenBtn.addEventListener('click', () => {
    const vncPanel = document.querySelector('#view-vnc .vnc-panel');
    const isFullscreen = vncPanel.classList.toggle('fullscreen');
    document.body.classList.toggle('vnc-fullscreen-active', isFullscreen);
    const icon = vncFullscreenBtn.querySelector('[data-lucide]');
    if (icon) {
      icon.setAttribute('data-lucide', isFullscreen ? 'minimize-2' : 'maximize-2');
    }
    lucide.createIcons();
  });

  // Handle D-pad and Quick actions buttons clicks
  const setupRemoteKeyListeners = () => {
    const keysymMap = {
      up: 0xFF52,
      down: 0xFF54,
      left: 0xFF51,
      right: 0xFF53,
      enter: 0xFF0D,
      backspace: 0xFF08,
      escape: 0xFF1B
    };

    // 1. D-pad & standard keys
    document.querySelectorAll('.d-pad-btn, .remote-key-btn[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!rfbInstance) return;
        const key = btn.getAttribute('data-key');
        const keysym = keysymMap[key];
        if (keysym) {
          rfbInstance.sendKey(keysym, null, true);
          rfbInstance.sendKey(keysym, null, false);
        }
      });
    });

    // 2. Shortcut Key Combinations
    document.querySelectorAll('.remote-key-btn[data-shortcut]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!rfbInstance) return;
        const shortcut = btn.getAttribute('data-shortcut');

        if (shortcut === 'terminal') {
          // Ctrl + Alt + T
          rfbInstance.sendKey(0xFFE3, 'ControlLeft', true); // Ctrl down
          rfbInstance.sendKey(0xFFE9, 'AltLeft', true);     // Alt down
          rfbInstance.sendKey(0x74, 'KeyT', true);          // T down
          
          rfbInstance.sendKey(0x74, 'KeyT', false);
          rfbInstance.sendKey(0xFFE9, 'AltLeft', false);
          rfbInstance.sendKey(0xFFE3, 'ControlLeft', false);
        } 
        else if (shortcut === 'menu') {
          // Super/Win key (opens applications menu)
          rfbInstance.sendKey(0xFFEB, 'MetaLeft', true);
          rfbInstance.sendKey(0xFFEB, 'MetaLeft', false);
        }
        else if (shortcut === 'desktop') {
          // Super + D (Show desktop)
          rfbInstance.sendKey(0xFFEB, 'MetaLeft', true);
          rfbInstance.sendKey(0x64, 'KeyD', true);
          
          rfbInstance.sendKey(0x64, 'KeyD', false);
          rfbInstance.sendKey(0xFFEB, 'MetaLeft', false);
        }
        else if (shortcut === 'close') {
          // Alt + F4 (Close Window)
          rfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          rfbInstance.sendKey(0xFFBF, 'F4', true);
          
          rfbInstance.sendKey(0xFFBF, 'F4', false);
          rfbInstance.sendKey(0xFFE9, 'AltLeft', false);
        }
        else if (shortcut === 'alt-tab') {
          // Alt + Tab (Switch Window)
          rfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          rfbInstance.sendKey(0xFF09, 'Tab', true);
          
          rfbInstance.sendKey(0xFF09, 'Tab', false);
          rfbInstance.sendKey(0xFFE9, 'AltLeft', false);
        }
        else if (shortcut === 'ctrl-alt-del') {
          // Ctrl + Alt + Delete
          rfbInstance.sendKey(0xFFE3, 'ControlLeft', true);
          rfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          rfbInstance.sendKey(0xFFFF, 'Delete', true);
          
          rfbInstance.sendKey(0xFFFF, 'Delete', false);
          rfbInstance.sendKey(0xFFE9, 'AltLeft', false);
          rfbInstance.sendKey(0xFFE3, 'ControlLeft', false);
        }
      });
    });

    // 3. Direct D-pad & standard keys
    document.querySelectorAll('.direct-d-pad-btn, .direct-key-btn[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!directRfbInstance) return;
        const key = btn.getAttribute('data-key');
        const keysym = keysymMap[key];
        if (keysym) {
          directRfbInstance.sendKey(keysym, null, true);
          directRfbInstance.sendKey(keysym, null, false);
        }
      });
    });

    // 4. Direct Shortcut Key Combinations
    document.querySelectorAll('.direct-key-btn[data-shortcut]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!directRfbInstance) return;
        const shortcut = btn.getAttribute('data-shortcut');

        if (shortcut === 'terminal') {
          directRfbInstance.sendKey(0xFFE3, 'ControlLeft', true);
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          directRfbInstance.sendKey(0x74, 'KeyT', true);
          
          directRfbInstance.sendKey(0x74, 'KeyT', false);
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', false);
          directRfbInstance.sendKey(0xFFE3, 'ControlLeft', false);
        } 
        else if (shortcut === 'menu') {
          directRfbInstance.sendKey(0xFFEB, 'MetaLeft', true);
          directRfbInstance.sendKey(0xFFEB, 'MetaLeft', false);
        }
        else if (shortcut === 'desktop') {
          directRfbInstance.sendKey(0xFFEB, 'MetaLeft', true);
          directRfbInstance.sendKey(0x64, 'KeyD', true);
          
          directRfbInstance.sendKey(0x64, 'KeyD', false);
          directRfbInstance.sendKey(0xFFEB, 'MetaLeft', false);
        }
        else if (shortcut === 'close') {
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          directRfbInstance.sendKey(0xFFBF, 'F4', true);
          
          directRfbInstance.sendKey(0xFFBF, 'F4', false);
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', false);
        }
        else if (shortcut === 'alt-tab') {
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          directRfbInstance.sendKey(0xFF09, 'Tab', true);
          
          directRfbInstance.sendKey(0xFF09, 'Tab', false);
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', false);
        }
        else if (shortcut === 'ctrl-alt-del') {
          directRfbInstance.sendKey(0xFFE3, 'ControlLeft', true);
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', true);
          directRfbInstance.sendKey(0xFFFF, 'Delete', true);
          
          directRfbInstance.sendKey(0xFFFF, 'Delete', false);
          directRfbInstance.sendKey(0xFFE9, 'AltLeft', false);
          directRfbInstance.sendKey(0xFFE3, 'ControlLeft', false);
        }
      });
    });
  };

  // -------------------------------------------------------------
  // Direct Remote Control Auto-connect logic
  // -------------------------------------------------------------
  const directVncOverlayStatus = document.getElementById('direct-vnc-overlay-status');
  const directVncStatusText = document.getElementById('direct-vnc-status-text');
  const directReconnectBtn = document.getElementById('direct-reconnect-btn');

  function startDirectVncSession() {
    if (directRfbInstance) {
      // Session already exists/connecting
      return;
    }

    if (!activePiHost) {
      directVncOverlayStatus.style.display = 'flex';
      const icon = directVncOverlayStatus.querySelector('[data-lucide]');
      if (icon) {
        icon.setAttribute('data-lucide', 'monitor');
        icon.classList.remove('spinner');
      }
      directVncStatusText.innerText = "Please connect to your Raspberry Pi via SSH first!";
      lucide.createIcons();
      return;
    }

    directVncStatusText.innerText = "Loading VNC Library...";
    directVncOverlayStatus.style.display = 'flex';
    const initialIcon = directVncOverlayStatus.querySelector('[data-lucide]');
    if (initialIcon) {
      initialIcon.setAttribute('data-lucide', 'loader');
      initialIcon.classList.add('spinner');
    }
    lucide.createIcons();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/vnc?host=${encodeURIComponent(activePiHost)}&port=5900`;

    const importTimeout = setTimeout(() => {
      directVncOverlayStatus.style.display = 'flex';
      const icon = directVncOverlayStatus.querySelector('[data-lucide]');
      if (icon) {
        icon.setAttribute('data-lucide', 'monitor');
        icon.classList.remove('spinner');
      }
      directVncStatusText.innerText = 'Failed to load VNC Library: Timeout (check network / security policies)';
      directRfbInstance = null;
      lucide.createIcons();
    }, 8000);

    import('./novnc/core/rfb.js')
      .then((module) => {
        clearTimeout(importTimeout);
        const RFB = module.default;
        directVncStatusText.innerText = "Connecting directly to remote graphical desktop...";

        try {
          directRfbInstance = new RFB(document.getElementById('direct-vnc-screen-target'), wsUrl, {
            credentials: { password: "" }
          });

          directRfbInstance.scaleViewport = true;
          directRfbInstance.clipViewport = false;

          directRfbInstance.addEventListener('connect', () => {
            directVncOverlayStatus.style.display = 'none';
            console.log('Direct VNC session established successfully.');
          });

          directRfbInstance.addEventListener('disconnect', (e) => {
            console.log('Direct VNC session disconnected:', e.detail);
            directVncOverlayStatus.style.display = 'flex';
            const icon = directVncOverlayStatus.querySelector('[data-lucide]');
            if (icon) {
              icon.setAttribute('data-lucide', 'monitor');
              icon.classList.remove('spinner');
            }
            directVncStatusText.innerText = e.detail.clean 
              ? 'Direct VNC session closed.' 
              : 'Failed to connect. Make sure VNC Server is enabled on the Pi (port 5900).';
            directRfbInstance = null;
            lucide.createIcons();
          });

          directRfbInstance.addEventListener('credentialsrequired', async (e) => {
            const credentials = {};
            const types = e.detail.types;
            
            if (types.includes('username')) {
              const user = await customPrompt("VNC Username required for Direct Control:", activePiUser || "nishant");
              if (!user) {
                directRfbInstance.disconnect();
                return;
              }
              credentials.username = user;
            }
            
            if (types.includes('password')) {
              const pass = await customPrompt("VNC Password required for Direct Control:", "", "password");
              if (!pass) {
                directRfbInstance.disconnect();
                return;
              }
              credentials.password = pass;
            }
            
            directRfbInstance.sendCredentials(credentials);
          });
        } catch (err) {
          directVncOverlayStatus.style.display = 'flex';
          directVncStatusText.innerText = 'VNC Setup Error: ' + err.message;
          directRfbInstance = null;
        }
      })
      .catch((err) => {
        directVncOverlayStatus.style.display = 'flex';
        directVncStatusText.innerText = 'Failed to load noVNC: ' + err.message;
        directRfbInstance = null;
      });
  }

  directReconnectBtn.addEventListener('click', () => {
    if (directRfbInstance) {
      directRfbInstance.disconnect();
    }
    setTimeout(startDirectVncSession, 500);
  });

  const directFullscreenBtn = document.getElementById('direct-fullscreen-btn');
  directFullscreenBtn.addEventListener('click', () => {
    const vncPanel = document.querySelector('#view-direct .vnc-panel');
    const isFullscreen = vncPanel.classList.toggle('fullscreen');
    document.body.classList.toggle('vnc-fullscreen-active', isFullscreen);
    const icon = directFullscreenBtn.querySelector('[data-lucide]');
    if (icon) {
      icon.setAttribute('data-lucide', isFullscreen ? 'minimize-2' : 'maximize-2');
    }
    lucide.createIcons();
  });

  // -------------------------------------------------------------
  // Custom Reusable In-App Dialog Modal Helpers
  // -------------------------------------------------------------
  const customDialogOverlay = document.getElementById('custom-dialog-overlay');
  const dialogTitle = document.getElementById('dialog-title');
  const dialogMessage = document.getElementById('dialog-message');
  const dialogInput = document.getElementById('dialog-input');
  const dialogCancelBtn = document.getElementById('dialog-cancel-btn');
  const dialogConfirmBtn = document.getElementById('dialog-confirm-btn');

  let activeDialogResolver = null;

  function showCustomDialog({ title, message, type = 'alert', inputType = 'text', defaultValue = '' }) {
    return new Promise((resolve) => {
      activeDialogResolver = resolve;

      dialogTitle.innerText = title;
      dialogMessage.innerText = message;

      const icon = document.getElementById('dialog-icon');
      if (type === 'alert') {
        if (icon) icon.setAttribute('data-lucide', 'info');
        dialogInput.style.display = 'none';
        dialogCancelBtn.style.display = 'none';
        dialogConfirmBtn.innerText = 'OK';
      } else if (type === 'confirm') {
        if (icon) icon.setAttribute('data-lucide', 'help-circle');
        dialogInput.style.display = 'none';
        dialogCancelBtn.style.display = 'inline-flex';
        dialogConfirmBtn.innerText = 'Confirm';
      } else if (type === 'prompt') {
        if (icon) icon.setAttribute('data-lucide', 'edit-3');
        dialogInput.style.display = 'block';
        dialogInput.type = inputType;
        dialogInput.value = defaultValue;
        dialogCancelBtn.style.display = 'inline-flex';
        dialogConfirmBtn.innerText = 'Submit';
        
        setTimeout(() => dialogInput.focus(), 150);
      }

      lucide.createIcons();

      customDialogOverlay.style.display = 'flex';
      setTimeout(() => {
        customDialogOverlay.classList.add('active');
      }, 10);
    });
  }

  function closeCustomDialog(value) {
    customDialogOverlay.classList.remove('active');
    setTimeout(() => {
      customDialogOverlay.style.display = 'none';
      if (activeDialogResolver) {
        activeDialogResolver(value);
        activeDialogResolver = null;
      }
    }, 200);
  }

  dialogConfirmBtn.addEventListener('click', () => {
    if (dialogInput.style.display === 'block') {
      closeCustomDialog(dialogInput.value);
    } else {
      closeCustomDialog(true);
    }
  });

  dialogCancelBtn.addEventListener('click', () => {
    closeCustomDialog(null);
  });

  dialogInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      dialogConfirmBtn.click();
    }
  });

  // Reusable window helper methods
  window.customAlert = (message, title = 'Alert') => {
    return showCustomDialog({ title, message, type: 'alert' });
  };

  window.customConfirm = (message, title = 'Confirm') => {
    return showCustomDialog({ title, message, type: 'confirm' });
  };

  window.customPrompt = (message, defaultValue = '', inputType = 'text', title = 'Prompt') => {
    return showCustomDialog({ title, message, type: 'prompt', inputType, defaultValue });
  };

  // Initialize listeners
  setupRemoteKeyListeners();
});
