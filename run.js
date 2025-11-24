const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const p = parseInt(args[0]) || 2; // producers
const c = parseInt(args[1]) || 1; // consumers
const q = parseInt(args[2]) || 10; // queue

// Create producer folders
for (let i = 1; i <= p; i++) {
  const folder = `producer${i}`;
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
    console.log(`Created folder ${folder}`);
  }
}

// Start consumers
const servers = [];
const consumerProcesses = [];
for (let i = 0; i < c; i++) {
  const port = 50051 + i;
  servers.push(`localhost:${port}`);
  const consumerProcess = spawn('node', ['consumer.js', port.toString(), q.toString()], {
    stdio: 'inherit'
  });
  consumerProcesses.push(consumerProcess);
}

// Start producers
const producerProcesses = [];
for (let i = 0; i < p; i++) {
  const folder = `producer${i + 1}`;
  const server = servers[i % c];
  const producerProcess = spawn('node', ['producer.js', folder, server], {
    stdio: 'inherit'
  });
  producerProcesses.push(producerProcess);
}

console.log(`Started ${p} producers, ${c} consumers with queue size ${q}`);
