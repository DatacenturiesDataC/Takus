// Takus — Settings Panel
import { getConfig } from '../lib/config.js';
import { saveSetting, getSetting } from '../lib/storage.js';

export async function renderSettingsPanel(container) {
  const cfg = getConfig();

  // Load saved settings
  const savedQuality = await getSetting('videoQuality') || cfg.recording.defaultVideoQuality;
  const savedAudio = await getSetting('audioQuality') || cfg.recording.defaultAudioQuality;

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header">
        <h3>Settings</h3>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div class="input-group">
          <label for="setting-title">Meeting Title</label>
          <input class="input" type="text" id="setting-title" placeholder="e.g. Team Standup" autocomplete="off" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
          <div class="input-group">
            <label for="setting-video">Video</label>
            <select class="select" id="setting-video">
              <option value="480p" ${savedQuality==='480p'?'selected':''}>480p SD</option>
              <option value="720p" ${savedQuality==='720p'?'selected':''}>720p HD</option>
              <option value="1080p" ${savedQuality==='1080p'?'selected':''}>1080p FHD</option>
            </select>
          </div>
          <div class="input-group">
            <label for="setting-audio">Audio</label>
            <select class="select" id="setting-audio">
              <option value="low" ${savedAudio==='low'?'selected':''}>64 kbps</option>
              <option value="medium" ${savedAudio==='medium'?'selected':''}>96 kbps</option>
              <option value="high" ${savedAudio==='high'?'selected':''}>128 kbps</option>
            </select>
          </div>
        </div>
        <div id="size-estimate" style="font-size:var(--font-xs);color:var(--color-text-muted);"></div>
      </div>
    </div>
  `;

  updateEstimate();
  container.querySelector('#setting-video').addEventListener('change', (e) => { saveSetting('videoQuality', e.target.value); updateEstimate(); });
  container.querySelector('#setting-audio').addEventListener('change', (e) => { saveSetting('audioQuality', e.target.value); updateEstimate(); });
}

function updateEstimate() {
  const vq = document.getElementById('setting-video')?.value || '720p';
  const aq = document.getElementById('setting-audio')?.value || 'medium';
  const cfg = getConfig();
  const vBitrate = cfg.recording.qualities[vq]?.bitrate || 2_500_000;
  const aBitrate = cfg.recording.audioQualities[aq] || 96_000;
  const totalBps = vBitrate + aBitrate;
  const mbPerMin = (totalBps * 60) / 8 / (1024 * 1024);
  const el = document.getElementById('size-estimate');
  if (el) el.textContent = `≈ ${mbPerMin.toFixed(1)} MB/min · ${(mbPerMin * 60).toFixed(0)} MB/hour`;
}

export function getSettings() {
  return {
    title: document.getElementById('setting-title')?.value || '',
    videoQuality: document.getElementById('setting-video')?.value || '720p',
    audioQuality: document.getElementById('setting-audio')?.value || 'medium',
  };
}
