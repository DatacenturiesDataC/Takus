// Takus — Session Config Bar (Title · Camera · Microphone · Test)
// Displayed inline between the recorder controls and history panel on the IDLE screen.
import { icons } from '../lib/icons.js';
import { saveSetting, getSetting } from '../lib/storage.js';
import { toast } from './toast.js';

let _micTestStream = null;
let _micTestRaf = null;

function _stopMicTest() {
  if (_micTestStream) { _micTestStream.getTracks().forEach(t => t.stop()); _micTestStream = null; }
  if (_micTestRaf) { cancelAnimationFrame(_micTestRaf); _micTestRaf = null; }
}

function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

export async function renderSessionConfig(container) {
  _stopMicTest();

  const [savedTitle, savedCamera, savedMic] = await Promise.all([
    getSetting('meetingTitle'),
    getSetting('cameraDevice'),
    getSetting('micDevice'),
  ]);

  container.innerHTML = `
    <div class="card card-compact animate-in" style="padding:var(--space-3) var(--space-4);">
      <div class="session-config-grid">

        <!-- Title -->
        <div class="input-group" style="margin:0;">
          <label for="session-title" style="font-size:var(--font-xs);">${icons.video(12)} Recording Title</label>
          <input class="input" type="text" id="session-title"
            value="${esc(savedTitle || '')}"
            placeholder="e.g. Team Standup · Product Demo"
            autocomplete="off" maxlength="200"
            style="font-size:var(--font-sm);" />
        </div>

        <!-- Camera -->
        <div class="input-group" style="margin:0;min-width:160px;">
          <label for="session-camera" style="font-size:var(--font-xs);">${icons.camera(12)} Camera</label>
          <select class="select" id="session-camera" style="font-size:var(--font-sm);">
            <option value="default">Default Camera</option>
          </select>
        </div>

        <!-- Microphone + Test -->
        <div class="input-group" style="margin:0;min-width:160px;">
          <label for="session-mic" style="font-size:var(--font-xs);">${icons.mic(12)} Microphone</label>
          <div style="display:flex;gap:var(--space-2);align-items:center;">
            <select class="select" id="session-mic" style="font-size:var(--font-sm);flex:1;">
              <option value="default">Default Mic</option>
            </select>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" id="btn-session-test-mic" title="Test microphone">
              ${icons.mic(14)}
            </button>
          </div>
          <div id="session-mic-bar" style="display:none;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-top:4px;">
            <div id="session-mic-level" style="height:100%;width:0%;background:var(--color-primary);border-radius:2px;transition:width 0.05s linear;"></div>
          </div>
        </div>

      </div>
    </div>`;

  // Title save
  container.querySelector('#session-title')?.addEventListener('change', (e) => {
    saveSetting('meetingTitle', e.target.value.trim());
  });

  // Enumerate devices
  const camSelect = container.querySelector('#session-camera');
  const micSelect = container.querySelector('#session-mic');

  camSelect.addEventListener('change', (e) => saveSetting('cameraDevice', e.target.value));
  micSelect.addEventListener('change', (e) => saveSetting('micDevice', e.target.value));

  try {
    // Request mic permission if needed so labels are visible
    await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    const mics    = devices.filter(d => d.kind === 'audioinput');
    if (cameras.length) {
      camSelect.innerHTML = cameras.map(d =>
        `<option value="${esc(d.deviceId)}" ${savedCamera===d.deviceId?'selected':''}>${esc(d.label||'Camera')}</option>`
      ).join('');
    }
    if (mics.length) {
      micSelect.innerHTML = mics.map(d =>
        `<option value="${esc(d.deviceId)}" ${savedMic===d.deviceId?'selected':''}>${esc(d.label||'Microphone')}</option>`
      ).join('');
    }
  } catch {}

  // Mic level test
  const testBtn = container.querySelector('#btn-session-test-mic');
  testBtn?.addEventListener('click', async () => {
    if (_micTestStream) {
      _stopMicTest();
      testBtn.innerHTML = icons.mic(14);
      const bar = container.querySelector('#session-mic-bar');
      if (bar) bar.style.display = 'none';
      return;
    }
    try {
      const deviceId = micSelect.value;
      const audioConstraints = (deviceId && deviceId !== 'default') ? { deviceId: { exact: deviceId } } : true;
      _micTestStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(_micTestStream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const levelEl = container.querySelector('#session-mic-level');
      const barEl   = container.querySelector('#session-mic-bar');
      if (barEl) barEl.style.display = 'block';
      testBtn.innerHTML = icons.micOff(14);
      const animate = () => {
        analyser.getByteFrequencyData(buf);
        const pct = Math.min(100, Math.round((buf.reduce((s,v)=>s+v,0)/buf.length/96)*100));
        if (levelEl) levelEl.style.width = `${pct}%`;
        _micTestRaf = requestAnimationFrame(animate);
      };
      animate();
    } catch (e) {
      toast.error('Mic access denied', e.message);
    }
  });
}

/** Read current title from session config DOM (falls back to IndexedDB) */
export function getSessionTitle() {
  return document.getElementById('session-title')?.value?.trim() || '';
}

/** Read current camera/mic device IDs from session config DOM */
export function getSessionDevices() {
  return {
    cameraDevice: document.getElementById('session-camera')?.value || 'default',
    micDevice:    document.getElementById('session-mic')?.value    || 'default',
  };
}

/** Clean up mic test when navigating away */
export function cleanupSessionConfig() {
  _stopMicTest();
}
