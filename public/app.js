let videos = [];
let queueStatus = {};
let lastVideoCount = 0;

async function loadVideos() {
    try {
        const response = await fetch('/api/videos');
        const newVideos = await response.json();
        if (newVideos.length !== lastVideoCount) {
            videos = newVideos;
            lastVideoCount = videos.length;
            renderVideos();
        }
    } catch (error) {
        console.error('Error loading videos:', error);
    }
}

async function loadQueueStatus() {
    try {
        const response = await fetch('/api/queue');
        const newStatus = await response.json();
        queueStatus = newStatus;
        updateQueueStatus();
    } catch (error) {
        console.error('Error loading queue status:', error);
    }
}

function updateQueueStatus() {
    const statusEl = document.getElementById('queue-status');
    const statusText = queueStatus.full ? 'FULL' : `${queueStatus.size} in queue`;
    statusEl.textContent = statusText;
    statusEl.className = `badge ${queueStatus.full ? 'bg-danger' : queueStatus.size > 0 ? 'bg-warning text-dark' : 'bg-success'}`;
}

function renderVideos() {
    const grid = document.getElementById('videos-grid');
    const noVideos = document.getElementById('no-videos');

    if (videos.length === 0) {
        grid.innerHTML = '';
        noVideos.classList.remove('d-none');
        return;
    }

    noVideos.classList.add('d-none');
    grid.innerHTML = '';

    videos.forEach(video => {
        const col = document.createElement('div');
        col.className = 'col-xl-3 col-lg-4 col-md-6 col-sm-12';

        col.innerHTML = `
            <div class="card video-card h-100" onclick="playFull('${video}')">
                <div class="position-relative">
                    <video class="card-img-top video-thumbnail" muted loop preload="metadata">
                        <source src="/previews/${video}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                    <div class="play-overlay">
                        <i class="fas fa-play-circle fa-3x text-white"></i>
                    </div>
                </div>
                <div class="card-body d-flex flex-column">
                    <h6 class="card-title flex-grow-1">${video}</h6>
                    <div class="video-info">
                        <i class="fas fa-video"></i>
                        <small>Click to play</small>
                    </div>
                </div>
            </div>
        `;

        const videoEl = col.querySelector('video');
        const overlay = col.querySelector('.play-overlay');

        col.addEventListener('mouseenter', () => {
            overlay.style.opacity = '0.8';
            videoEl.play();
        });
        col.addEventListener('mouseleave', () => {
            overlay.style.opacity = '0';
            videoEl.pause();
            videoEl.currentTime = 0;
        });

        grid.appendChild(col);
    });
}

function playFull(filename) {
    window.open(`/videos/${filename}`, '_blank');
}

function refreshData() {
    loadVideos();
    loadQueueStatus();
}

async function uploadFiles(files) {
    const uploadPromises = [];
    for (const file of files) {
        if (file.type.startsWith('video/')) {
            uploadPromises.push(
                fetch('/upload', {
                    method: 'POST',
                    headers: { 'X-Filename': file.name },
                    body: file
                }).then(response => {
                    if (response.ok) {
                        console.log('Uploaded', file.name);
                    } else {
                        console.error('Upload failed for', file.name);
                        response.text().then(text => console.log('Error:', text));
                    }
                }).catch(error => {
                    console.error('Error uploading', file.name, error);
                })
            );
        }
    }
    await Promise.allSettled(uploadPromises);
}

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initial load
    loadVideos();
    loadQueueStatus();

    // Real-time updates via SSE
    const eventSource = new EventSource('/events');
    eventSource.onmessage = (event) => {
        const update = JSON.parse(event.data);
        if (update.type === 'queue') {
            queueStatus = update.data;
            updateQueueStatus();
        } else if (update.type === 'videos') {
            videos = update.data;
            renderVideos();
        }
    };

    // Drag and drop setup
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => uploadFiles(e.target.files));

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        uploadFiles(e.dataTransfer.files);
    });
});
