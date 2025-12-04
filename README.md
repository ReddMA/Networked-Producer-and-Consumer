# Media Upload Producer-Consumer System

This is a producer-consumer system for uploading videos using gRPC, with compression, duplicate detection, and a web-based GUI.

## Components

- **Producer**: Reads video files from separate folders and uploads them to the consumer via gRPC.
- **Consumer**: Receives uploads, compresses videos, detects duplicates, and provides a web GUI to view videos.
- **gRPC**: Communication between producers and consumers.

## Features

- Leaky bucket queue: Drops uploads when queue is full.
- Duplicate detection using MD5 hash.
- Video compression using FFmpeg.
- Web GUI: Lists videos, previews first 10 seconds on hover, plays full video on click.

## Setup

1. Install dependencies: `npm install`
2. Run the system: `npm start` or `node run.js p c q`
3. Clean folders: `npm run clean`

   - p: Number of producers (creates producer1, producer2, ..., producerP folders)
   - c: Concurrency (number of worker threads in consumer for processing)
   - q: Max queue length

4. Place video files in the producer folders (e.g., producer1/video.mp4), or drag & drop videos on the web GUI (saves to producer folders round-robin).
5. Open browser to `http://localhost:3000` for the GUI.

## For Multiple VMs

- Run consumer on one VM: `node consumer.js c q`
- Run producers on other VMs: `node producer.js folder server_address`
  - e.g., `node producer.js producer1 192.168.1.100:50051`
