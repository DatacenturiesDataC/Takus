// Takus — Header Component
import { icons } from '../lib/icons.js';
import { GoogleAuth } from '../lib/google-auth.js';
import { States } from '../lib/state-machine.js';

// Track the unsubscribe function so we don't stack listeners on every render.
let _unsubscribeAuth = null;

export function renderHeader(container, state) {
  const auth = GoogleAuth.getInstance();

  const isRecording = state === States.RECORDING;
  const isPaused = state === States.PAUSED;
  const showRecIndicator = isRecording || isPaused;

  container.innerHTML = `
    <header class="app-header" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;">
      <div style="display:flex;align-items:center;gap:var(--space-3);">
        <div class="logo" style="width:36px;height:36px;border-radius:var(--radius-md);background:var(--color-accent-gradient);display:flex;align-items:center;justify-content:center;">
          ${icons.video(20)}
        </div>
        <div>
          <h1 style="font-size:var(--font-xl);font-weight:var(--weight-bold);letter-spacing:-0.02em;">Takus</h1>
        </div>
      </div>
      <div id="header-status" style="display:flex;align-items:center;gap:var(--space-3);">
        ${showRecIndicator ? `
          <span class="badge badge-danger" style="animation:${isRecording ? 'blink 1.5s ease-in-out infinite' : 'none'};">
            <span class="status-dot recording"></span>
            <span id="header-rec-time">${isPaused ? 'Paused' : 'Recording'}</span>
          </span>
        ` : ''}
        <span id="drive-badge"></span>
      </div>
    </header>
  `;

  updateDriveBadge(auth.isConnected);

  // Unsubscribe previous listener to prevent stacking
  if (_unsubscribeAuth) _unsubscribeAuth();
  _unsubscribeAuth = auth.onChange((connected) => updateDriveBadge(connected));
}

function updateDriveBadge(connected) {
  const el = document.getElementById('drive-badge');
  if (!el) return;
  if (connected) {
    el.innerHTML = `<span class="badge badge-success"><span class="status-dot online"></span>Drive Connected</span>`;
  } else {
    el.innerHTML = `<span class="badge badge-neutral"><span class="status-dot offline"></span>Drive Offline</span>`;
  }
}

/**
 * Live-updates the recording timer in the header badge.
 * Called from app-shell's onTick callback.
 */
export function updateHeaderRecTime(elapsed) {
  const el = document.getElementById('header-rec-time');
  if (!el) return;
  const s = Math.floor(elapsed / 1000) % 60;
  const m = Math.floor(elapsed / 60000) % 60;
  const h = Math.floor(elapsed / 3600000);
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
