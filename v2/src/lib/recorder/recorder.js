// Ported from v1 src/lib/recorder.js — imports updated for v2 module layout
import { AudioEngine } from './audio-engine.js';
import { RECORDING_CONFIG } from './config.js';

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
    this._onTrackEnded = null;
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
  onTrackEnded(fn) { this._onTrackEnded = fn; }

  /**
   * @param {string | null} micDeviceId
   */
  async requestStreams(micDeviceId = null) {
    this.displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: true,
    });

    try {
      try {
        const audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        };
        if (micDeviceId && micDeviceId !== 'default') {
          audioConstraints.deviceId = { exact: micDeviceId };
        }
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (e) {
        console.warn('[Recorder] Mic not available:', e.message);
        this.micStream = null;
      }

      const hasDisplayAudio = this.displayStream.getAudioTracks().length > 0;
      const hasMic = this.micStream && this.micStream.getAudioTracks().length > 0;

      if (hasDisplayAudio || hasMic) {
        const mixedAudioStream = await this.audioEngine.init(
          hasDisplayAudio ? this.displayStream : null,
          hasMic ? this.micStream : null,
        );
        const videoTrack = this.displayStream.getVideoTracks()[0];
        const audioTracks = mixedAudioStream.getAudioTracks();
        this.combinedStream = new MediaStream([videoTrack, ...audioTracks]);
      } else {
        this.combinedStream = this.displayStream;
      }

      this.displayStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this._onTrackEnded) this._onTrackEnded();
        if (this.isRecording || this.isPaused) this.stop();
      });

      return this.combinedStream;
    } catch (err) {
      this._releaseStreams();
      throw err;
    }
  }

  start(videoQuality = '720p', audioQuality = 'medium') {
    if (!this.combinedStream) throw new Error('No stream — call requestStreams() first');

    const vq = RECORDING_CONFIG.qualities[videoQuality] || RECORDING_CONFIG.qualities['720p'];
    const aq = RECORDING_CONFIG.audioQualities[audioQuality] || RECORDING_CONFIG.audioQualities.medium;

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
      if (this._onStop) this._onStop(this.getBlob(), this.elapsed);
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

  _releaseStreams() {
    if (this.displayStream) this.displayStream.getTracks().forEach((t) => t.stop());
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    this.audioEngine.destroy();
    this.displayStream = null;
    this.micStream = null;
    this.combinedStream = null;
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
