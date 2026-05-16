// Takus — Cloud Provider Abstraction Layer
//
// Wraps Google and Microsoft integrations behind a unified interface.
// Only ONE provider can be active at a time for uploads/calendar/docs.

import { GoogleAuth } from './google-auth.js';
import { GoogleDrive } from './google-drive.js';
import { VAULT_SYNC_COMPLETE, CLOUD_CONNECTED } from './events.js';
import { GoogleCalendar } from './google-calendar.js';
import { GoogleDocs } from './google-docs.js';
import { MicrosoftAuth } from './microsoft-auth.js';
import { MicrosoftOneDrive } from './microsoft-onedrive.js';
import { MicrosoftCalendar } from './microsoft-calendar.js';
import { MicrosoftOneNote } from './microsoft-onenote.js';
import { getRecordings, saveRecording, saveVaultSync, getAllVaultSync } from './storage.js';

import { notifyEphemeral } from './notification-manager.js';

let _manager = null;

// ---------- Provider adapters ----------

class GoogleProvider {
  constructor() {
    this.id = 'google';
    this.name = 'Google';
    this.auth = GoogleAuth.getInstance();
    this.storage = new GoogleDrive();
    this.calendar = new GoogleCalendar();
    this.notes = new GoogleDocs();
  }
}

class MicrosoftProvider {
  constructor() {
    this.id = 'microsoft';
    this.name = 'Microsoft';
    this.auth = MicrosoftAuth.getInstance();
    this.storage = new MicrosoftOneDrive();
    this.calendar = new MicrosoftCalendar();
    this.notes = new MicrosoftOneNote();
  }
}

// ---------- Manager ----------

export class CloudProviderManager {
  constructor() {
    this._activeId = null;
    this.google = new GoogleProvider();
    this.microsoft = new MicrosoftProvider();
    this._listeners = new Set();
    this._unsubGoogle = null;
    this._unsubMicrosoft = null;
    this._syncInProgress = false;
    this._init();
  }

  static getInstance() {
    if (!_manager) _manager = new CloudProviderManager();
    return _manager;
  }

  /** Currently active provider id: 'google' | 'microsoft' | null */
  get activeId() { return this._activeId; }

  /** Currently active provider object or null */
  getProvider() {
    if (this._activeId === 'google') return this.google;
    if (this._activeId === 'microsoft') return this.microsoft;
    return null;
  }

  /** Get a provider by id regardless of active state */
  getProviderById(id) {
    if (id === 'google') return this.google;
    if (id === 'microsoft') return this.microsoft;
    return null;
  }

  /** Whether any provider is connected */
  get isConnected() {
    return this.google.auth.isConnected || this.microsoft.auth.isConnected;
  }

  /** Active auth object for quick access */
  get activeAuth() {
    return this.getProvider()?.auth || null;
  }

  /** Connect a specific provider. Auto-disconnects the other. */
  async connect(providerId) {
    const provider = this.getProviderById(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    // Disconnect the other provider first
    const otherId = providerId === 'google' ? 'microsoft' : 'google';
    const other = this.getProviderById(otherId);
    if (other.auth.isConnected) {
      other.auth.disconnect();
    }

    await provider.auth.connect();
    // The onChange listener in _init() will handle setting _activeId
  }

  /** Disconnect a specific provider */
  disconnect(providerId) {
    const provider = this.getProviderById(providerId);
    if (!provider) return;
    // auth.disconnect() triggers onChange in _init() which updates _activeId and emits.
    provider.auth.disconnect();
  }

  /** Disconnect all providers */
  disconnectAll() {
    if (this.google.auth.isConnected) this.google.auth.disconnect();
    if (this.microsoft.auth.isConnected) this.microsoft.auth.disconnect();
    this._activeId = null;
    this._emit();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) {
      try { fn(this._activeId); } catch (e) { console.error(e); }
    }
  }

  // ── Phase 9c: Vault Sync on Init ─────────────────────────────────────────

  /**
   * Scan the cloud drive for existing recordings and merge into local IndexedDB.
   * Called once after authentication is established.
   * Non-blocking — runs in the background and doesn't fail the app on error.
   */
  async syncVaultToLocal() {
    if (this._syncInProgress) return;
    this._syncInProgress = true;

    try {
      const provider = this.getProvider();
      if (!provider) return;

      const storage = provider.storage;
      if (typeof storage.listFolderContents !== 'function') return;

      // 1. List monthly bucket folders: Takus/recordings/YYYY-MM/
      let monthFolders;
      if (provider.id === 'google') {
        const recordingsId = await storage.ensureFolderPath('Takus/recordings');
        monthFolders = await storage.listFolderContents(recordingsId);
      } else {
        monthFolders = await storage.listFolderContents('Takus/recordings');
      }

      if (!monthFolders?.length) return;

      // 2. Get local state
      const [localRecordings, localVaultSync] = await Promise.all([
        getRecordings(),
        getAllVaultSync(),
      ]);
      const localIds = new Set(localRecordings.map(r => r.id));
      const syncedIds = new Set(localVaultSync.map(v => v.id));

      let synced = 0;

      // 3. For each monthly bucket, list recording folders
      for (const monthFolder of monthFolders) {
        // Skip non-folders
        if (provider.id === 'google' && monthFolder.mimeType !== 'application/vnd.google-apps.folder') continue;
        if (provider.id === 'microsoft' && !monthFolder.folder) continue;

        let recordingFolders;
        if (provider.id === 'google') {
          recordingFolders = await storage.listFolderContents(monthFolder.id);
        } else {
          recordingFolders = await storage.listFolderContents(`Takus/recordings/${monthFolder.name}`);
        }

        for (const recFolder of recordingFolders) {
          // Skip non-folders
          if (provider.id === 'google' && recFolder.mimeType !== 'application/vnd.google-apps.folder') continue;
          if (provider.id === 'microsoft' && !recFolder.folder) continue;

          const recordingId = recFolder.name;

          // Skip if already in local DB
          if (localIds.has(recordingId) && syncedIds.has(recordingId)) continue;

          // 4. Try to read metadata.json
          try {
            let metadataContent;
            if (provider.id === 'google') {
              const files = await storage.listFolderContents(recFolder.id);
              const metaFile = files.find(f => f.name === 'metadata.json');
              if (!metaFile) continue;
              metadataContent = await storage.downloadFileContent(metaFile.id);
            } else {
              metadataContent = await storage.downloadFileContent(
                `Takus/recordings/${monthFolder.name}/${recordingId}/metadata.json`
              );
            }

            const metadata = JSON.parse(metadataContent);

            // 5. If recording isn't in local DB, add it
            if (!localIds.has(recordingId)) {
              const entry = {
                id: metadata.id || recordingId,
                title: metadata.title || 'Synced Recording',
                date: metadata.date || Date.now(),
                duration: metadata.duration || 0,
                size: metadata.size || 0,
                type: metadata.type || 'screen',
                aiProvider: metadata.aiProvider || null,
                participants: metadata.participants || [],
                driveLink: null, // Video isn't directly linkable from metadata
                driveFolderId: recFolder.id || null,
              };

              // Try to populate AI artefacts
              try {
                if (provider.id === 'google') {
                  const files = await storage.listFolderContents(recFolder.id);
                  const summaryFile = files.find(f => f.name === 'summary.md');
                  const vttFile = files.find(f => f.name === 'transcript.vtt');
                  const tasksFile = files.find(f => f.name === 'tasks.json');
                  if (summaryFile) entry.aiSummary = await storage.downloadFileContent(summaryFile.id);
                  if (vttFile) entry.aiVtt = await storage.downloadFileContent(vttFile.id);
                  if (tasksFile) {
                    try {
                      const tasksContent = await storage.downloadFileContent(tasksFile.id);
                      const taskData = JSON.parse(tasksContent);
                      entry.tasks = { takusTasks: taskData.takusTasks || [], meTasks: taskData.meTasks || [] };
                    } catch { /* tasks.json parse failed — skip */ }
                  }
                } else {
                  try { entry.aiSummary = await storage.downloadFileContent(`Takus/recordings/${monthFolder.name}/${recordingId}/summary.md`); } catch {}
                  try { entry.aiVtt = await storage.downloadFileContent(`Takus/recordings/${monthFolder.name}/${recordingId}/transcript.vtt`); } catch {}
                  try {
                    const tasksContent = await storage.downloadFileContent(`Takus/recordings/${monthFolder.name}/${recordingId}/tasks.json`);
                    const taskData = JSON.parse(tasksContent);
                    entry.tasks = { takusTasks: taskData.takusTasks || [], meTasks: taskData.meTasks || [] };
                  } catch { /* tasks.json not found or invalid — skip */ }
                }
              } catch {}

              await saveRecording(entry).catch(e => console.warn('[Sync] Save failed:', e.message));
              localIds.add(recordingId);
              synced++;
            }

            // Update vault sync state
            if (!syncedIds.has(recordingId)) {
              await saveVaultSync({
                id: recordingId,
                driveFolderId: provider.id === 'google' ? recFolder.id : recordingId,
                drivePackageUploaded: true,
                archiveStatus: metadata.archiveStatus || 'active',
                pinned: false,
                legalHold: false,
                lastSyncDate: Date.now(),
              });
            }
          } catch (e) {
            console.warn(`[Vault Sync] Failed to sync recording ${recordingId}:`, e.message);
          }
        }
      }

      if (synced > 0) {
        console.info(`[Vault Sync] Synced ${synced} recording(s) from cloud.`);
        notifyEphemeral('Cloud sync', `Imported ${synced} recording${synced > 1 ? 's' : ''} from your cloud drive.`, 'success');
        // Re-render the history panel to show newly imported recordings
        window.dispatchEvent(new CustomEvent(VAULT_SYNC_COMPLETE, { detail: { synced } }));
      }

      // Auto-restore settings from cloud — emits an event that settings-panel.js listens for.
      // This avoids a circular lib→component import dependency.
      window.dispatchEvent(new CustomEvent(CLOUD_CONNECTED, { detail: { synced } }));
    } catch (e) {
      console.warn('[Vault Sync] Background sync failed:', e.message);
    } finally {
      this._syncInProgress = false;
    }
  }

  /** Wire up auth listeners to auto-detect active provider */
  _init() {
    this._unsubGoogle = this.google.auth.onChange((connected) => {
      if (connected) {
        this._activeId = 'google';
        try { localStorage.setItem('takus_last_provider', 'google'); } catch {}
        // Phase 9c: Trigger background vault sync
        this.syncVaultToLocal().catch(() => {});
      } else if (this._activeId === 'google') {
        // Fall back to the other provider if still connected
        this._activeId = this.microsoft.auth.isConnected ? 'microsoft' : null;
        if (!this._activeId) try { localStorage.removeItem('takus_last_provider'); } catch {}
      }
      this._emit();
    });

    this._unsubMicrosoft = this.microsoft.auth.onChange((connected) => {
      if (connected) {
        this._activeId = 'microsoft';
        try { localStorage.setItem('takus_last_provider', 'microsoft'); } catch {}
        // Phase 9c: Trigger background vault sync
        this.syncVaultToLocal().catch(() => {});
      } else if (this._activeId === 'microsoft') {
        // Fall back to the other provider if still connected
        this._activeId = this.google.auth.isConnected ? 'google' : null;
        if (!this._activeId) try { localStorage.removeItem('takus_last_provider'); } catch {}
      }
      this._emit();
    });

    // Check initial state
    if (this.google.auth.isConnected) this._activeId = 'google';
    else if (this.microsoft.auth.isConnected) this._activeId = 'microsoft';

    // Cross-tab sync — when another tab connects or disconnects, re-emit so
    // the header and any UI listening on onChange() stays in sync.
    window.addEventListener('storage', (e) => {
      if (e.key === 'takus_last_provider' || e.key === 'takus_google_was_connected') {
        this._emit();
      }
    });
  }

  /**
   * Rebuild local IDB recordings from the cloud vault.
   * Used to recover from IDB corruption or data loss.
   * Clears all local recordings then re-imports from the cloud drive metadata.
   *
   * @returns {Promise<{success: boolean, imported: number, error?: string}>}
   */
  async rebuildFromCloud() {
    const provider = this.getProvider();
    if (!provider) {
      return { success: false, imported: 0, error: 'No cloud provider connected' };
    }

    try {
      const { clearAllRecordings, getRecordings } = await import('./storage.js');

      // Count current records for logging
      const before = await getRecordings();
      console.info(`[Rebuild] Starting rebuild from cloud. ${before.length} local records will be cleared.`);

      // Clear all local data
      await clearAllRecordings();

      // Force a full vault sync (which will re-import everything from cloud)
      this._syncInProgress = false; // Reset lock
      await this.syncVaultToLocal();

      // Count what was imported
      const after = await getRecordings();
      const imported = after.length;

      console.info(`[Rebuild] Complete. Imported ${imported} recordings from cloud.`);
      notifyEphemeral('Rebuild complete', `Imported ${imported} recording${imported !== 1 ? 's' : ''} from cloud storage.`, 'success');

      return { success: true, imported };
    } catch (e) {
      console.error('[Rebuild] Failed:', e.message);
      return { success: false, imported: 0, error: e.message };
    }
  }
}

