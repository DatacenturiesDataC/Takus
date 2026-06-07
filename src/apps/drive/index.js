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
    try {
    const { icons } = await import('../../lib/icons.js');
    const { esc } = await import('../../lib/utils.js');

    // Show loading skeleton
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header"><h2>${icons.cloud(16)} Cloud Sync</h2></div>
        <div class="skeleton-list" style="padding:var(--space-3);">
          <div class="home-skeleton-bar" style="width:40%;"></div>
          <div class="home-skeleton-bar" style="width:55%;"></div>
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

    const statusColor = isConnected ? 'var(--color-success)' : 'var(--text-muted)';
    const statusText = isConnected ? 'Connected' : 'Not configured';
    const syncPct = entryCount > 0 ? Math.round((syncedCount / entryCount) * 100) : 0;

    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header">
          <h2 style="display:flex;align-items:center;gap:var(--space-2);">${icons.cloud(16)} Cloud Sync</h2>
        </div>

        <div class="drive-panel-body">
          <!-- Provider Status -->
          <div class="drive-provider-card">
            <div class="drive-provider-icon${isConnected ? ' drive-provider-icon--active' : ' drive-provider-icon--inactive'}">
              ${providerIcon}
            </div>
            <div class="drive-provider-info">
              <div class="drive-provider-name">${esc(providerLabel)}</div>
              <div class="drive-status-row" style="color:${statusColor};">
                <span class="drive-status-dot" style="background:${statusColor};"></span>
                ${statusText}
              </div>
            </div>
          </div>

          <!-- Sync Stats -->
          <div class="drive-sync-grid">
            <div class="drive-sync-stat">
              <div class="drive-sync-value">${syncedCount}/${entryCount}</div>
              <div class="drive-sync-label">Entries synced</div>
            </div>
            <div class="drive-sync-stat">
              <div class="drive-sync-value">${syncPct}%</div>
              <div class="drive-sync-label">Coverage</div>
            </div>
          </div>

          <!-- Last Sync -->
          <div class="drive-last-sync">
            <span>Last synced</span>
            <span class="drive-last-sync-value">${esc(lastSyncText)}</span>
          </div>

          <!-- Actions -->
          <div class="drive-actions">
            ${isConnected ? `
              <button class="btn btn-outline btn-sm" id="drive-sync-now">
                ${icons.refresh(12)} Sync Now
              </button>
            ` : ''}
            <button class="btn btn-outline btn-sm" id="drive-configure">
              ${icons.settings(12)} ${isConnected ? 'Settings' : 'Configure'}
            </button>
          </div>
        </div>
      </div>`;

    // Event handlers
    container.querySelector('#drive-configure')?.addEventListener('click', async () => {
      const { NAVIGATE } = await import('../../lib/events.js');
      document.dispatchEvent(new CustomEvent(NAVIGATE, { detail: { tab: 'settings' } }));
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
    } catch (e) {
      console.error('[DriveApp] renderPanel failed:', e);
      container.innerHTML = `<div class="card card-compact"><p class="text-sm text-muted" style="padding:var(--space-3);">Could not load Drive panel.</p></div>`;
    }
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


