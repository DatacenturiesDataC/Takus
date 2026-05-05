// Takus — Header Component
import { icons } from '../lib/icons.js';
import { GoogleAuth } from '../lib/google-auth.js';

export function renderHeader(container) {
  const auth = GoogleAuth.getInstance();

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
        <span id="drive-badge"></span>
      </div>
    </header>
  `;

  updateDriveBadge(auth.isConnected);
  auth.onChange((connected) => updateDriveBadge(connected));
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
