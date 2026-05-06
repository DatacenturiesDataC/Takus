// Takus — Drive Panel
import { icons } from '../lib/icons.js';
import { GoogleAuth } from '../lib/google-auth.js';
import { isGoogleConfigured } from '../lib/config.js';
import { toast } from './toast.js';

export function renderDrivePanel(container) {
  const auth = GoogleAuth.getInstance();

  function render() {
    if (!isGoogleConfigured()) {
      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header"><h3>Google Drive</h3></div>
          <div class="empty-state" style="padding:var(--space-4);">
            ${icons.settings(28)}
            <p>Configure your Google Client ID to enable Drive uploads.</p>
          </div>
        </div>`;
      return;
    }

    const connected = auth.isConnected;
    const userEmail = auth.userEmail || '';
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header">
          <h3>Google Drive</h3>
          <span class="status-dot ${connected ? 'online' : 'offline'}"></span>
        </div>
        ${connected
          ? `<div style="display:flex;flex-direction:column;gap:var(--space-3);">
               <div style="display:flex;align-items:center;gap:var(--space-2);">
                 ${icons.check(16)}
                 <span style="font-size:var(--font-sm);">Connected — recordings will auto-upload</span>
               </div>
               ${userEmail ? `<div style="font-size:var(--font-xs);color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(userEmail)}">${icons.shield(12)} ${esc(userEmail)}</div>` : ''}
               <button class="btn btn-ghost btn-sm w-full" id="drive-disconnect">Disconnect</button>
             </div>`
          : `<div style="display:flex;flex-direction:column;gap:var(--space-3);">
               <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">Connect to auto-upload recordings to your Google Drive.</p>
               <button class="btn btn-primary btn-sm w-full" id="drive-connect">${icons.upload(14)} Connect Google Drive</button>
             </div>`
        }
      </div>`;

    if (connected) {
      container.querySelector('#drive-disconnect')?.addEventListener('click', () => { auth.disconnect(); toast.info('Disconnected from Google Drive'); });
    } else {
      container.querySelector('#drive-connect')?.addEventListener('click', async () => {
        try { await auth.connect(); } catch (e) { toast.error('Connection failed', e.message); }
      });
    }
  }

  render();
  auth.onChange(() => render());
}

function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
