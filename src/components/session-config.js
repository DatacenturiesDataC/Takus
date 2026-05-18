// Takus — Session Config Bar (Type · Camera · Microphone · Test)
// Displayed inline between the recorder controls and history panel on the IDLE screen.
// Title removed (AI-generated post-entry). Templates → type selectors.
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { saveSetting, getSetting } from '../lib/storage.js';
import { toast } from './toast.js';
import { getTemplatesForType, getTemplate } from '../lib/content-templates.js';

let _micTestStream = null;
let _micTestRaf = null;
let _micTestCtx = null;

function _stopMicTest() {
  if (_micTestStream) { _micTestStream.getTracks().forEach(t => t.stop()); _micTestStream = null; }
  if (_micTestRaf) { cancelAnimationFrame(_micTestRaf); _micTestRaf = null; }
  if (_micTestCtx) { _micTestCtx.close().catch(() => {}); _micTestCtx = null; }
}

/**
 * Recording type → default config presets.
 * Camera defaults, quality presets, etc.
 */
const TYPE_PRESETS = {
  meeting:      { camera: true,  quality: '720p', label: 'Meeting',      accent: '#7c3aed', icon: (s) => icons.calendar(s) },
  screen:       { camera: false, quality: '1080p', label: 'Screen',      accent: '#0ea5e9', icon: (s) => icons.monitor(s) },
  presentation: { camera: true,  quality: '1080p', label: 'Presentation', accent: '#10b981', icon: (s) => icons.layout(s) },
  update:       { camera: true,  quality: '720p', label: 'Update',       accent: '#f59e0b', icon: (s) => icons.zap(s) },
};

const LAST_TYPE_KEY = 'takus_last_capture_type';
const LAST_TEMPLATE_KEY = 'takus_last_capture_template';

/**
 * Get the preset config for a type.
 * @param {string} typeId
 * @returns {{ camera: boolean, quality: string, label: string, accent: string, icon: function }}
 */
export function getTypePreset(typeId) {
  return TYPE_PRESETS[typeId] || TYPE_PRESETS.screen;
}

export async function renderSessionConfig(container, { isCameraActive = false, onTypeChange = null, onToggleCamera = null } = {}) {
  _stopMicTest();

  const [savedCamera, savedMic] = await Promise.all([
    getSetting('cameraDevice'),
    getSetting('micDevice'),
  ]);

  const lastType = localStorage.getItem(LAST_TYPE_KEY) || 'meeting';

  container.innerHTML = `
    <div class="card card-compact animate-in" style="padding:var(--space-3) var(--space-4);">

      <!-- Recording type selector chips -->
      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);">
        <span style="font-size:var(--font-xs);color:var(--color-text-disabled);flex-shrink:0;">Type:</span>
        ${Object.entries(TYPE_PRESETS).map(([id, preset]) => {
          const isActive = id === lastType;
          return `<button type="button" class="btn btn-sm type-chip ${isActive ? 'type-chip-active' : ''}"
            style="font-size:var(--font-xs);padding:3px 10px;border-radius:20px;
              display:inline-flex;align-items:center;gap:4px;
              background:${isActive ? preset.accent + '22' : 'transparent'};
              border:1px solid ${isActive ? preset.accent : 'rgba(255,255,255,0.1)'};
              color:${isActive ? preset.accent : 'var(--color-text-muted)'};
              transition:all 0.15s ease;"
            data-type="${id}"
            aria-pressed="${isActive}"
          >${preset.icon(11)} ${preset.label}</button>`;
        }).join('')}
      </div>

      <!-- Recording template picker -->
      <div id="template-picker" style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);min-height:24px;"></div>

      <div class="session-config-grid">

        <!-- Camera toggle + device -->
        <div class="input-group" style="margin:0;min-width:160px;">
          <label style="font-size:var(--font-xs);display:flex;align-items:center;gap:4px;">
            ${icons.camera(12)} Camera
            <button type="button" class="btn btn-ghost btn-sm" id="btn-session-cam-toggle"
              style="padding:1px 6px;font-size:10px;margin-left:auto;
                color:${isCameraActive ? 'var(--color-success)' : 'var(--color-text-disabled)'};"
              title="${isCameraActive ? 'Camera enabled' : 'Camera disabled'}"
              aria-label="${isCameraActive ? 'Disable camera' : 'Enable camera'}"
            >${isCameraActive ? 'On' : 'Off'}</button>
          </label>
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
            <button type="button" class="btn btn-ghost btn-icon btn-sm" id="btn-session-test-mic" title="Test microphone" aria-label="Test microphone">
              ${icons.mic(14)}
            </button>
          </div>
          <div id="session-mic-bar" style="display:none;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-top:4px;">
            <div id="session-mic-level" style="height:100%;width:0%;background:var(--color-primary);border-radius:2px;transition:width 0.05s linear;"></div>
          </div>
        </div>

      </div>
    </div>`;

  // ── Template picker ──────────────────────────────────────────────
  function _renderTemplates(typeId) {
    const picker = container.querySelector('#template-picker');
    if (!picker) return;

    const templates = getTemplatesForType(typeId);
    if (templates.length === 0) {
      picker.innerHTML = '';
      return;
    }

    const savedTemplate = localStorage.getItem(LAST_TEMPLATE_KEY) || '';

    picker.innerHTML = `
      <span style="font-size:10px;color:var(--color-text-disabled);flex-shrink:0;">Template:</span>
      <button class="btn btn-sm tmpl-chip ${!savedTemplate ? 'tmpl-active' : ''}" data-tmpl="" style="font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid ${!savedTemplate ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)'};background:${!savedTemplate ? 'rgba(124,58,237,0.12)' : 'transparent'};color:${!savedTemplate ? 'var(--color-primary-light)' : 'var(--color-text-muted)'};transition:all 0.15s;">None</button>
      ${templates.map(t => {
        const isActive = savedTemplate === t.id;
        return `<button class="btn btn-sm tmpl-chip ${isActive ? 'tmpl-active' : ''}" data-tmpl="${t.id}" title="${esc(t.description)}" style="font-size:10px;padding:2px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:3px;border:1px solid ${isActive ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)'};background:${isActive ? 'rgba(124,58,237,0.12)' : 'transparent'};color:${isActive ? 'var(--color-primary-light)' : 'var(--color-text-muted)'};transition:all 0.15s;">${t.icon} ${t.name}</button>`;
      }).join('')}
    `;

    picker.querySelectorAll('.tmpl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tmplId = chip.dataset.tmpl;
        localStorage.setItem(LAST_TEMPLATE_KEY, tmplId);
        _renderTemplates(typeId);
      });
    });
  }

  // ── Type chips ─────────────────────────────────────────────────────────────
  container.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const typeId = chip.dataset.type;
      localStorage.setItem(LAST_TYPE_KEY, typeId);
      localStorage.setItem(LAST_TEMPLATE_KEY, ''); // Reset template on type change

      // Update visual state
      container.querySelectorAll('.type-chip').forEach(c => {
        const cType = c.dataset.type;
        const preset = TYPE_PRESETS[cType];
        const isNow = cType === typeId;
        c.classList.toggle('type-chip-active', isNow);
        c.setAttribute('aria-pressed', isNow ? 'true' : 'false');
        c.style.background = isNow ? preset.accent + '22' : 'transparent';
        c.style.borderColor = isNow ? preset.accent : 'rgba(255,255,255,0.1)';
        c.style.color = isNow ? preset.accent : 'var(--color-text-muted)';
      });

      // Apply type-driven camera preset
      const preset = TYPE_PRESETS[typeId];
      if (preset && onTypeChange) onTypeChange(typeId, preset);

      // Update template picker
      _renderTemplates(typeId);
    });
  });

  // Initial template render
  _renderTemplates(lastType);

  // ── Camera toggle ─────────────────────────────────────────────────────────
  container.querySelector('#btn-session-cam-toggle')?.addEventListener('click', () => {
    if (onToggleCamera) onToggleCamera();
  });

  // ── Enumerate devices ─────────────────────────────────────────────────────
  const camSelect = container.querySelector('#session-camera');
  const micSelect = container.querySelector('#session-mic');

  camSelect.addEventListener('change', (e) => saveSetting('cameraDevice', e.target.value));
  micSelect.addEventListener('change', (e) => saveSetting('micDevice', e.target.value));

  try {
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

  // ── Mic level test ────────────────────────────────────────────────────────
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
      _micTestCtx = new AudioContext();
      const analyser = _micTestCtx.createAnalyser();
      analyser.fftSize = 256;
      _micTestCtx.createMediaStreamSource(_micTestStream).connect(analyser);
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
  // Title is AI-generated post-entry
  return '';
}

/** Read the currently selected content type */
export function getSelectedType() {
  return localStorage.getItem(LAST_TYPE_KEY) || 'meeting';
}

/** Read the currently selected entry template */
export function getSelectedTemplate() {
  const id = localStorage.getItem(LAST_TEMPLATE_KEY) || '';
  return id ? getTemplate(id) : null;
}

/** Clean up mic test when navigating away */
export function cleanupSessionConfig() {
  _stopMicTest();
}
