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
      document.body.appendChild(this.videoEl);

      await new Promise((resolve) => {
        this.videoEl.onloadedmetadata = () => {
          this.videoEl.play().then(resolve);
        };
      });

      if (document.pictureInPictureEnabled) {
        await this.videoEl.requestPictureInPicture();
      }

      this.isActive = true;
      
      // If user closes PiP natively, stop the stream
      this.videoEl.addEventListener('leavepictureinpicture', () => {
        this.stop();
      });

    } catch (err) {
      console.error('[Facecam] Error starting camera:', err);
      this.stop();
      throw err;
    }
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
