const net = require('net');

console.log('Testing TCP connection to VNC port 5900 on 10.136.188.172...');
const socket = net.createConnection({ host: '10.136.188.172', port: 5900 });

socket.on('connect', () => {
  console.log('✅ SUCCESS: Established TCP connection to Pi VNC port 5900!');
  socket.end();
  process.exit(0);
}).on('error', (err) => {
  console.error('❌ ERROR: TCP connection failed!');
  console.error(err);
  process.exit(1);
});
