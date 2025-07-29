class GoogleMeetRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.stream = null;
        this.audioContext = null;
        this.startTime = null;
        this.recordingTimer = null;
        this.estimatedSize = 0;
        this.isPaused = false;

        // UI Elements
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.preview = document.getElementById('preview');
        this.previewPlaceholder = document.getElementById('previewPlaceholder');
        this.status = document.getElementById('status');
        this.recordingInfo = document.getElementById('recordingInfo');
        this.duration = document.getElementById('duration');
        this.fileSize = document.getElementById('fileSize');
        this.startTimeDisplay = document.getElementById('startTime');
        this.audioStatus = document.getElementById('audioStatus');
        this.meetingTitle = document.getElementById('meetingTitle');
        this.progressContainer = document.getElementById('progressContainer');
        this.progressBar = document.getElementById('progressBar');

        this.initializeEventListeners();
        this.detectMeetingInfo();
        this.checkBrowserCompatibility();
    }

    initializeEventListeners() {
        this.startBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.pauseBtn.addEventListener('click', () => this.togglePause());

        // Auto-detect meeting title from page
        setInterval(() => this.detectMeetingInfo(), 2000);

        // Update size estimates when settings change
        document.getElementById('recordingQuality').addEventListener('change', () => this.updateSizeEstimate());
        document.getElementById('audioQuality').addEventListener('change', () => this.updateSizeEstimate());
        document.getElementById('compressionLevel').addEventListener('change', () => this.updateSizeEstimate());

        // Initial size estimate
        this.updateSizeEstimate();
    }

    detectMeetingInfo() {
        // Try to extract meeting information from the current page
        let meetingTitle = '';

        // Check if we're on Google Meet
        if (window.location.hostname.includes('meet.google.com')) {
            // Try to get meeting title from various sources
            const titleElements = [
                document.querySelector('[data-meeting-title]'),
                document.querySelector('h1'),
                document.querySelector('.meeting-title'),
                document.querySelector('[jsname="r4nke"]'), // Google Meet specific
            ];

            for (const element of titleElements) {
                if (element && element.textContent.trim()) {
                    meetingTitle = element.textContent.trim();
                    break;
                }
            }

            // Fallback to URL-based naming
            if (!meetingTitle) {
                const urlParts = window.location.pathname.split('/');
                const meetingId = urlParts[urlParts.length - 1];
                if (meetingId && meetingId.length > 5) {
                    meetingTitle = `Google Meet - ${meetingId.substring(0, 8)}`;
                }
            }
        }

        // If no meeting title detected, create a default one
        if (!meetingTitle) {
            const now = new Date();
            meetingTitle = `Meeting - ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
        }

        // Update the input field if it's empty
        if (!this.meetingTitle.value) {
            this.meetingTitle.value = meetingTitle;
        }
    }

    async startRecording() {
        try {
            this.updateStatus('Requesting screen access...', false);

            console.log('🔍 Checking screen capture capabilities...');
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('Screen capture not supported in this browser');
            }

            console.log('📋 Requesting screen capture permissions...');

            // Request screen capture with compatible constraints
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 30 }
                },
                audio: true  // Simplified audio constraint for better compatibility
            });

            console.log('🎥 Screen capture stream obtained');
            console.log('Video tracks:', displayStream.getVideoTracks().length);
            console.log('Audio tracks:', displayStream.getAudioTracks().length);

            // Log video track settings
            const videoTrack = displayStream.getVideoTracks()[0];
            if (videoTrack) {
                console.log('Video track settings:', videoTrack.getSettings());
                console.log('Video track label:', videoTrack.label);
            } else {
                console.error('❌ No video track found in display stream!');
                throw new Error('No video track available - please share your screen with video');
            }

            // Also try to capture microphone audio
            let micStream = null;
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 48000
                    }
                });
            } catch (micError) {
                console.warn('Microphone access denied or not available:', micError);
            }

            // Combine audio streams if microphone is available
            if (micStream && displayStream.getAudioTracks().length > 0) {
                this.stream = await this.combineAudioStreams(displayStream, micStream);
            } else {
                this.stream = displayStream;
            }

            // Show preview
            this.preview.srcObject = this.stream;
            this.preview.style.display = 'block';
            this.previewPlaceholder.style.display = 'none';

            // Ensure video plays (required for modern browsers)
            try {
                await this.preview.play();
            } catch (playError) {
                console.warn('Preview autoplay prevented:', playError);
                // Add a play button if autoplay is blocked
                this.addManualPlayButton();
            }

            // Set up MediaRecorder with optimal settings
            const options = this.getRecorderOptions();
            console.log('🎬 MediaRecorder options:', options);

            // Verify stream before creating MediaRecorder
            console.log('Final stream tracks:');
            console.log('- Video tracks:', this.stream.getVideoTracks().length);
            console.log('- Audio tracks:', this.stream.getAudioTracks().length);

            if (this.stream.getVideoTracks().length === 0) {
                throw new Error('No video track in final stream - recording would be audio only');
            }

            this.mediaRecorder = new MediaRecorder(this.stream, options);
            console.log('✅ MediaRecorder created successfully');
            console.log('MediaRecorder MIME type:', this.mediaRecorder.mimeType);

            // Event handlers
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                    this.updateEstimatedSize();
                    console.log(`📊 Recorded chunk: ${event.data.size} bytes, total chunks: ${this.recordedChunks.length}`);
                } else {
                    console.warn('⚠️ Received empty data chunk');
                }
            };

            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                this.updateStatus('Recording error occurred', false);
            };

            // Start recording
            this.mediaRecorder.start(1000); // Collect data every second
            this.startTime = new Date();
            this.recordedChunks = [];
            this.estimatedSize = 0;

            // Update UI
            this.updateRecordingUI(true);
            this.startRecordingTimer();
            this.updateStatus('Recording...', true);

            // Show recording info
            this.recordingInfo.style.display = 'block';
            this.startTimeDisplay.textContent = this.startTime.toLocaleTimeString();

        } catch (error) {
            console.error('❌ Error starting recording:', error);
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);

            let errorMessage = 'Failed to start recording';

            if (error.name === 'NotAllowedError') {
                errorMessage = 'Screen sharing permission denied. Please allow screen sharing and try again.';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'No screen or window available to capture.';
            } else if (error.name === 'NotSupportedError') {
                errorMessage = 'Screen capture not supported in this browser. Try using Chrome or Edge.';
            } else if (error.name === 'NotReadableError') {
                errorMessage = 'Screen capture device is busy or not accessible.';
            } else if (error.name === 'AbortError') {
                errorMessage = 'Screen sharing was cancelled by user.';
            } else if (error.message) {
                errorMessage = `Recording failed: ${error.message}`;
            }

            this.updateStatus(errorMessage, false);

            // Show troubleshooting tips
            console.log(`
🔧 TROUBLESHOOTING TIPS:

1. PERMISSION DIALOG:
   - Click "Share" when the permission dialog appears
   - Don't click "Cancel" or close the dialog

2. SCREEN SELECTION:
   - Select "Entire Screen" for full desktop recording
   - Or select the specific browser tab/window
   - Make sure to check "Share tab audio" or "Share system audio"

3. BROWSER COMPATIBILITY:
   - Chrome/Chromium: Best support ✅
   - Edge: Good support ✅  
   - Firefox: Limited support ⚠️
   - Safari: Very limited support ❌

4. HTTPS REQUIREMENT:
   - Screen sharing requires HTTPS
   - Current origin: ${window.location.origin}

5. POPUP BLOCKERS:
   - Disable popup blockers for this site
   - Some extensions can interfere with permissions

Try refreshing the page and clicking "Start Recording" again.
            `);
        }
    }

    async combineAudioStreams(displayStream, micStream) {
        // Create audio context to mix audio streams
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const displayAudioSource = this.audioContext.createMediaStreamSource(displayStream);
        const micAudioSource = this.audioContext.createMediaStreamSource(micStream);
        const destination = this.audioContext.createMediaStreamDestination();

        // Mix both audio sources
        displayAudioSource.connect(destination);
        micAudioSource.connect(destination);

        // Create new stream with video from display and mixed audio
        const videoTrack = displayStream.getVideoTracks()[0];
        const mixedAudioTrack = destination.stream.getAudioTracks()[0];

        return new MediaStream([videoTrack, mixedAudioTrack]);
    }

    getRecorderOptions() {
        const quality = document.getElementById('recordingQuality').value;
        const audioQuality = document.getElementById('audioQuality').value;
        const compressionLevel = document.getElementById('compressionLevel').value;

        // Base video bitrates
        const baseBitrates = {
            '480': 1000000,  // 1.0 Mbps
            '720': 2500000,  // 2.5 Mbps
            '1080': 5000000  // 5.0 Mbps
        };

        // Compression multipliers
        const compressionMultipliers = {
            'standard': 1.0,     // No compression
            'compressed': 0.7,   // 30% reduction
            'maximum': 0.5       // 50% reduction
        };

        // Calculate final bitrates with compression
        const videoBitrates = {};
        const compressionMultiplier = compressionMultipliers[compressionLevel];

        for (const [key, baseBitrate] of Object.entries(baseBitrates)) {
            videoBitrates[key] = Math.round(baseBitrate * compressionMultiplier);
        }

        const audioBitrates = {
            '64': 64000,
            '96': 96000,
            '128': 128000
        };

        console.log(`🗜️ Compression: ${compressionLevel} (${Math.round((1 - compressionMultiplier) * 100)}% reduction)`);
        console.log(`📹 Video bitrate: ${(videoBitrates[quality] / 1000000).toFixed(1)} Mbps`);

        // Try different MIME types for better compatibility
        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=h264,opus',
            'video/webm'
        ];

        let selectedMimeType = 'video/webm';
        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                selectedMimeType = mimeType;
                console.log('✅ Using MIME type:', mimeType);
                break;
            }
        }

        if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
            console.warn('⚠️ Selected MIME type not supported:', selectedMimeType);
        }

        return {
            mimeType: selectedMimeType,
            videoBitsPerSecond: videoBitrates[quality],
            audioBitsPerSecond: audioBitrates[audioQuality]
        };
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();

            // Stop all tracks
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }

            // Clean up audio context
            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }

            this.updateRecordingUI(false);
            this.stopRecordingTimer();
            this.updateStatus('Processing recording...', false);
            this.progressContainer.style.display = 'block';
        }
    }

    togglePause() {
        if (!this.mediaRecorder) return;

        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this.isPaused = true;
            this.pauseBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
            this.updateStatus('Recording paused', false);
        } else if (this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            this.isPaused = false;
            this.pauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
            this.updateStatus('Recording...', true);
        }
    }

    async processRecording() {
        try {
            // Create blob from recorded chunks
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });

            // Generate filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const meetingName = this.meetingTitle.value || 'Meeting';
            const filename = `${meetingName} - ${timestamp}.webm`;

            this.updateProgress(25);

            // Convert to MP4 for better compatibility and smaller size
            const mp4Blob = await this.convertToMP4(blob);
            this.updateProgress(75);

            // Upload to Google Drive if connected
            if (window.GoogleDriveAPI && window.GoogleDriveAPI.isConnected()) {
                this.updateStatus('Uploading to Google Drive...', false);
                await window.GoogleDriveAPI.uploadFile(mp4Blob, filename.replace('.webm', '.mp4'));
                this.updateProgress(100);
                this.updateStatus('Recording saved to Google Drive!', false);
            } else {
                // Download locally
                this.downloadFile(mp4Blob, filename.replace('.webm', '.mp4'));
                this.updateProgress(100);
                this.updateStatus('Recording downloaded!', false);
            }

            // Reset UI after a delay
            setTimeout(() => {
                this.resetUI();
            }, 3000);

        } catch (error) {
            console.error('Error processing recording:', error);
            this.updateStatus('Error processing recording', false);
        }
    }

    async convertToMP4(webmBlob) {
        // For now, return the original blob
        // In a production environment, you'd want to use FFmpeg.js or a server-side conversion
        // This is a placeholder for MP4 conversion
        return webmBlob;
    }

    downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    startRecordingTimer() {
        this.recordingTimer = setInterval(() => {
            if (!this.isPaused && this.startTime) {
                const elapsed = new Date() - this.startTime;
                this.duration.textContent = this.formatDuration(elapsed);
            }
        }, 1000);
    }

    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }

    updateEstimatedSize() {
        // Estimate file size based on chunks
        const totalBytes = this.recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
        this.estimatedSize = totalBytes;
        this.fileSize.textContent = this.formatFileSize(totalBytes);
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000) % 60;
        const minutes = Math.floor(milliseconds / (1000 * 60)) % 60;
        const hours = Math.floor(milliseconds / (1000 * 60 * 60));

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 MB';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateRecordingUI(isRecording) {
        this.startBtn.disabled = isRecording;
        this.stopBtn.disabled = !isRecording;
        this.pauseBtn.disabled = !isRecording;

        if (isRecording) {
            this.status.classList.add('recording');
        } else {
            this.status.classList.remove('recording');
        }
    }

    updateStatus(message, isRecording = false) {
        this.status.textContent = message;
        if (isRecording) {
            this.status.classList.add('recording');
        } else {
            this.status.classList.remove('recording');
        }
    }

    updateProgress(percentage) {
        this.progressBar.style.width = percentage + '%';
    }

    resetUI() {
        this.preview.style.display = 'none';
        this.previewPlaceholder.style.display = 'flex';
        this.recordingInfo.style.display = 'none';
        this.progressContainer.style.display = 'none';
        this.updateRecordingUI(false);
        this.updateStatus('Ready to record', false);
        this.updateProgress(0);

        // Reset recording data
        this.recordedChunks = [];
        this.estimatedSize = 0;
        this.startTime = null;
        this.isPaused = false;
    }

    checkBrowserCompatibility() {
        const browserInfo = this.getBrowserInfo();
        console.log(`🌐 Browser: ${browserInfo.name} ${browserInfo.version}`);

        // Check for required APIs
        const capabilities = {
            getDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
            getUserMedia: !!navigator.mediaDevices?.getUserMedia,
            mediaRecorder: !!window.MediaRecorder,
            webrtc: !!window.RTCPeerConnection
        };

        console.log('🔧 Browser Capabilities:', capabilities);

        // Show warnings for incompatible browsers
        if (!capabilities.getDisplayMedia) {
            console.warn('⚠️ getDisplayMedia not supported - screen recording unavailable');
            this.updateStatus('Screen recording not supported in this browser', false);
        }

        if (browserInfo.name === 'Safari') {
            console.warn('⚠️ Safari has limited screen recording support');
        }

        // Check if running on HTTPS (required for screen capture)
        const isSecure = window.location.protocol === 'https:' ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';

        if (!isSecure) {
            console.warn('⚠️ Screen capture requires HTTPS');
            this.updateStatus('Screen capture requires HTTPS (GitHub Pages provides this)', false);
        }
    }

    getBrowserInfo() {
        const userAgent = navigator.userAgent;
        let name = 'Unknown';
        let version = 'Unknown';

        if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
            name = 'Chrome';
            version = userAgent.match(/Chrome\/(\d+)/)?.[1] || 'Unknown';
        } else if (userAgent.includes('Firefox')) {
            name = 'Firefox';
            version = userAgent.match(/Firefox\/(\d+)/)?.[1] || 'Unknown';
        } else if (userAgent.includes('Edg')) {
            name = 'Edge';
            version = userAgent.match(/Edg\/(\d+)/)?.[1] || 'Unknown';
        } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
            name = 'Safari';
            version = userAgent.match(/Version\/(\d+)/)?.[1] || 'Unknown';
        }

        return { name, version };
    }

    addManualPlayButton() {
        // Create a play button overlay for the preview
        const playOverlay = document.createElement('div');
        playOverlay.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px 25px;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            z-index: 10;
        `;
        playOverlay.innerHTML = '<i class="fas fa-play"></i> Click to preview';

        playOverlay.addEventListener('click', async () => {
            try {
                await this.preview.play();
                playOverlay.remove();
            } catch (error) {
                console.error('Could not play preview:', error);
            }
        });

        this.preview.parentNode.appendChild(playOverlay);
    }

    updateSizeEstimate() {
        const quality = document.getElementById('recordingQuality').value;
        const audioQuality = document.getElementById('audioQuality').value;
        const compressionLevel = document.getElementById('compressionLevel').value;

        // Base video bitrates (bits per second)
        const baseBitrates = {
            '480': 1000000,  // 1.0 Mbps
            '720': 2500000,  // 2.5 Mbps
            '1080': 5000000  // 5.0 Mbps
        };

        const audioBitrates = {
            '64': 64000,
            '96': 96000,
            '128': 128000
        };

        const compressionMultipliers = {
            'standard': 1.0,
            'compressed': 0.7,
            'maximum': 0.5
        };

        // Calculate total bitrate
        const videoBitrate = baseBitrates[quality] * compressionMultipliers[compressionLevel];
        const audioBitrate = audioBitrates[audioQuality];
        const totalBitrate = videoBitrate + audioBitrate;

        // Calculate file sizes (in MB)
        const bytesPerMinute = (totalBitrate * 60) / 8; // bits to bytes
        const mbPerMinute = bytesPerMinute / (1024 * 1024);
        const mbPerHour = mbPerMinute * 60;

        // Update UI
        document.getElementById('sizePerMinute').textContent = `~${mbPerMinute.toFixed(1)}MB`;
        document.getElementById('sizePerHour').textContent = `~${mbPerHour.toFixed(0)}MB`;

        const compressionReduction = Math.round((1 - compressionMultipliers[compressionLevel]) * 100);
        document.getElementById('compressionInfo').textContent =
            compressionReduction > 0 ? `${compressionReduction}% smaller` : 'No compression';

        const qualityNames = {
            '480': '480p SD',
            '720': '720p HD',
            '1080': '1080p Full HD'
        };
        document.getElementById('qualityInfo').textContent = qualityNames[quality];

        console.log(`📊 Size estimate updated: ${mbPerMinute.toFixed(1)}MB/min (${quality} + ${compressionLevel})`);
    }
}

// Initialize the recorder when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.recorder = new GoogleMeetRecorder();
});

// Handle page unload
window.addEventListener('beforeunload', (event) => {
    if (window.recorder && window.recorder.mediaRecorder && window.recorder.mediaRecorder.state === 'recording') {
        event.preventDefault();
        event.returnValue = 'Recording in progress. Are you sure you want to leave?';
        return event.returnValue;
    }
}); 