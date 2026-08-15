const { Client } = require('ssh2');

const host = process.argv[2];
const username = process.argv[3];
const password = process.argv[4];

if (!host || !username || !password) {
  console.log("Usage: node test_conn.js <IP> <username> <password>");
  process.exit(1);
}

console.log(`Testing SSH connection to ${username}@${host}...`);

const conn = new Client();
conn.on('ready', () => {
  console.log('✅ SUCCESS: SSH connection established successfully using ssh2!');
  conn.end();
  process.exit(0);
}).on('error', (err) => {
  console.error('❌ ERROR: Connection failed!');
  console.error(err);
  process.exit(1);
}).connect({
  host: host,
  port: 22,
  username: username,
  password: password,
  readyTimeout: 10000
});
