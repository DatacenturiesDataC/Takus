// Ported from v1 src/lib/audio-engine.js — no changes needed

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gainSystem = null;
    this.gainMic = null;
    this._level = 0;
    this._animFrame = null;
  }

  get level() { return this._level; }
  get analyserNode() { return this.analyser; }

  async init(systemStream, micStream) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    const destination = this.ctx.createMediaStreamDestination();

    if (systemStream && systemStream.getAudioTracks().length > 0) {
      const sysSource = this.ctx.createMediaStreamSource(systemStream);
      this.gainSystem = this.ctx.createGain();
      this.gainSystem.gain.value = 1.0;
      sysSource.connect(this.gainSystem);
      this.gainSystem.connect(destination);
      this.gainSystem.connect(this.analyser);
    }

    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = this.ctx.createMediaStreamSource(micStream);
      this.gainMic = this.ctx.createGain();
      this.gainMic.gain.value = 1.0;
      micSource.connect(this.gainMic);
      this.gainMic.connect(destination);
      if (!this.gainSystem) this.gainMic.connect(this.analyser);
    }

    this._startLevelMonitor();
    return destination.stream;
  }

  setSystemVolume(v) { if (this.gainSystem) this.gainSystem.gain.value = v; }
  setMicVolume(v)    { if (this.gainMic)    this.gainMic.gain.value = v; }

  _startLevelMonitor() {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      this._level = sum / data.length / 255;
      this._animFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  getFrequencyData(uint8Array) {
    if (this.analyser) this.analyser.getByteFrequencyData(uint8Array);
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    this._animFrame = null;
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.gainSystem = null;
    this.gainMic = null;
    this._level = 0;
  }
}
