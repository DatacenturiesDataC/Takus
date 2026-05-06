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

      // If user closes PiP natively, stop the stream
      this.videoEl.addEventListener('leavepictureinpicture', () => {
        this.stop();
      });

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

    // Make draggable
    let isDragging = false, offsetX = 0, offsetY = 0;
    this.videoEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - this.videoEl.getBoundingClientRect().left;
      offsetY = e.clientY - this.videoEl.getBoundingClientRect().top;
      // Switch to absolute positioning for drag
      this.videoEl.style.bottom = 'auto';
      this.videoEl.style.right = 'auto';
      this.videoEl.style.left = (e.clientX - offsetX) + 'px';
      this.videoEl.style.top = (e.clientY - offsetY) + 'px';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      this.videoEl.style.left = (e.clientX - offsetX) + 'px';
      this.videoEl.style.top = (e.clientY - offsetY) + 'px';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  async stop() {
    if (!this.isActive) return;
    
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
