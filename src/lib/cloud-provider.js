// Takus — Cloud Provider Abstraction Layer
//
// Wraps Google and Microsoft integrations behind a unified interface.
// Only ONE provider can be active at a time for uploads/calendar/docs.

import { GoogleAuth } from './google-auth.js';
import { GoogleDrive } from './google-drive.js';
import { GoogleCalendar } from './google-calendar.js';
import { GoogleDocs } from './google-docs.js';
import { MicrosoftAuth } from './microsoft-auth.js';
import { MicrosoftOneDrive } from './microsoft-onedrive.js';
import { MicrosoftCalendar } from './microsoft-calendar.js';
import { MicrosoftOneNote } from './microsoft-onenote.js';

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

  /** Wire up auth listeners to auto-detect active provider */
  _init() {
    this._unsubGoogle = this.google.auth.onChange((connected) => {
      if (connected) {
        this._activeId = 'google';
        try { localStorage.setItem('takus_last_provider', 'google'); } catch {}
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
}
