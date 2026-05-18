// Takus — Google Auth Tests
// Tests the pure-logic parts of GoogleAuth — state management, token lifecycle,
// listeners. Does NOT test actual OAuth flows or script loading.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ google: { clientId: 'test', scopes: ['email'] } })),
  isGoogleConfigured: vi.fn(() => false), // prevent actual init
}));

import { GoogleAuth } from '../google-auth.js';

describe('GoogleAuth', () => {
  let auth;

  beforeEach(() => {
    auth = new GoogleAuth();
  });

  describe('initial state', () => {
    it('starts disconnected', () => {
      expect(auth.isConnected).toBe(false);
      expect(auth.accessToken).toBeNull();
      expect(auth.expiresAt).toBeNull();
      expect(auth.isReady).toBe(false);
    });

    it('tokenTimeLeft is 0 when no token', () => {
      expect(auth.tokenTimeLeft).toBe(0);
    });
  });

  describe('singleton', () => {
    it('getInstance returns consistent instance', () => {
      const a = GoogleAuth.getInstance();
      const b = GoogleAuth.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('isConnected', () => {
    it('returns true when token exists and not expired', () => {
      auth.accessToken = 'test-token';
      auth.expiresAt = Date.now() + 60_000;
      expect(auth.isConnected).toBe(true);
    });

    it('returns false when token is expired', () => {
      auth.accessToken = 'test-token';
      auth.expiresAt = Date.now() - 1000;
      expect(auth.isConnected).toBe(false);
    });

    it('returns false when no token', () => {
      auth.accessToken = null;
      expect(auth.isConnected).toBe(false);
    });
  });

  describe('tokenTimeLeft', () => {
    it('returns remaining milliseconds', () => {
      auth.expiresAt = Date.now() + 30_000;
      const left = auth.tokenTimeLeft;
      expect(left).toBeGreaterThan(29_000);
      expect(left).toBeLessThanOrEqual(30_000);
    });

    it('returns 0 for expired token', () => {
      auth.expiresAt = Date.now() - 5000;
      expect(auth.tokenTimeLeft).toBe(0);
    });
  });

  describe('onChange', () => {
    it('registers and calls listeners', () => {
      const listener = vi.fn();
      auth.onChange(listener);
      auth._emit();
      expect(listener).toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const listener = vi.fn();
      const unsub = auth.onChange(listener);
      unsub();
      auth._emit();
      expect(listener).not.toHaveBeenCalled();
    });

    it('handles listener errors gracefully', () => {
      const badListener = vi.fn(() => { throw new Error('boom'); });
      const goodListener = vi.fn();
      auth.onChange(badListener);
      auth.onChange(goodListener);
      auth._emit();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('clears all auth state', () => {
      // Mock the Google APIs that disconnect() calls
      window.gapi = { client: { setToken: vi.fn() } };
      window.google = { accounts: { oauth2: { revoke: vi.fn() } } };

      auth.accessToken = 'token';
      auth.expiresAt = Date.now() + 60000;
      auth.userEmail = 'test@test.com';
      auth.userName = 'Test';
      auth.userPhoto = 'https://photo.url';
      auth.isRestoring = true;

      auth.disconnect();

      expect(auth.accessToken).toBeNull();
      expect(auth.expiresAt).toBeNull();
      expect(auth.userEmail).toBeNull();
      expect(auth.userName).toBeNull();
      expect(auth.userPhoto).toBeNull();
      expect(auth.isRestoring).toBe(false);
    });

    it('emits change event on disconnect', () => {
      const listener = vi.fn();
      auth.onChange(listener);
      auth.disconnect();
      expect(listener).toHaveBeenCalledWith(false);
    });
  });

  describe('_handleTokenResponse', () => {
    it('sets token on success', () => {
      // Mock window.gapi
      window.gapi = { client: { setToken: vi.fn(), load: vi.fn().mockResolvedValue() } };

      auth._handleTokenResponse({
        access_token: 'new-token',
        expires_in: 3600,
      });

      expect(auth.accessToken).toBe('new-token');
      expect(auth.expiresAt).toBeGreaterThan(Date.now());
      expect(auth.isRestoring).toBe(false);
    });

    it('clears token on error', () => {
      auth.accessToken = 'old-token';
      auth.isRestoring = true;

      auth._handleTokenResponse({ error: 'access_denied' });

      expect(auth.accessToken).toBeNull();
      expect(auth.expiresAt).toBeNull();
      expect(auth.isRestoring).toBe(false);
    });

    it('emits change event', () => {
      const listener = vi.fn();
      auth.onChange(listener);

      auth._handleTokenResponse({ error: 'test' });

      expect(listener).toHaveBeenCalled();
    });
  });
});
