// Takus — Google Auth (GIS + token lifecycle)
import { getConfig, isGoogleConfigured } from './config.js';

let _instance = null;

export class GoogleAuth {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.expiresAt = null;
    this.userEmail = null;
    this.isReady = false;
    this._listeners = new Set();
    this._initPromise = null;
  }

  static getInstance() {
    if (!_instance) _instance = new GoogleAuth();
    return _instance;
  }

  get isConnected() { return !!this.accessToken && Date.now() < (this.expiresAt || 0); }
  get tokenTimeLeft() { return this.expiresAt ? Math.max(0, this.expiresAt - Date.now()) : 0; }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() { for (const fn of this._listeners) { try { fn(this.isConnected); } catch(e) { console.error(e); } } }

  async init() {
    if (this._initPromise) return this._initPromise;
    if (!isGoogleConfigured()) { console.warn('[Auth] Google not configured'); return; }

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    // Load scripts
    await Promise.all([this._loadScript('https://accounts.google.com/gsi/client'), this._loadScript('https://apis.google.com/js/api.js')]);

    // Load gapi client
    await new Promise((res, rej) => { window.gapi.load('client', { callback: res, onerror: rej }); });
    await window.gapi.client.init({});

    const cfg = getConfig();
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.google.clientId,
      scope: cfg.google.scopes.join(' '),
      callback: (resp) => this._handleTokenResponse(resp),
    });

    this.isReady = true;
  }

  async connect() {
    if (!this.isReady) await this.init();
    if (!this.tokenClient) throw new Error('Google API not initialized');
    this.tokenClient.requestAccessToken({ prompt: '' });
  }

  disconnect() {
    if (this.accessToken) {
      try { window.google.accounts.oauth2.revoke(this.accessToken, () => {}); } catch(e) {}
      window.gapi.client.setToken(null);
    }
    this.accessToken = null;
    this.expiresAt = null;
    this.userEmail = null;
    this._emit();
  }

  async ensureValidToken() {
    if (!this.accessToken) throw new Error('Not connected');
    // Refresh if less than 5 minutes remain
    if (this.tokenTimeLeft < 300_000) {
      // Wait for the actual token callback rather than a hardcoded delay.
      // The _handleTokenResponse callback will resolve or reject this promise.
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Token refresh timed out — popup may be blocked'));
        }, 15_000);

        const cleanup = this.onChange((connected) => {
          clearTimeout(timeout);
          cleanup(); // unsubscribe
          if (connected) resolve();
          else reject(new Error('Token refresh failed'));
        });

        // Trigger the refresh — this opens the consent popup (or auto-grants if prompt='')
        this.tokenClient.requestAccessToken({ prompt: '' });
      });

      if (!this.isConnected) throw new Error('Token refresh failed');
    }
    return this.accessToken;
  }

  async loadAPI(api, version) {
    await this.ensureValidToken();
    if (!window.gapi.client[api]) {
      await window.gapi.client.load(api, version);
    }
  }

  _handleTokenResponse(resp) {
    if (resp.error) {
      console.error('[Auth] Error:', resp.error);
      this.accessToken = null;
      this.expiresAt = null;
    } else {
      this.accessToken = resp.access_token;
      this.expiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
      window.gapi.client.setToken({ access_token: this.accessToken });

      // Pre-load APIs
      window.gapi.client.load('drive', 'v3').catch(() => {});
      window.gapi.client.load('calendar', 'v3').catch(() => {});

      // Fetch user email in background for display
      this._fetchUserEmail();
    }
    this._emit();
  }

  async _fetchUserEmail() {
    try {
      const resp = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${this.accessToken}`);
      if (resp.ok) {
        const data = await resp.json();
        this.userEmail = data.email || null;
        this._emit(); // Re-notify listeners with updated email
      }
    } catch (e) {
      // Non-critical — email display is best-effort
      console.warn('[Auth] Could not fetch user email:', e.message);
    }
  }

  _loadScript(src) {
    if (src.includes('gsi/client') && window.google?.accounts) return Promise.resolve();
    if (src.includes('api.js') && window.gapi) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(el);
    });
  }
}
