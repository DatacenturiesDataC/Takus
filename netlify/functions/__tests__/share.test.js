// Takus — Share Function Tests
// Tests POST /api/share (create) and GET /api/share?id=X (retrieve).
// Uses a mocked @netlify/blobs getStore backed by an in-memory Map.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock store ──────────────────────────────────────────────────────────────

let storeData = {};

const mockStore = {
  get: vi.fn(async (key) => storeData[key] ?? null),
  set: vi.fn(async (key, value) => {
    storeData[key] = value;
  }),
  delete: vi.fn(async (key) => {
    delete storeData[key];
  }),
};

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn(() => mockStore),
}));

// Import handler AFTER mocks are registered
const { default: handler } = await import('../share.mjs');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(method, path, { headers = {}, body } = {}) {
  const url = `https://takus.netlify.app${path}`;
  const init = {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'https://takus.netlify.app',
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function validShareBody(overrides = {}) {
  return {
    title: 'Test Summary',
    date: '2026-01-15',
    type: 'daily',
    aiSummary: 'This is an AI-generated summary for testing.',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Share function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeData = {};
  });

  // ── POST /api/share — create a share ────────────────────────────────────

  describe('POST / — create a share', () => {
    it('creates a share with a crypto-secure 12-char hex ID', async () => {
      const req = makeRequest('POST', '/api/share', {
        body: validShareBody(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data.id).toMatch(/^[a-f0-9]{12}$/);
      expect(data).toHaveProperty('url');
      expect(data.url).toBe(`/api/share?id=${data.id}`);

      // Verify the payload was stored
      expect(mockStore.set).toHaveBeenCalledWith(data.id, expect.any(String));
      const stored = JSON.parse(mockStore.set.mock.calls[0][1]);
      expect(stored.title).toBe('Test Summary');
      expect(stored.aiSummary).toBe('This is an AI-generated summary for testing.');
      expect(stored).toHaveProperty('createdAt');
      expect(stored).toHaveProperty('expiresAt');
      expect(stored.expiresAt).toBeGreaterThan(stored.createdAt);
    });

    it('returns 400 when title is missing', async () => {
      const req = makeRequest('POST', '/api/share', {
        body: validShareBody({ title: '' }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('title');
    });

    it('returns 400 when aiSummary is missing', async () => {
      const req = makeRequest('POST', '/api/share', {
        body: validShareBody({ aiSummary: '' }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('aiSummary');
    });

    it('returns 400 for invalid JSON body', async () => {
      const url = 'https://takus.netlify.app/api/share';
      const req = new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://takus.netlify.app',
        },
        body: 'not-json{{{',
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid JSON');
    });
  });

  // ── POST /api/share — rate limiting ─────────────────────────────────────

  describe('POST / — rate limiting', () => {
    it('rate limits after 20 requests from the same origin', async () => {
      // Use a unique localhost origin so earlier POST tests don't pollute
      // the module-level rateLimitMap counter for this test.
      const rateLimitOrigin = 'http://localhost:9999';

      // Fire 20 requests — all should succeed (status 201)
      for (let i = 0; i < 20; i++) {
        const req = makeRequest('POST', '/api/share', {
          headers: { origin: rateLimitOrigin },
          body: validShareBody({ title: `Share ${i}` }),
        });
        const res = await handler(req, {});
        expect(res.status).toBe(201);
      }

      // The 21st request should be rate-limited
      const req = makeRequest('POST', '/api/share', {
        headers: { origin: rateLimitOrigin },
        body: validShareBody({ title: 'Over limit' }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(429);

      const data = await res.json();
      expect(data.error).toContain('Rate limit');
      expect(res.headers.get('Retry-After')).toBe('3600');
    });
  });

  // ── GET /api/share?id=X — retrieve a share ─────────────────────────────

  describe('GET /?id=X — retrieve a share', () => {
    it('returns shared data for a valid ID', async () => {
      const id = 'abc123def456';
      const payload = JSON.stringify({
        title: 'Stored Summary',
        date: '2026-01-15',
        type: 'daily',
        aiSummary: 'Stored AI summary.',
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      storeData[id] = payload;

      const req = makeRequest('GET', `/api/share?id=${id}`);
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.title).toBe('Stored Summary');
      expect(data.aiSummary).toBe('Stored AI summary.');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    });

    it('returns 404 for a non-existent share', async () => {
      const req = makeRequest('GET', '/api/share?id=000000000000');
      const res = await handler(req, {});
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toContain('not found');
    });

    it('returns 410 for an expired share', async () => {
      const id = 'expired12345';
      const payload = JSON.stringify({
        title: 'Old Summary',
        date: '2025-01-01',
        type: 'daily',
        aiSummary: 'Expired.',
        createdAt: 1000,
        expiresAt: 2000, // far in the past
      });
      storeData[id] = payload;

      const req = makeRequest('GET', `/api/share?id=${id}`);
      const res = await handler(req, {});
      expect(res.status).toBe(410);

      const data = await res.json();
      expect(data.error).toContain('expired');

      // Should attempt cleanup
      expect(mockStore.delete).toHaveBeenCalledWith(id);
    });

    it('returns 400 for an invalid share ID format', async () => {
      const req = makeRequest('GET', '/api/share?id=INVALID!@#');
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid share ID');
    });

    it('returns 400 when id parameter is missing', async () => {
      const req = makeRequest('GET', '/api/share');
      const res = await handler(req, {});
      expect(res.status).toBe(400);
    });
  });

  // ── Method not allowed ──────────────────────────────────────────────────

  describe('Unsupported methods', () => {
    it('returns 405 for PUT', async () => {
      const req = makeRequest('PUT', '/api/share', {
        body: validShareBody(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });
  });
});
