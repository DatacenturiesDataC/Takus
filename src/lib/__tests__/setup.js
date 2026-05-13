// Test setup — polyfills for jsdom environment
// Only load fake-indexeddb when running in jsdom (heavy memory footprint)
if (typeof window !== 'undefined') {
  await import('fake-indexeddb/auto');
}

// Minimal crypto.subtle mock for identity-vault tests (jsdom doesn't have SubtleCrypto)
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = {
    ...globalThis.crypto,
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
    subtle: {
      generateKey: async () => ({ type: 'secret', algorithm: { name: 'AES-GCM' } }),
      encrypt: async (_alg, _key, data) => data.buffer || data,
      decrypt: async (_alg, _key, data) => data.buffer || data,
    },
  };
}
