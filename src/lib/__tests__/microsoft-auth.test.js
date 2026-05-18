// Takus — Microsoft Auth Tests
// Tests the pure-logic parts — state management, token lifecycle, listeners.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ microsoft: { clientId: 'test-ms', authority: 'https://login.microsoftonline.com/common' } })),
  isMicrosoftConfigured: vi.fn(() => false),
}));

import { MicrosoftAuth } from '../microsoft-auth.js';

describe('MicrosoftAuth', () => {
  let auth;

  beforeEach(() => {
    auth = new MicrosoftAuth();
  });

  describe('initial state', () => {
    it('starts disconnected', () => {
      expect(auth.isConnected).toBe(false);
      expect(auth.accessToken).toBeNull();
      expect(auth.expiresAt).toBeNull();
      expect(auth.isReady).toBe(false);
      expect(auth._account).toBeNull();
    });

    it('tokenTimeLeft is 0 when no token', () => {
      expect(auth.tokenTimeLeft).toBe(0);
    });
  });

  describe('singleton', () => {
    it('getInstance returns consistent instance', () => {
      const a = MicrosoftAuth.getInstance();
      const b = MicrosoftAuth.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('isConnected', () => {
    it('returns true when token exists and not expired', () => {
      auth.accessToken = 'ms-token';
      auth.expiresAt = Date.now() + 60_000;
      expect(auth.isConnected).toBe(true);
    });

    it('returns false when token is expired', () => {
      auth.accessToken = 'ms-token';
      auth.expiresAt = Date.now() - 1000;
      expect(auth.isConnected).toBe(false);
    });

    it('returns false when no token', () => {
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
      const bad = vi.fn(() => { throw new Error('boom'); });
      const good = vi.fn();
      auth.onChange(bad);
      auth.onChange(good);
      auth._emit();
      expect(good).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('clears all auth state', () => {
      auth.accessToken = 'token';
      auth.expiresAt = Date.now() + 60000;
      auth.userEmail = 'test@microsoft.com';
      auth.userName = 'Test User';
      auth.userPhoto = 'https://photo.url';
      auth._account = { id: 'acct' };

      auth.disconnect();

      expect(auth.accessToken).toBeNull();
      expect(auth.expiresAt).toBeNull();
      expect(auth.userEmail).toBeNull();
      expect(auth.userName).toBeNull();
      expect(auth.userPhoto).toBeNull();
      expect(auth._account).toBeNull();
    });

    it('emits change event on disconnect', () => {
      const listener = vi.fn();
      auth.onChange(listener);
      auth.disconnect();
      expect(listener).toHaveBeenCalledWith(false);
    });

    it('revokes blob URL for user photo', () => {
      const revokeObjectURL = vi.fn();
      globalThis.URL.revokeObjectURL = revokeObjectURL;

      auth.userPhoto = 'blob:http://localhost/photo';
      auth.disconnect();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/photo');
    });
  });

  describe('_scopes', () => {
    it('includes required Microsoft Graph scopes', () => {
      const scopes = auth._scopes;
      expect(scopes).toContain('User.Read');
      expect(scopes).toContain('Files.ReadWrite');
      expect(scopes).toContain('Calendars.ReadWrite');
      expect(scopes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('ensureValidToken', () => {
    it('throws when not connected', async () => {
      auth._account = null;
      await expect(auth.ensureValidToken()).rejects.toThrow('Not connected');
    });
  });
});
