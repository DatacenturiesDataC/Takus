// Takus — Microsoft Auth (MSAL.js + token lifecycle)
// Mirrors GoogleAuth interface for the provider abstraction.

import { getConfig, isMicrosoftConfigured } from './config.js';

const MSAL_CDN = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me';

let _instance = null;

export class MicrosoftAuth {
  constructor() {
    this.msalApp = null;
    this.accessToken = null;
    this.expiresAt = null;
    this.userEmail = null;
    this.userName = null;
    this.userPhoto = null;
    this.isReady = false;
    this._listeners = new Set();
    this._initPromise = null;
    this._account = null;
  }

  static getInstance() {
    if (!_instance) _instance = new MicrosoftAuth();
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
    if (!isMicrosoftConfigured()) { console.warn('[MS Auth] Microsoft not configured'); return; }
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    await this._loadScript(MSAL_CDN);

    if (!window.msal?.PublicClientApplication) {
      throw new Error('MSAL library failed to load');
    }

    const cfg = getConfig();
    const msalConfig = {
      auth: {
        clientId: cfg.microsoft.clientId,
        authority: cfg.microsoft.authority || 'https://login.microsoftonline.com/common',
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    };

    this.msalApp = new window.msal.PublicClientApplication(msalConfig);
    await this.msalApp.initialize();

    // Check for existing sessions
    const accounts = this.msalApp.getAllAccounts();
    if (accounts.length > 0) {
      this._account = accounts[0];
      try {
        await this._acquireTokenSilent();
      } catch {
        // Silent acquisition failed — user will need to re-authenticate
        this._account = null;
      }
    }

    this.isReady = true;
  }

  get _scopes() {
    return ['User.Read', 'Files.ReadWrite', 'Calendars.ReadWrite', 'Notes.Create', 'Notes.ReadWrite'];
  }

  async connect() {
    if (!this.isReady) await this.init();
    if (!this.msalApp) throw new Error('Microsoft Auth not initialized');

    try {
      const loginResp = await this.msalApp.loginPopup({
        scopes: this._scopes,
        prompt: 'select_account',
      });

      this._account = loginResp.account;
      this.accessToken = loginResp.accessToken;
      this.expiresAt = loginResp.expiresOn ? loginResp.expiresOn.getTime() : Date.now() + 3600_000;

      // Fetch profile
      this._fetchUserProfile();
      this._emit();
    } catch (e) {
      console.error('[MS Auth] Login failed:', e);
      throw new Error(e.errorMessage || e.message || 'Microsoft login failed');
    }
  }

  disconnect() {
    this.accessToken = null;
    this.expiresAt = null;
    this.userEmail = null;
    this.userName = null;
    this.userPhoto = null;
    this._account = null;
    // Clear MSAL cache
    if (this.msalApp) {
      const accounts = this.msalApp.getAllAccounts();
      for (const acct of accounts) {
        this.msalApp.logout({ account: acct, onRedirectNavigate: () => false }).catch(() => {});
      }
    }
    this._emit();
  }

  async ensureValidToken() {
    if (!this._account) throw new Error('Not connected to Microsoft');

    // Refresh if less than 5 minutes remain
    if (this.tokenTimeLeft < 300_000) {
      await this._acquireTokenSilent();
    }

    if (!this.isConnected) throw new Error('Microsoft token refresh failed');
    return this.accessToken;
  }

  async _acquireTokenSilent() {
    try {
      const resp = await this.msalApp.acquireTokenSilent({
        scopes: this._scopes,
        account: this._account,
      });
      this.accessToken = resp.accessToken;
      this.expiresAt = resp.expiresOn ? resp.expiresOn.getTime() : Date.now() + 3600_000;
      this._emit();
    } catch (e) {
      // Silent failed — try popup
      console.warn('[MS Auth] Silent token acquisition failed, trying popup:', e.message);
      try {
        const resp = await this.msalApp.acquireTokenPopup({
          scopes: this._scopes,
          account: this._account,
        });
        this.accessToken = resp.accessToken;
        this.expiresAt = resp.expiresOn ? resp.expiresOn.getTime() : Date.now() + 3600_000;
        this._emit();
      } catch (popupErr) {
        this.accessToken = null;
        this.expiresAt = null;
        this._emit();
        throw new Error(`Token refresh failed: ${popupErr.message}`);
      }
    }
  }

  async _fetchUserProfile() {
    try {
      const resp = await fetch(GRAPH_ME, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        this.userEmail = data.mail || data.userPrincipalName || null;
        this.userName = data.displayName || null;
        // Photo requires separate endpoint — best-effort
        this._fetchUserPhoto();
        this._emit();
      }
    } catch (e) {
      console.warn('[MS Auth] Could not fetch profile:', e.message);
    }
  }

  async _fetchUserPhoto() {
    try {
      const resp = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (resp.ok) {
        const blob = await resp.blob();
        this.userPhoto = URL.createObjectURL(blob);
        this._emit();
      }
    } catch {
      // Photo is optional — many accounts don't have one
    }
  }

  _loadScript(src) {
    if (window.msal?.PublicClientApplication) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Failed to load MSAL: ${src}`));
      document.head.appendChild(el);
    });
  }
}
