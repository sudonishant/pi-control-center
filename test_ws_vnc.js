const WebSocket = require('ws');

const url = 'ws://localhost:3000/vnc?host=10.136.188.172&port=5900';
console.log(`Connecting to WebSocket VNC proxy at ${url}...`);

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('✅ SUCCESS: WebSocket connection opened to VNC proxy!');
});

ws.on('message', (data) => {
  console.log('Received message from VNC proxy (handshake/data):', data.toString().substring(0, 50));
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ ERROR: WebSocket connection failed!');
  console.error(err);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: Code ${code}, Reason: ${reason.toString() || 'None'}`);
  process.exit(1);
});

// Timeout after 5 seconds
setTimeout(() => {
  console.log('Timeout waiting for VNC handshake');
  ws.close();
  process.exit(1);
}, 5000);
