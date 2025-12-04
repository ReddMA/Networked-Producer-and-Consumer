const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const p = parseInt(args[0]) || 2; // producers
const c = parseInt(args[1]) || 1; // concurrency (workers)
const q = parseInt(args[2]) || 10; // queue

// Create producer folders
const numProducers = p;
for (let i = 1; i <= numProducers; i++) {
  const folder = `producer${i}`;
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
    console.log(`Created folder ${folder}`);
  }
}

// Web uploads now go to producer folders

// Start consumer with c workers
const consumerProcess = spawn('node', ['consumer.js', c.toString(), q.toString(), numProducers.toString()], {
  stdio: 'inherit'
});

// Start producers
const producerProcesses = [];
for (let i = 0; i < numProducers; i++) {
  const folder = `producer${i + 1}`;
  const producerProcess = spawn('node', ['producer.js', folder, 'localhost:50051'], {
    stdio: 'inherit'
  });
  producerProcesses.push(producerProcess);
}

console.log(`Started ${numProducers} producers, 1 consumer with ${c} workers, queue size ${q}`);
