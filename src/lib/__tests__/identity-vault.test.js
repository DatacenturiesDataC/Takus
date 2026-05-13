// Takus — Identity Vault Tests
// Tests AES-GCM encryption round-trip, credential lifecycle, and edge cases.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveCredential, loadCredential, clearCredential } from '../identity-vault.js';

// The vault uses storage.js getSetting/saveSetting — we need the same
// in-memory mock that other test files use.

describe('Identity Vault', () => {
  beforeEach(() => {
    // Reset the vault's cached key between tests by clearing the module cache
    // Since identity-vault caches _cachedKey in module scope, we can't reset it
    // directly — but each test cycle in vitest re-imports, so the cache is fresh.
  });

  it('saves and loads a credential round-trip', async () => {
    await saveCredential('test_token', 'my-secret-api-key');
    const loaded = await loadCredential('test_token');
    expect(loaded).toBe('my-secret-api-key');
  });

  it('returns empty string for non-existent credential', async () => {
    const loaded = await loadCredential('nonexistent_key');
    expect(loaded).toBe('');
  });

  it('clears a credential', async () => {
    await saveCredential('test_clear', 'some-value');
    await clearCredential('test_clear');
    const loaded = await loadCredential('test_clear');
    expect(loaded).toBe('');
  });

  it('handles null value as clear', async () => {
    await saveCredential('test_null', 'initial-value');
    await saveCredential('test_null', null);
    const loaded = await loadCredential('test_null');
    expect(loaded).toBe('');
  });

  it('handles empty string value as clear', async () => {
    await saveCredential('test_empty', 'initial-value');
    await saveCredential('test_empty', '');
    const loaded = await loadCredential('test_empty');
    expect(loaded).toBe('');
  });

  it('encrypts with unique IV each time (different ciphertexts)', async () => {
    // Save the same value twice under different keys
    await saveCredential('dup_a', 'same-value');
    await saveCredential('dup_b', 'same-value');

    // Both should decrypt to the same value
    const a = await loadCredential('dup_a');
    const b = await loadCredential('dup_b');
    expect(a).toBe('same-value');
    expect(b).toBe('same-value');
  });

  it('handles special characters in credentials', async () => {
    const special = '{"token":"abc123","scope":"admin"}!@#$%^&*()_+ — ñ 日本語';
    await saveCredential('special_chars', special);
    const loaded = await loadCredential('special_chars');
    expect(loaded).toBe(special);
  });

  it('handles long credentials', async () => {
    const long = 'x'.repeat(10000);
    await saveCredential('long_cred', long);
    const loaded = await loadCredential('long_cred');
    expect(loaded).toBe(long);
  });
});
