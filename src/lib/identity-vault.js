// Takus — Identity Vault (Phase 3: Connect)
// AES-GCM 256-bit encryption for integration credentials stored in IndexedDB.
// The CryptoKey itself is stored as a structured-cloneable object in the
// settings store with extractable:false — it never leaves IndexedDB in raw form.
import { getSetting, saveSetting } from './storage.js';

let _cachedKey = null; // in-process cache so we don't hit IDB on every call

async function _getKey() {
  if (_cachedKey) return _cachedKey;
  const stored = await getSetting('_vaultKey');
  if (stored) { _cachedKey = stored; return _cachedKey; }
  _cachedKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,              // non-extractable — key cannot be exported as raw bytes
    ['encrypt', 'decrypt'],
  );
  await saveSetting('_vaultKey', _cachedKey);
  return _cachedKey;
}

/** Encrypt a plaintext string and return a serialisable envelope. */
async function _encrypt(plaintext) {
  const key = await _getKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(buf)) };
}

/** Decrypt an envelope returned by _encrypt. Returns '' on failure. */
async function _decrypt(envelope) {
  if (!envelope?.data?.length) return '';
  try {
    const key = await _getKey();
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) },
      key,
      new Uint8Array(envelope.data),
    );
    return new TextDecoder().decode(buf);
  } catch {
    return '';
  }
}

/**
 * Encrypt `value` and persist it under `credKey` in the settings store.
 * Passing `null` or `''` clears the credential.
 */
export async function saveCredential(credKey, value) {
  if (!value) { await saveSetting(`cred_${credKey}`, null); return; }
  const envelope = await _encrypt(value);
  await saveSetting(`cred_${credKey}`, envelope);
}

/** Load and decrypt a credential.  Returns '' if not set or key was lost. */
export async function loadCredential(credKey) {
  const envelope = await getSetting(`cred_${credKey}`);
  if (!envelope) return '';
  return _decrypt(envelope);
}

/** Remove a credential from the vault. */
export async function clearCredential(credKey) {
  await saveSetting(`cred_${credKey}`, null);
}
