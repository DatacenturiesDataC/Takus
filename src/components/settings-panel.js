// Takus — Settings Panel
import { getConfig } from '../lib/config.js';
import { saveSetting, getSetting } from '../lib/storage.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { toast } from './toast.js';

/** Escape HTML to prevent XSS from device labels or untrusted strings */
function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

export async function renderSettingsPanel(container) {
  const cfg = getConfig();

  // Load saved settings
  const savedQuality = await getSetting('videoQuality') || cfg.recording.defaultVideoQuality;
  const savedAudio = await getSetting('audioQuality') || cfg.recording.defaultAudioQuality;
  const savedAutoCopy = await getSetting('autoCopyLink') !== false; // default true
  const savedTitle = await getSetting('meetingTitle') || '';
  
  const savedShortcutRecord = await getSetting('shortcutRecord') || 'r';
  const savedShortcutPause = await getSetting('shortcutPause') || ' ';
  const savedShortcutStop = await getSetting('shortcutStop') || 's';

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header">
        <h3>Settings</h3>
        <span id="settings-saved-indicator" style="font-size:var(--font-xs);color:var(--color-success);opacity:0;transition:opacity 0.3s;">✓ Saved</span>
      </div>
      <form autocomplete="off" onsubmit="return false" style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div class="input-group">
          <label for="setting-title">Meeting Title</label>
          <input class="input" type="text" id="setting-title" placeholder="e.g. Team Standup" value="${esc(savedTitle)}" autocomplete="off" />
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
        <div class="input-group mt-2">
          <label for="setting-openai">OpenAI API Key (Optional)</label>
          <input class="input" type="password" id="setting-openai" placeholder="sk-..." autocomplete="off" />
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
            Enables automatic transcriptions & summaries. Saved securely in your browser.
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3); margin-top:var(--space-2);">
          <div class="input-group">
            <label for="setting-camera">Camera</label>
            <select class="select" id="setting-camera">
              <option value="default">Default Camera</option>
            </select>
          </div>
          <div class="input-group">
            <label for="setting-mic">Microphone</label>
            <select class="select" id="setting-mic">
              <option value="default">Default Microphone</option>
            </select>
          </div>
        </div>
        <div class="input-group mt-2">
          <label for="setting-watermark">Video Watermark (Optional)</label>
          <input class="input" type="text" id="setting-watermark" placeholder="e.g. Confidential" autocomplete="off" />
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
            Burns text into the video during export.
          </div>
        </div>
        <div class="input-group mt-2" style="flex-direction:row;align-items:center;gap:8px;">
          <input type="checkbox" id="setting-autocopy" ${savedAutoCopy ? 'checked' : ''} />
          <label for="setting-autocopy" style="margin:0;">Auto-copy link after upload</label>
        </div>
        
        <div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:var(--space-2); padding-top:var(--space-2);">
          <div style="font-size:var(--font-sm); font-weight:var(--weight-semi); margin-bottom:var(--space-2);">Keyboard Shortcuts</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);">
            <div class="input-group">
              <label for="shortcut-record" style="font-size:var(--font-xs);">Record</label>
              <input class="input" type="text" id="shortcut-record" value="${savedShortcutRecord}" maxlength="1" style="text-align:center;" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="shortcut-pause" style="font-size:var(--font-xs);">Pause</label>
              <input class="input" type="text" id="shortcut-pause" value="${savedShortcutPause === ' ' ? 'Space' : savedShortcutPause}" maxlength="5" style="text-align:center;" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="shortcut-stop" style="font-size:var(--font-xs);">Stop</label>
              <input class="input" type="text" id="shortcut-stop" value="${savedShortcutStop}" maxlength="1" style="text-align:center;" autocomplete="off" />
            </div>
          </div>
        </div>

        <div id="size-estimate" style="font-size:var(--font-xs);color:var(--color-text-muted);"></div>
        
        <div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:var(--space-2); padding-top:var(--space-3);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:var(--font-sm); color:var(--color-text-secondary);">
              <strong>Cloud Sync</strong><br>
              <span style="font-size:var(--font-xs); color:var(--color-text-muted);">Backup settings to your connected cloud</span>
            </div>
            <div style="display:flex; gap:var(--space-2);">
              <button class="btn btn-ghost btn-sm" id="btn-fetch-settings">Restore</button>
              <button class="btn btn-primary btn-sm" id="btn-sync-settings">Backup</button>
            </div>
          </div>
        </div>
      </form>
    </div>
  `;

  const savedOpenAI = await getSetting('openaiKey') || '';
  const openaiInput = container.querySelector('#setting-openai');
  if (openaiInput) openaiInput.value = savedOpenAI;

  const savedWatermark = await getSetting('watermarkText') || '';
  const watermarkInput = container.querySelector('#setting-watermark');
  if (watermarkInput) watermarkInput.value = savedWatermark;

  updateEstimate();

  // Flash the "✓ Saved" indicator in the card header
  let _savedTimer = null;
  function flashSaved() {
    const el = document.getElementById('settings-saved-indicator');
    if (!el) return;
    el.style.opacity = '1';
    clearTimeout(_savedTimer);
    _savedTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }
  function saveAndFlash(key, value) { saveSetting(key, value); flashSaved(); }

  container.querySelector('#setting-video').addEventListener('change', (e) => { saveAndFlash('videoQuality', e.target.value); updateEstimate(); });
  container.querySelector('#setting-audio').addEventListener('change', (e) => { saveAndFlash('audioQuality', e.target.value); updateEstimate(); });
  container.querySelector('#setting-title')?.addEventListener('change', (e) => { saveAndFlash('meetingTitle', e.target.value.trim()); });
  openaiInput?.addEventListener('change', (e) => { saveAndFlash('openaiKey', e.target.value.trim()); });
  watermarkInput?.addEventListener('change', (e) => { saveAndFlash('watermarkText', e.target.value.trim()); });
  container.querySelector('#setting-autocopy')?.addEventListener('change', (e) => { saveAndFlash('autoCopyLink', e.target.checked); });
  
  const processShortcut = (val) => val.toLowerCase() === 'space' ? ' ' : val.toLowerCase().slice(0, 1);
  container.querySelector('#shortcut-record')?.addEventListener('change', (e) => { saveAndFlash('shortcutRecord', processShortcut(e.target.value)); });
  container.querySelector('#shortcut-pause')?.addEventListener('change', (e) => { 
    const val = processShortcut(e.target.value);
    saveAndFlash('shortcutPause', val);
    if(val === ' ') e.target.value = 'Space';
  });
  container.querySelector('#shortcut-stop')?.addEventListener('change', (e) => { saveAndFlash('shortcutStop', processShortcut(e.target.value)); });
  
  // Load devices
  const savedCamera = await getSetting('cameraDevice') || 'default';
  const savedMic = await getSetting('micDevice') || 'default';
  
  const camSelect = container.querySelector('#setting-camera');
  const micSelect = container.querySelector('#setting-mic');
  
  camSelect.addEventListener('change', (e) => saveAndFlash('cameraDevice', e.target.value));
  micSelect.addEventListener('change', (e) => saveAndFlash('micDevice', e.target.value));

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    const mics = devices.filter(d => d.kind === 'audioinput');
    
    if (cameras.length > 0) {
      camSelect.innerHTML = cameras.map(d => `<option value="${esc(d.deviceId)}" ${savedCamera===d.deviceId?'selected':''}>${esc(d.label || 'Camera')}</option>`).join('');
    }
    if (mics.length > 0) {
      micSelect.innerHTML = mics.map(d => `<option value="${esc(d.deviceId)}" ${savedMic===d.deviceId?'selected':''}>${esc(d.label || 'Microphone')}</option>`).join('');
    }
  } catch(e) {
    console.warn('Could not enumerate devices:', e);
  }

  // Cloud Sync logic
  container.querySelector('#btn-sync-settings')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const cpm = CloudProviderManager.getInstance();
    if (!cpm.isConnected) {
      return toast.error('Not connected', 'Please connect a cloud provider first.');
    }
    if (btn.disabled) return;
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div> Syncing…`;
    try {
      const provider = cpm.getProvider();
      if (!provider) throw new Error('No active provider');
      const currentSettings = {
        videoQuality: await getSetting('videoQuality'),
        audioQuality: await getSetting('audioQuality'),
        // Note: OpenAI API key is intentionally excluded from cloud backup for security
        cameraDevice: await getSetting('cameraDevice'),
        micDevice: await getSetting('micDevice'),
        watermarkText: await getSetting('watermarkText'),
        autoCopyLink: await getSetting('autoCopyLink'),
        shortcutRecord: await getSetting('shortcutRecord'),
        shortcutPause: await getSetting('shortcutPause'),
        shortcutStop: await getSetting('shortcutStop')
      };
      await provider.storage.syncSettings(currentSettings);
      toast.success('Settings Backed Up', `Saved to ${provider.name}.`);
    } catch (e) {
      toast.error('Sync failed', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  container.querySelector('#btn-fetch-settings')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const cpm2 = CloudProviderManager.getInstance();
    if (!cpm2.isConnected) {
      return toast.error('Not connected', 'Please connect a cloud provider first.');
    }
    if (btn.disabled) return;
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div> Restoring…`;
    try {
      const provider = cpm2.getProvider();
      if (!provider) throw new Error('No active provider');
      const cloudSettings = await provider.storage.fetchSettings();
      if (cloudSettings) {
        for (const [k, v] of Object.entries(cloudSettings)) {
          if (v !== null && v !== undefined) await saveSetting(k, v);
        }
        toast.success('Settings Restored', 'Your settings have been updated.');
        // Re-render to reflect changes
        renderSettingsPanel(container);
      } else {
        toast.info('No backup found', 'No settings found in cloud storage.');
      }
    } catch (e) {
      toast.error('Restore failed', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });
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
    cameraDevice: document.getElementById('setting-camera')?.value || 'default',
    micDevice: document.getElementById('setting-mic')?.value || 'default',
    watermarkText: document.getElementById('setting-watermark')?.value || '',
    autoCopyLink: document.getElementById('setting-autocopy')?.checked !== false
  };
}

export async function getShortcuts() {
  return {
    record: await getSetting('shortcutRecord') || 'r',
    pause: await getSetting('shortcutPause') || ' ',
    stop: await getSetting('shortcutStop') || 's'
  };
}
