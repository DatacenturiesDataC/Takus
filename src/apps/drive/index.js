// Takus — Drive App (App Platform Wrapper)
// Wraps cloud storage (Google Drive, OneDrive) as a platform service.

import { createAppStub } from '../../lib/app-interface.js';
import { FILE_SELECTED } from '../../lib/events.js';

export const DriveApp = createAppStub({
  id: 'drive',
  name: 'Drive',
  version: '1.0.0',
  description: 'Cloud storage sync with Google Drive and Microsoft OneDrive. Your data, your cloud.',
  icon: '☁️',
  category: 'built-in',
  requires: [],

  async activate(platform) {
    this._platform = platform;
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'provider', label: 'Cloud Provider', type: 'select', defaultValue: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Google Drive', value: 'google' },
          { label: 'Microsoft OneDrive', value: 'microsoft' },
        ],
        description: 'Select your preferred cloud storage provider',
        syncable: false,
      },
    ];
  },

  getDefaultSettings() {
    return { provider: 'none' };
  },

  getNavItem() {
    return {
      id: 'drive',
      label: 'Drive',
      icon: 'cloud',
      section: 'system',
      order: 85,
    };
  },

  async renderPanel(container) {
    const { icons } = await import('../../lib/icons.js');
    const { esc } = await import('../../lib/utils.js');

    // Show loading skeleton
    container.innerHTML = `
      <div class="card card-compact" style="margin:var(--space-3);">
        <div class="card-header"><h2>${icons.cloud(16)} Cloud Sync</h2></div>
        <div style="padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);">
          <div style="height:14px;width:40%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
          <div style="height:12px;width:55%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
        </div>
      </div>`;

    // Load cloud status data
    let provider = 'none';
    let providerLabel = 'Not configured';
    let providerIcon = '—';
    let isConnected = false;
    let entryCount = 0;
    let syncedCount = 0;
    let lastSync = null;

    try {
      const config = await import('../../lib/config.js');
      const cfg = config.getConfig();
      const { getEntries } = await import('../../lib/storage.js');

      if (cfg.google?.clientId && cfg.google.clientId !== 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
        provider = 'google';
        providerLabel = 'Google Drive';
        providerIcon = '🟢';
        isConnected = true;
      } else if (cfg.microsoft?.clientId) {
        provider = 'microsoft';
        providerLabel = 'Microsoft OneDrive';
        providerIcon = '🔵';
        isConnected = true;
      }

      const entries = await getEntries().catch(() => []);
      entryCount = entries.length;
      syncedCount = entries.filter(e => e.cloudFileId || e.driveFileId).length;
      const syncDates = entries
        .filter(e => e.cloudFileId || e.driveFileId)
        .map(e => e.uploadedAt || e.syncedAt || e.date)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a));
      lastSync = syncDates[0] || null;
    } catch { /* non-critical */ }

    const lastSyncText = lastSync
      ? new Date(lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'Never';

    const statusColor = isConnected ? 'var(--color-success)' : 'var(--color-text-muted)';
    const statusText = isConnected ? 'Connected' : 'Not configured';
    const syncPct = entryCount > 0 ? Math.round((syncedCount / entryCount) * 100) : 0;

    container.innerHTML = `
      <div class="card card-compact" style="margin:var(--space-3);">
        <div class="card-header">
          <h2 style="display:flex;align-items:center;gap:var(--space-2);">${icons.cloud(16)} Cloud Sync</h2>
        </div>

        <div style="padding:0 var(--space-3) var(--space-3);display:flex;flex-direction:column;gap:var(--space-3);">
          <!-- Provider Status -->
          <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border-radius:var(--radius-md);background:var(--bg-hover);border:1px solid var(--border-default);">
            <div style="width:36px;height:36px;border-radius:var(--radius-md);background:${isConnected ? 'var(--accent-bg)' : 'var(--bg-hover)'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">
              ${providerIcon}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:var(--text-sm);font-weight:var(--weight-semibold);color:var(--text-primary);">${esc(providerLabel)}</div>
              <div style="font-size:var(--text-2xs);color:${statusColor};font-weight:var(--weight-medium);display:flex;align-items:center;gap:4px;">
                <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
                ${statusText}
              </div>
            </div>
          </div>

          <!-- Sync Stats -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);">
            <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--bg-hover);text-align:center;">
              <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--text-primary);">${syncedCount}/${entryCount}</div>
              <div style="font-size:var(--text-2xs);color:var(--text-muted);">Entries synced</div>
            </div>
            <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--bg-hover);text-align:center;">
              <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--text-primary);">${syncPct}%</div>
              <div style="font-size:var(--text-2xs);color:var(--text-muted);">Coverage</div>
            </div>
          </div>

          <!-- Last Sync -->
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:var(--text-xs);color:var(--text-secondary);">
            <span>Last synced</span>
            <span style="font-weight:var(--weight-medium);">${esc(lastSyncText)}</span>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:var(--space-2);">
            ${isConnected ? `
              <button class="btn btn-outline btn-sm" id="drive-sync-now" style="flex:1;gap:var(--space-1);">
                ${icons.refresh(12)} Sync Now
              </button>
            ` : ''}
            <button class="btn btn-outline btn-sm" id="drive-configure" style="flex:1;gap:var(--space-1);">
              ${icons.settings(12)} ${isConnected ? 'Settings' : 'Configure'}
            </button>
          </div>
        </div>
      </div>`;

    // Event handlers
    container.querySelector('#drive-configure')?.addEventListener('click', () => {
      // Navigate to settings tab
      const settingsBtn = document.querySelector('[data-sidebar-id="settings"]');
      if (settingsBtn) settingsBtn.click();
      else {
        document.querySelectorAll('.tab-panel').forEach(el => {
          el.style.display = el.dataset.tabPanel === 'settings' ? '' : 'none';
        });
      }
    });

    container.querySelector('#drive-sync-now')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner spinner-xs-11"></div> Syncing…`;
      try {
        const { syncSettings } = await import('../../lib/settings-store.js');
        await syncSettings();
        const { toast } = await import('../../components/toast.js');
        toast.success('Sync complete', 'Settings synced to cloud.');
      } catch (err) {
        const { toast } = await import('../../components/toast.js');
        toast.error('Sync failed', err.message);
      }
      btn.disabled = false;
      btn.innerHTML = `${icons.refresh(12)} Sync Now`;
    });
  },

  getNodeTypes() { return []; },
  getEdgeTypes() { return []; },

  getStepTypes() {
    return [
      { type: 'cloud_sync', handler: async (ctx) => ctx, autoApprove: true },
      { type: 'cloud_upload', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  getQuickActions() {
    return [
      {
        id: 'upload',
        label: 'Upload',
        icon: 'upload',
        primary: false,
        order: 10,  // After primary actions (Record is order 1)
        handler: () => this._pickAndValidateFile(),
      },
    ];
  },

  /**
   * Open a file picker, validate the selected file, and dispatch
   * a 'takus:file-selected' domain event for the platform to handle.
   * File selection + validation is a Drive concern.
   * State transitions are the platform's concern.
   */
  async _pickAndValidateFile() {
    const ACCEPT = 'video/webm,video/mp4,video/quicktime,audio/mp4,audio/wav,audio/mpeg,audio/webm,.webm,.mp4,.m4a,.wav,.mp3,.mov';
    const VALID_EXTS = ['webm', 'mp4', 'm4a', 'wav', 'mp3', 'mov'];
    const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.style.display = 'none';
    document.body.appendChild(input);

    const file = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] || null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
    input.remove();

    if (!file) return;

    // Validate size
    if (file.size > MAX_SIZE) {
      const { toast } = await import('../../components/toast.js');
      toast.error('File too large', 'Maximum upload size is 2 GB.');
      return;
    }

    // Validate type
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!VALID_EXTS.includes(ext)) {
      const { toast } = await import('../../components/toast.js');
      toast.error('Unsupported format', `Accepted formats: ${VALID_EXTS.join(', ')}`);
      return;
    }

    // File is valid — dispatch domain event for the platform to handle
    document.dispatchEvent(new CustomEvent(FILE_SELECTED, { detail: { file } }));
  },

  getAutoRunPresets() {
    return [
      {
        field: 'source', operator: 'equals', value: 'upload',
        label: 'Auto-run: uploaded files',
        description: 'Process uploaded entries immediately (skip inbox)',
      },
    ];
  },

  canProduceInboxItems: false,
});

export default DriveApp;
