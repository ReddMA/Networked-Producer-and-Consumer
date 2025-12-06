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
const async = require('async');

const clients = [];
let producerIndex = 0;

function sendToClients(type, data) {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  });
}

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
  constructor(maxQueue, concurrency) {
    this.maxQueue = maxQueue;
    this.duplicates = new Set();
    this.queue = async.queue(this.processVideo.bind(this), concurrency);
    this.processingCount = 0;
    this.queue.drain(() => console.log('All videos processed'));
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
      if (this.queue.length() >= this.maxQueue) {
        callback(null, { status: 'queue_full', message: 'Queue full' });
        return;
      }

      if (this.duplicates.has(hash)) {
        callback(null, { status: 'duplicate', message: 'Video already exists' });
        return;
      }

      this.duplicates.add(hash);
      this.queue.push({ filename, data: Buffer.concat(chunks), hash });
      this.processingCount++;
      sendToClients('queue', { size: this.processingCount, full: this.queue.length() >= this.maxQueue });
      callback(null, { status: 'success', message: 'Video uploaded' });
    });
  }

  getQueueStatus(call, callback) {
    callback(null, { full: this.queue.length() >= this.maxQueue, current_size: this.queue.length() });
  }

  processVideo(video, callback) {
    const uploadPath = path.join(UPLOAD_DIR, video.filename);
    fs.writeFileSync(uploadPath, video.data);
    console.log(`Saved ${video.filename} to uploads`);

    // Simulate slow processing for testing queue
    setTimeout(() => {
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
          this.createPreview(compressedPath, video.filename, callback);
        })
        .on('error', (err) => {
          console.error(`Compression error for ${video.filename}:`, err);
          callback();
        })
        .run(); 
    }, 3000); // 3 second delay to simulate slow processing
  }

  createPreview(videoPath, filename, callback) {
    const previewPath = path.join(PREVIEW_DIR, filename);
    ffmpeg(videoPath)
      .output(previewPath)
      .duration(10)
      .on('end', () => {
        console.log(`Preview created for ${filename}`);
        callback();
        this.processingCount--;
        sendToClients('queue', { size: this.processingCount, full: this.queue.length() >= this.maxQueue });
        fs.readdir(COMPRESSED_DIR, (err, files) => {
          if (!err) sendToClients('videos', files);
        });
      })
      .on('error', (err) => {
        console.error(`Preview error for ${filename}:`, err);
        callback();
        this.processingCount--;
      })
      .run();
  }
}

function startGRPCServer(consumer, port) {
  const server = new grpc.Server();
  server.addService(mediaProto.MediaUpload.service, {
    UploadVideo: consumer.uploadVideo.bind(consumer),
    GetQueueStatus: consumer.getQueueStatus.bind(consumer)
  });
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), () => {
    console.log(`gRPC server running on port ${port}`);
    server.start();
  });
}

function startWebServer(port) {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/videos', express.static(COMPRESSED_DIR));
  app.use('/previews', express.static(PREVIEW_DIR));

  app.get('/api/videos', (req, res) => {
    fs.readdir(COMPRESSED_DIR, (err, files) => {
      if (err) return res.status(500).json({ error: 'Failed to read videos' });
      res.json(files);
    });
  });

  app.get('/api/queue', (req, res) => {
    res.json({ full: consumer.queue.length() >= consumer.maxQueue, size: consumer.processingCount });
  });

  app.post('/upload', (req, res) => {
    const filename = req.headers['x-filename'];
    if (!filename) return res.status(400).send('Missing filename');
    // Assign to producer folders round-robin
    producerIndex = (producerIndex + 1) % numProducers;
    const producerFolder = `producer${producerIndex + 1}`;
    const folderPath = path.join(__dirname, producerFolder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
    }
    const filepath = path.join(folderPath, filename);
    const writer = fs.createWriteStream(filepath);
    req.on('error', (err) => {
      console.error('Upload error:', err);
      res.status(500).send('Upload failed');
    });
    writer.on('finish', () => {
      console.log(`File uploaded via web to ${producerFolder}: ${filename}`);
      res.send('Uploaded successfully');
    });
    req.pipe(writer);
  });

  app.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    const client = { res };
    clients.push(client);
    req.on('close', () => {
      clients.splice(clients.indexOf(client), 1);
    });
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(port, "0.0.0.0", () => 
  console.log(`Web server running on 0.0.0.0:${port}`));
}

const args = process.argv.slice(2);
const c = parseInt(args[0]) || 1; // concurrency (workers)
const q = parseInt(args[1]) || 10; // queue
const numProducers = parseInt(args[2]) || 2; // number of producers

const consumer = new Consumer(q, c);

startGRPCServer(consumer, 50051);
startWebServer(3000);

// For multiple consumers, perhaps run multiple instances, but for simplicity, one server handles multiple uploads
