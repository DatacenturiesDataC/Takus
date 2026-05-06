// Takus — Preview Canvas + Audio Visualization
import { icons } from '../lib/icons.js';

let _meterRAF = null;
const NUM_BARS = 32;

export function renderPreviewCanvas(container) {
  container.innerHTML = `
    <div class="preview-container" id="preview-box">
      <button class="pip-btn" id="btn-pip" title="Picture-in-Picture">
        ${icons.externalLink(18)}
      </button>
      <video id="preview-video" autoplay muted playsinline style="display:none;"></video>
      <div class="preview-placeholder" id="preview-placeholder">
        ${icons.monitor(48)}
        <p style="font-size:var(--font-sm);">Your screen preview will appear here</p>
      </div>
      <div class="waveform-container" id="waveform-container" style="display:none;">
        ${Array(NUM_BARS).fill('<div class="waveform-bar"></div>').join('')}
      </div>
    </div>
  `;

  // Picture in Picture logic
  const video = container.querySelector('#preview-video');
  const btnPip = container.querySelector('#btn-pip');
  
  if (document.pictureInPictureEnabled) {
    btnPip.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (video && video.readyState >= 2) {
          await video.requestPictureInPicture();
        } else {
          // Video not loaded yet — show brief feedback
          btnPip.style.opacity = '0.5';
          setTimeout(() => { btnPip.style.opacity = '1'; }, 1000);
        }
      } catch (err) {
        console.warn('[PiP] Error:', err);
      }
    });
  } else {
    btnPip.style.display = 'none';
  }
}

export function showPreview(stream) {
  const video = document.getElementById('preview-video');
  const placeholder = document.getElementById('preview-placeholder');
  const waveform = document.getElementById('waveform-container');
  if (!video) return;

  video.srcObject = stream;
  video.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
  if (waveform) waveform.style.display = 'flex';

  video.play().catch(() => {});
}

export function hidePreview() {
  // Exit PiP if active — prevents orphaned PiP window with dead stream
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  const video = document.getElementById('preview-video');
  const placeholder = document.getElementById('preview-placeholder');
  const waveform = document.getElementById('waveform-container');
  if (video) { video.srcObject = null; video.style.display = 'none'; }
  if (placeholder) placeholder.style.display = 'flex';
  if (waveform) waveform.style.display = 'none';
  stopAudioMeter();
}

export function startAudioMeter(recorder) {
  stopAudioMeter();
  const container = document.getElementById('waveform-container');
  if (!container || !recorder.audioEngine.analyserNode) return;

  const bars = Array.from(container.querySelectorAll('.waveform-bar'));
  const dataArray = new Uint8Array(recorder.audioEngine.analyserNode.frequencyBinCount);

  const tick = () => {
    recorder.audioEngine.getFrequencyData(dataArray);
    
    // Subsample frequency data to number of bars
    const step = Math.floor(dataArray.length / NUM_BARS);
    
    for (let i = 0; i < NUM_BARS; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
      const avg = sum / step;
      
      const val = Math.max(4, (avg / 255) * 40); // Max height 40px, min 4px
      
      let color = 'var(--color-primary-light)';
      if (avg > 200) color = 'var(--color-danger)';
      else if (avg > 150) color = 'var(--color-warning)';
      else if (avg > 100) color = 'var(--color-success)';

      if (bars[i]) {
        bars[i].style.height = `${val}px`;
        bars[i].style.backgroundColor = color;
      }
    }
    
    _meterRAF = requestAnimationFrame(tick);
  };
  tick();
}

export function stopAudioMeter() {
  if (_meterRAF) { cancelAnimationFrame(_meterRAF); _meterRAF = null; }
}
