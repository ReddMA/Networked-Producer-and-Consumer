const fs = require('fs');
const path = require('path');

const folders = ['uploads', 'compressed', 'previews'];

folders.forEach(folder => {
  if (fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
    console.log(`Deleted ${folder}`);
  }
});

// Delete producer folders
for (let i = 1; ; i++) {
  const folder = `producer${i}`;
  if (fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
    console.log(`Deleted ${folder}`);
  } else {
    break;
  }
}

console.log('Cleanup complete');
