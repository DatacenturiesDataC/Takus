// Takus — MediaRecorder Wrapper
import { AudioEngine } from './audio-engine.js';
import { getConfig } from './config.js';
import { getSetting } from './storage.js';
import { MS_PER_HOUR } from './utils.js';

export class Recorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.displayStream = null;
    this.micStream = null;
    this.combinedStream = null;
    this.audioEngine = new AudioEngine();
    this.startTime = null;
    this.pausedDuration = 0;
    this._pauseStart = null;
    this._timerInterval = null;
    this._mimeType = 'video/webm';
    this._onTick = null;
    this._onStop = null;
    this._onError = null;
  }

  get audioLevel() { return this.audioEngine.level; }
  get stream() { return this.combinedStream || this.displayStream; }
  get isRecording() { return this.mediaRecorder?.state === 'recording'; }
  get isPaused() { return this.mediaRecorder?.state === 'paused'; }

  get elapsed() {
    if (!this.startTime) return 0;
    const now = Date.now();
    const raw = now - this.startTime;
    const paused = this._pauseStart ? (now - this._pauseStart) : 0;
    return raw - this.pausedDuration - paused;
  }

  get totalSize() {
    return this.chunks.reduce((s, c) => s + c.size, 0);
  }

  onTick(fn) { this._onTick = fn; }
  onStop(fn) { this._onStop = fn; }
  onError(fn) { this._onError = fn; }

  async requestStreams() {
    // Display stream — getDisplayMedia must be a direct user gesture, no try/catch wrapper.
    this.displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: true,
    });

    try {
      // Mic stream (optional)
      try {
        const micDeviceId = await getSetting('micDevice');
        const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 };
        if (micDeviceId && micDeviceId !== 'default') {
          audioConstraints.deviceId = { exact: micDeviceId };
        }
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (e) {
        console.warn('[Recorder] Mic not available:', e.message);
        this.micStream = null;
      }

      // Mix audio if either stream has audio
      const hasDisplayAudio = this.displayStream.getAudioTracks().length > 0;
      const hasMic = this.micStream && this.micStream.getAudioTracks().length > 0;

      if (hasDisplayAudio || hasMic) {
        const mixedAudioStream = await this.audioEngine.init(
          hasDisplayAudio ? this.displayStream : null,
          hasMic ? this.micStream : null
        );
        const videoTrack = this.displayStream.getVideoTracks()[0];
        const audioTracks = mixedAudioStream.getAudioTracks();
        this.combinedStream = new MediaStream([videoTrack, ...audioTracks]);
      } else {
        this.combinedStream = this.displayStream;
      }

      // Handle user clicking "Stop Sharing" in browser
      this.displayStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this._onTrackEnded) this._onTrackEnded();
        if (this.isRecording || this.isPaused) this.stop();
      });

      return this.combinedStream;
    } catch (err) {
      // If anything after getDisplayMedia fails, release the streams we already opened.
      this._releaseStreams();
      throw err;
    }
  }

  onTrackEnded(fn) { this._onTrackEnded = fn; }

  _releaseStreams() {
    if (this.displayStream) this.displayStream.getTracks().forEach((t) => t.stop());
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    this.audioEngine.destroy();
    this.displayStream = null;
    this.micStream = null;
    this.combinedStream = null;
  }

  start(videoQuality = '720p', audioQuality = 'medium') {
    if (!this.combinedStream) throw new Error('No stream — call requestStreams() first');

    const cfg = getConfig();
    const vq = cfg.capture.qualities[videoQuality] || cfg.capture.qualities['720p'];
    const aq = cfg.capture.audioQualities[audioQuality] || cfg.capture.audioQualities.medium;

    // Find best supported MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
    ];
    let mimeType = 'video/webm';
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
    }
    this._mimeType = mimeType;

    this.mediaRecorder = new MediaRecorder(this.combinedStream, {
      mimeType,
      videoBitsPerSecond: vq.bitrate,
      audioBitsPerSecond: aq,
    });

    this.chunks = [];
    this.startTime = Date.now();
    this.pausedDuration = 0;
    this._pauseStart = null;

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      this._stopTimer();
      if (this._onStop) this._onStop(this.getBlob());
    };

    this.mediaRecorder.onerror = (e) => {
      console.error('[Recorder] Error:', e.error);
      if (this._onError) this._onError(e.error);
    };

    this.mediaRecorder.start(1000);
    this._startTimer();
  }

  pause() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
      this._pauseStart = Date.now();
    }
  }

  resume() {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
      if (this._pauseStart) {
        this.pausedDuration += Date.now() - this._pauseStart;
        this._pauseStart = null;
      }
    }
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      if (this._pauseStart) {
        this.pausedDuration += Date.now() - this._pauseStart;
        this._pauseStart = null;
      }
      this.mediaRecorder.stop();
    }
  }

  getBlob() {
    return new Blob(this.chunks, { type: this._mimeType || 'video/webm' });
  }

  cleanup() {
    this._stopTimer();
    this._releaseStreams();
    this.mediaRecorder = null;
    this.chunks = [];
    this.startTime = null;
    this.pausedDuration = 0;
    this._pauseStart = null;
    this._mimeType = 'video/webm';
    this._onTrackEnded = null;
    this._onTick = null;
    this._onStop = null;
    this._onError = null;
  }

  _startTimer() {
    this._timerInterval = setInterval(() => {
      if (this._onTick) this._onTick(this.elapsed, this.totalSize);
    }, 500);
  }

  _stopTimer() {
    if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
  }
}

// --- Utilities ---
export function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / MS_PER_HOUR);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function generateFilename(pattern, title) {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const time = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }).replace(':','-');
  // Sanitize title — strip characters illegal on common filesystems
  const safeTitle = (title || 'Recording').replace(/[\/\\:*?"<>|]/g, '').trim() || 'Recording';
  return pattern
    .replace('{title}', safeTitle)
    .replace('{date}', date)
    .replace('{time}', time)
    .replace('{timestamp}', now.toISOString().replace(/[:.]/g, '-'));
}

/**
 * Extract duration in seconds from a video/audio blob.
 * Uses a temporary media element and loadedmetadata event.
 * Times out after 5s to avoid blocking the pipeline.
 * @param {Blob} blob
 * @returns {Promise<number>} duration in seconds (0 on failure)
 */
export function extractDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(blob.type?.startsWith('audio') ? 'audio' : 'video');
    el.preload = 'metadata';
    el.muted = true;

    let _cleaned = false;
    const cleanup = () => {
      if (_cleaned) return;
      _cleaned = true;
      el.src = '';
      el.load();
      URL.revokeObjectURL(url);
    };

    el.addEventListener('loadedmetadata', () => {
      const dur = isFinite(el.duration) ? Math.round(el.duration) : 0;
      cleanup();
      resolve(dur);
    });

    el.addEventListener('error', () => { cleanup(); resolve(0); });

    // Timeout: don't block pipeline for corrupt files
    setTimeout(() => { cleanup(); resolve(0); }, 5000);

    el.src = url;
  });
}
