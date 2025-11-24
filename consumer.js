const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const express = require('express');
const { exec } = require('child_process');

const PROTO_PATH = './media.proto';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const mediaProto = grpc.loadPackageDefinition(packageDefinition).media;

const UPLOAD_DIR = './uploads';
const COMPRESSED_DIR = './compressed';
const PREVIEW_DIR = './previews';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(COMPRESSED_DIR)) fs.mkdirSync(COMPRESSED_DIR);
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR);

class Consumer {
  constructor(maxQueue) {
    this.queue = [];
    this.maxQueue = maxQueue;
    this.duplicates = new Set();
  }

  uploadVideo(call, callback) {
    let chunks = [];
    let filename = '';
    let hash = '';

    call.on('data', (chunk) => {
      if (!filename) filename = chunk.filename;
      if (!hash) hash = chunk.hash;
      chunks.push(chunk.data);
    });

    call.on('end', () => {
      if (this.queue.length >= this.maxQueue) {
        callback(null, { status: 'error', message: 'Queue full' });
        return;
      }

      if (this.duplicates.has(hash)) {
        callback(null, { status: 'duplicate', message: 'Video already exists' });
        return;
      }

      this.duplicates.add(hash);
      this.queue.push({ filename, data: Buffer.concat(chunks), hash });
      this.processQueue();
      callback(null, { status: 'success', message: 'Video uploaded' });
    });
  }

  getQueueStatus(call, callback) {
    callback(null, { full: this.queue.length >= this.maxQueue, current_size: this.queue.length });
  }

  processQueue() {
    if (this.queue.length === 0) return;

    const video = this.queue.shift();
    const uploadPath = path.join(UPLOAD_DIR, video.filename);
    fs.writeFileSync(uploadPath, video.data);

    // Compress
    const compressedPath = path.join(COMPRESSED_DIR, video.filename);
    ffmpeg(uploadPath)
      .output(compressedPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('640x480')
      .on('end', () => {
        console.log(`Compressed ${video.filename}`);
        // Create preview
        this.createPreview(compressedPath, video.filename);
      })
      .on('error', (err) => console.error(err))
      .run();
  }

  createPreview(videoPath, filename) {
    const previewPath = path.join(PREVIEW_DIR, filename);
    ffmpeg(videoPath)
      .output(previewPath)
      .duration(10)
      .on('end', () => console.log(`Preview created for ${filename}`))
      .on('error', (err) => console.error(err))
      .run();
  }
}

function startGRPCServer(consumer, port) {
  const server = new grpc.Server();
  server.addService(mediaProto.MediaUpload.service, {
    UploadVideo: consumer.uploadVideo.bind(consumer),
    GetQueueStatus: consumer.getQueueStatus.bind(consumer)
  });
  server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), () => {
    console.log(`gRPC server running on port ${port}`);
    server.start();
  });
}

function startWebServer(port) {
  const app = express();
  app.use(express.static(PREVIEW_DIR));
  app.use('/videos', express.static(COMPRESSED_DIR));

  app.get('/', (req, res) => {
    fs.readdir(COMPRESSED_DIR, (err, files) => {
      if (err) return res.send('Error');
      const html = `
        <html>
        <head><title>Media Consumer</title></head>
        <body>
          <h1>Uploaded Videos</h1>
          <div id="videos"></div>
          <script>
            const videos = ${JSON.stringify(files)};
            const container = document.getElementById('videos');
            videos.forEach(file => {
              const div = document.createElement('div');
              div.innerHTML = \`
                <video id="vid-\${file}" width="320" height="240" muted>
                  <source src="\${file}" type="video/mp4">
                </video>
                <br><button onclick="playFull('\${file}')">\${file}</button>
              \`;
              container.appendChild(div);
              const video = document.getElementById(\`vid-\${file}\`);
              video.onmouseover = () => video.play();
              video.onmouseout = () => { video.pause(); video.currentTime = 0; };
            });
            function playFull(file) {
              window.open(\`/videos/\${file}\`);
            }
          </script>
        </body>
        </html>
      `;
      res.send(html);
    });
  });

  app.listen(port, () => console.log(`Web server running on port ${port}`));
}

const args = process.argv.slice(2);
const port = parseInt(args[0]) || 50051; // gRPC port
const q = parseInt(args[1]) || 10; // queue

const consumer = new Consumer(q);

startGRPCServer(consumer, port);
if (port === 50051) {
  startWebServer(3000);
}

// For multiple consumers, perhaps run multiple instances, but for simplicity, one server handles multiple uploads
