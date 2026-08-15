const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Ready. Querying OS and VNC Services...');
  
  const cmd = `
    cat /etc/os-release | grep -E "PRETTY_NAME|VERSION_CODENAME";
    echo "--- VNC Services ---";
    systemctl list-units --type=service | grep -i vnc || echo "No active VNC services";
    systemctl list-unit-files | grep -i vnc || echo "No VNC unit files";
    echo "--- Try enabling VNC ---";
    echo "8532" | sudo -S raspi-config nonint do_vnc 0 2>&1 || echo "raspi-config failed";
    sleep 2;
    ss -tln;
  `;
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error('Exec error:', err);
      conn.end();
      return;
    }
    
    let output = '';
    stream.on('data', (data) => {
      output += data;
    }).on('close', () => {
      console.log(output);
      conn.end();
    });
  });
}).on('error', (err) => {
  console.error('SSH Error:', err);
}).connect({
  host: process.env.PI_HOST || '127.0.0.1',
  port: parseInt(process.env.PI_PORT || '22'),
  username: process.env.PI_USER || 'pi',
  password: process.env.PI_PASSWORD || ''
});
