const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Ready. Querying wayvnc systemd logs...');
  
  conn.exec('journalctl -u wayvnc -n 30 2>&1', (err, stream) => {
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

