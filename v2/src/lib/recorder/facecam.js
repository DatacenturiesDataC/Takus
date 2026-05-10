// Ported from v1 src/lib/facecam.js
// getSetting dependency removed — device ID is passed in as a parameter instead.

export class FacecamManager {
  constructor() {
    this.stream = null;
    this.videoEl = null;
    this.isActive = false;
    this._onDeactivate = null;
    this._dragCleanup = null;
  }

  onDeactivate(fn) { this._onDeactivate = fn; }

  async toggle(cameraDeviceId = null) {
    if (this.isActive) { await this.stop(); return false; }
    await this.start(cameraDeviceId);
    return true;
  }

  async start(cameraDeviceId = null) {
    if (this.isActive) return;
    try {
      const videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
      if (cameraDeviceId && cameraDeviceId !== 'default') {
        videoConstraints.deviceId = { exact: cameraDeviceId };
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

      this.videoEl = document.createElement('video');
      this.videoEl.autoplay = true;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.srcObject = this.stream;
      Object.assign(this.videoEl.style, {
        position: 'fixed', opacity: '0', pointerEvents: 'none',
        bottom: '0', right: '0', width: '1px', height: '1px',
      });
      document.body.appendChild(this.videoEl);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Camera load timeout')), 10000);
        this.videoEl.onloadedmetadata = () => {
          this.videoEl.play()
            .then(() => { clearTimeout(timer); resolve(); })
            .catch((e) => { clearTimeout(timer); reject(e); });
        };
        this.videoEl.onerror = () => { clearTimeout(timer); reject(new Error('Camera element error')); };
      });

      this.isActive = true;

      if (document.pictureInPictureEnabled) {
        try {
          await this.videoEl.requestPictureInPicture();
        } catch {
          console.warn('[Facecam] PiP unavailable — showing fallback overlay.');
          this._showFallbackOverlay();
        }
      } else {
        this._showFallbackOverlay();
      }

      this.videoEl.addEventListener('leavepictureinpicture', () => {
        this.stop();
        if (this._onDeactivate) this._onDeactivate();
      }, { once: true });

    } catch (err) {
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.videoEl) { this.videoEl.srcObject = null; this.videoEl.remove(); this.videoEl = null; }
      this.isActive = false;
      throw err;
    }
  }

  _showFallbackOverlay() {
    if (!this.videoEl) return;
    Object.assign(this.videoEl.style, {
      opacity: '1', width: '200px', height: 'auto',
      bottom: '20px', right: '20px', top: 'auto', left: 'auto',
      borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      border: '2px solid rgba(255,255,255,0.15)', zIndex: '9999',
      pointerEvents: 'auto', cursor: 'move', userSelect: 'none',
    });

    let isDragging = false, offsetX = 0, offsetY = 0;
    const getPos = (e) => e.touches
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX, y: e.clientY };

    const onDown = (e) => {
      isDragging = true;
      const pos = getPos(e);
      const rect = this.videoEl.getBoundingClientRect();
      offsetX = pos.x - rect.left;
      offsetY = pos.y - rect.top;
      Object.assign(this.videoEl.style, {
        bottom: 'auto', right: 'auto',
        left: `${pos.x - offsetX}px`, top: `${pos.y - offsetY}px`,
      });
    };
    const onMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const pos = getPos(e);
      this.videoEl.style.left = `${pos.x - offsetX}px`;
      this.videoEl.style.top = `${pos.y - offsetY}px`;
    };
    const onUp = () => { isDragging = false; };

    this.videoEl.addEventListener('mousedown', onDown);
    this.videoEl.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    this._dragCleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };
  }

  async stop() {
    if (!this.isActive) return;
    if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
    if (document.pictureInPictureElement === this.videoEl) {
      await document.exitPictureInPicture().catch(() => {});
    }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.videoEl) { this.videoEl.srcObject = null; this.videoEl.remove(); this.videoEl = null; }
    this.isActive = false;
  }
}
