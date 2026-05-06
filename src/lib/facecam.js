// Takus — Facecam Manager (PiP Webcam)
import { getSetting } from './storage.js';

export class FacecamManager {
  constructor() {
    this.stream = null;
    this.videoEl = null;
    this.isActive = false;
  }

  async toggle() {
    if (this.isActive) {
      await this.stop();
      return false;
    } else {
      await this.start();
      return true;
    }
  }

  async start() {
    if (this.isActive) return;
    try {
      const camDeviceId = await getSetting('cameraDevice');
      const videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
      if (camDeviceId && camDeviceId !== 'default') {
        videoConstraints.deviceId = { exact: camDeviceId };
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false // audio is captured by the main recorder
      });

      this.videoEl = document.createElement('video');
      this.videoEl.autoplay = true;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.srcObject = this.stream;

      // We must append it to DOM for PiP to work reliably in some browsers, but hide it visually
      this.videoEl.style.position = 'fixed';
      this.videoEl.style.opacity = '0';
      this.videoEl.style.pointerEvents = 'none';
      this.videoEl.style.bottom = '0';
      this.videoEl.style.right = '0';
      this.videoEl.style.width = '1px';
      this.videoEl.style.height = '1px';
      document.body.appendChild(this.videoEl);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Camera load timeout')), 10000);
        this.videoEl.onloadedmetadata = () => {
          this.videoEl.play().then(() => { clearTimeout(timer); resolve(); }, (err) => { clearTimeout(timer); reject(err); });
        };
        this.videoEl.onerror = () => { clearTimeout(timer); reject(new Error('Camera element error')); };
      });

      // Mark active BEFORE PiP attempt — the camera stream is working even without PiP.
      this.isActive = true;

      // PiP is a best-effort enhancement. If it fails (e.g. no user gesture context
      // after async getUserMedia + play), the facecam stream is still active and
      // available for mixing. We log the warning but don't throw.
      if (document.pictureInPictureEnabled) {
        try {
          await this.videoEl.requestPictureInPicture();
        } catch (pipErr) {
          console.warn('[Facecam] PiP not available (user gesture lost after async). Camera still active.', pipErr.message);
          // Show the video in a visible floating overlay instead of PiP
          this._showFallbackOverlay();
        }
      }

      // If user closes PiP natively, stop the stream.
      // Use { once: true } to prevent listener stacking from repeated toggle cycles.
      this.videoEl.addEventListener('leavepictureinpicture', () => {
        this.stop();
        // Notify external listeners (e.g. AppShell) so the UI can re-render
        if (this._onDeactivate) this._onDeactivate();
      }, { once: true });

    } catch (err) {
      console.error('[Facecam] Error starting camera:', err);
      // Clean up partial state directly — stop() short-circuits on !isActive.
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.videoEl) {
        this.videoEl.srcObject = null;
        this.videoEl.remove();
        this.videoEl = null;
      }
      this.isActive = false;
      throw err;
    }
  }

  /** When PiP fails, show the webcam as a small draggable overlay in the corner. */
  _showFallbackOverlay() {
    if (!this.videoEl) return;
    this.videoEl.style.opacity = '1';
    this.videoEl.style.width = '200px';
    this.videoEl.style.height = 'auto';
    this.videoEl.style.bottom = '20px';
    this.videoEl.style.right = '20px';
    this.videoEl.style.borderRadius = '12px';
    this.videoEl.style.boxShadow = '0 8px 30px rgba(0,0,0,0.5)';
    this.videoEl.style.border = '2px solid rgba(255,255,255,0.15)';
    this.videoEl.style.zIndex = '9999';
    this.videoEl.style.pointerEvents = 'auto';
    this.videoEl.style.cursor = 'move';
    this.videoEl.style.userSelect = 'none';
    this.videoEl.style.transition = 'none';

    // Make draggable (mouse + touch)
    let isDragging = false, offsetX = 0, offsetY = 0;

    const getPos = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };

    const onDown = (e) => {
      isDragging = true;
      const pos = getPos(e);
      const rect = this.videoEl.getBoundingClientRect();
      offsetX = pos.x - rect.left;
      offsetY = pos.y - rect.top;
      this.videoEl.style.bottom = 'auto';
      this.videoEl.style.right = 'auto';
      this.videoEl.style.left = (pos.x - offsetX) + 'px';
      this.videoEl.style.top = (pos.y - offsetY) + 'px';
    };
    const onMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const pos = getPos(e);
      this.videoEl.style.left = (pos.x - offsetX) + 'px';
      this.videoEl.style.top = (pos.y - offsetY) + 'px';
    };
    const onUp = () => { isDragging = false; };

    this.videoEl.addEventListener('mousedown', onDown);
    this.videoEl.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    // Store refs so stop() can clean them up
    this._dragCleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };
  }

  async stop() {
    if (!this.isActive) return;
    
    // Clean up drag event listeners before removing the video element
    if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }

    if (document.pictureInPictureElement === this.videoEl) {
      await document.exitPictureInPicture().catch(() => {});
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }

    this.isActive = false;
  }
}
