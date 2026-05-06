// Takus — Google Auth (GIS + token lifecycle)
import { getConfig, isGoogleConfigured } from './config.js';

let _instance = null;

export class GoogleAuth {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.expiresAt = null;
    this.userEmail = null;
    this.userName = null;
    this.userPhoto = null;
    this.isReady = false;
    this.isRestoring = false; // true while a silent re-auth is in flight
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

    // If the user was previously connected, attempt a silent token refresh.
    // GIS returns a token without a popup when the user still has an active
    // Google session and the app's scopes haven't changed.
    if (localStorage.getItem('takus_google_was_connected') === '1') {
      this.isRestoring = true;
      this._emit(); // let the header show a "Reconnecting" indicator
      // Defer one microtask so listeners registered after init() can react.
      Promise.resolve().then(() => {
        try { this.tokenClient.requestAccessToken({ prompt: '' }); } catch {}
      });
    }
  }

  async connect() {
    if (!this.isReady) await this.init();
    if (!this.tokenClient) throw new Error('Google API not initialized');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Google sign-in timed out — popup may be blocked'));
      }, 60_000);

      const cleanup = this.onChange((connected) => {
        clearTimeout(timeout);
        cleanup(); // unsubscribe
        if (connected) resolve();
        else reject(new Error('Google sign-in was cancelled'));
      });

      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  disconnect() {
    if (this.accessToken) {
      try { window.google.accounts.oauth2.revoke(this.accessToken, () => {}); } catch(e) {}
      window.gapi.client.setToken(null);
    }
    this.accessToken = null;
    this.expiresAt = null;
    this.userEmail = null;
    this.userName = null;
    this.userPhoto = null;
    this.isRestoring = false;
    try { localStorage.removeItem('takus_google_was_connected'); } catch {}
    this._emit();
  }

  async ensureValidToken() {
    if (!this.accessToken) throw new Error('Not connected');
    // Refresh if less than 5 minutes remain
    if (this.tokenTimeLeft < 300_000) {
      // Deduplicate: if a refresh is already in progress, reuse it
      if (!this._refreshPromise) {
        this._refreshPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            this._refreshPromise = null;
            reject(new Error('Token refresh timed out — popup may be blocked'));
          }, 15_000);

          const cleanup = this.onChange((connected) => {
            clearTimeout(timeout);
            cleanup(); // unsubscribe
            this._refreshPromise = null;
            if (connected) resolve();
            else reject(new Error('Token refresh failed'));
          });

          // Trigger the refresh — this opens the consent popup (or auto-grants if prompt='')
          this.tokenClient.requestAccessToken({ prompt: '' });
        });
      }

      await this._refreshPromise;

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
    this.isRestoring = false; // silent refresh attempt is complete regardless of outcome
    if (resp.error) {
      console.error('[Auth] Error:', resp.error);
      this.accessToken = null;
      this.expiresAt = null;
      // Access was revoked or session expired — clear the persistence flag so we
      // don't keep attempting a silent refresh on every future page load.
      try { localStorage.removeItem('takus_google_was_connected'); } catch {}
    } else {
      this.accessToken = resp.access_token;
      this.expiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
      window.gapi.client.setToken({ access_token: this.accessToken });

      // Persist the fact that the user is connected so we can silently restore
      // on the next page load without requiring a user gesture.
      try { localStorage.setItem('takus_google_was_connected', '1'); } catch {}

      // Pre-load APIs
      window.gapi.client.load('drive', 'v3').catch(() => {});
      window.gapi.client.load('calendar', 'v3').catch(() => {});

      // Fetch user profile in background for display
      this._fetchUserProfile();
    }
    this._emit();
  }

  async _fetchUserProfile() {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        this.userEmail = data.email || null;
        this.userName = data.name || null;
        this.userPhoto = data.picture || null;
        this._emit(); // Re-notify listeners with updated profile
      }
    } catch (e) {
      // Non-critical — profile display is best-effort
      console.warn('[Auth] Could not fetch user profile:', e.message);
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
