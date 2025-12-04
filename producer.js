const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROTO_PATH = './media.proto';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const mediaProto = grpc.loadPackageDefinition(packageDefinition).media;

function computeHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function uploadVideo(client, filePath, filename) {
  const hash = computeHash(filePath);
  const call = client.uploadVideo((error, response) => {
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Response:', response);
    }
  });

  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => {
    call.write({ filename, data: chunk, hash });
  });
  stream.on('end', () => {
    call.end();
  });
}

function checkQueue(client) {
  client.getQueueStatus({}, (error, response) => {
    if (error) {
      console.error('Queue status error:', error);
      return false;
    }
    return !response.full;
  });
}

function startProducer(folderPath, serverAddress = 'localhost:50051') {
  const client = new mediaProto.MediaUpload(serverAddress, grpc.credentials.createInsecure());
  const uploadedFiles = new Set();

  function processFile(file) {
    const filePath = path.join(folderPath, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
    if (uploadedFiles.has(file)) {
      console.log(`File ${file} already uploaded, skipping.`);
      return;
    }
    console.log(`Uploading ${file} from ${folderPath}`);
    // Check queue before upload
    client.getQueueStatus({}, (error, response) => {
      if (error) {
        console.error('Queue status error:', error);
      } else if (!response.full) {
        uploadVideo(client, filePath, file);
        uploadedFiles.add(file);
      } else {
        console.log('Queue full, skipping', file);
      }
    });
  }

  // Initial scan
  console.log(`Scanning folder ${folderPath} for videos...`);
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error('Error reading folder:', err);
      return;
    }
    files.forEach(file => {
      processFile(file);
    });
  });

  // Watch for new files
  console.log(`Watching folder ${folderPath} for new videos...`);
  try {
    fs.watch(folderPath, (eventType, filename) => {
      if (eventType === 'rename' && filename) {
        // Check if file was added
        setTimeout(() => {
          if (fs.existsSync(path.join(folderPath, filename))) {
            console.log(`New file detected: ${filename}`);
            processFile(filename);
          }
        }, 100); // Delay to ensure file is fully written
      }
    });
  } catch (err) {
    console.error('Error watching folder:', err.message);
  }
}

const args = process.argv.slice(2);
const folder = path.resolve(args[0] || './producer1');
const server = args[1] || 'localhost:50051'; // always 50051 for single port

startProducer(folder, server);
