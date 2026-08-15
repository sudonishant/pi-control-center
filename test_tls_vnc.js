const tls = require('tls');

console.log('Testing TLS connection to VNC port 5900 on 10.136.188.172...');
const socket = tls.connect(5900, '10.136.188.172', { rejectUnauthorized: false }, () => {
  console.log('✅ SUCCESS: Established TLS connection to Pi VNC port 5900!');
  console.log('Cipher:', socket.cipher);
  console.log('Protocol:', socket.getProtocol());
  socket.end();
  process.exit(0);
});

socket.on('error', (err) => {
  console.error('❌ ERROR: TLS connection failed!');
  console.error(err);
  process.exit(1);
});

// Set a timeout
setTimeout(() => {
  console.log('Timeout waiting for TLS connection');
  process.exit(1);
}, 5000);
