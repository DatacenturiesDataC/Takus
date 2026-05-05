// Takus — Preview Canvas + Audio Visualization
import { icons } from '../lib/icons.js';

let _meterRAF = null;

export function renderPreviewCanvas(container) {
  container.innerHTML = `
    <div class="preview-container" id="preview-box">
      <video id="preview-video" autoplay muted playsinline style="display:none;"></video>
      <div class="preview-placeholder" id="preview-placeholder">
        ${icons.monitor(48)}
        <p style="font-size:var(--font-sm);">Your screen preview will appear here</p>
      </div>
      <div class="audio-meter-bar" id="audio-meter" style="display:none;">
        <div class="audio-meter-fill" id="audio-meter-fill"></div>
      </div>
    </div>
  `;
}

export function showPreview(stream) {
  const video = document.getElementById('preview-video');
  const placeholder = document.getElementById('preview-placeholder');
  const meter = document.getElementById('audio-meter');
  if (!video) return;

  video.srcObject = stream;
  video.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
  if (meter) meter.style.display = 'block';

  video.play().catch(() => {});
}

export function hidePreview() {
  const video = document.getElementById('preview-video');
  const placeholder = document.getElementById('preview-placeholder');
  const meter = document.getElementById('audio-meter');
  if (video) { video.srcObject = null; video.style.display = 'none'; }
  if (placeholder) placeholder.style.display = 'flex';
  if (meter) meter.style.display = 'none';
  stopAudioMeter();
}

export function startAudioMeter(recorder) {
  stopAudioMeter();
  const fill = document.getElementById('audio-meter-fill');
  if (!fill) return;

  const tick = () => {
    const level = recorder.audioLevel;
    fill.style.width = `${Math.min(level * 100, 100)}%`;
    // Color shifts from green to yellow to red
    if (level > 0.7) fill.style.background = 'var(--color-danger)';
    else if (level > 0.4) fill.style.background = 'var(--color-warning)';
    else fill.style.background = 'var(--color-success)';
    _meterRAF = requestAnimationFrame(tick);
  };
  tick();
}

export function stopAudioMeter() {
  if (_meterRAF) { cancelAnimationFrame(_meterRAF); _meterRAF = null; }
}
