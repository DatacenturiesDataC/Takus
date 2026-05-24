// Takus — Feedback Function Tests
// Tests POST /api/feedback (submit feedback) and method rejection.
// Uses a mocked @netlify/blobs getStore backed by an in-memory Map.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock store ──────────────────────────────────────────────────────────────

let storeData = {};

const mockStore = {
  get: vi.fn(async (key) => storeData[key] ?? null),
  set: vi.fn(async (key, value) => {
    storeData[key] = value;
  }),
};

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn(() => mockStore),
}));

// Import handler AFTER mocks are registered
const { default: handler } = await import('../feedback.mjs');

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

function validFeedbackBody(overrides = {}) {
  return {
    category: 'bug',
    description: 'The app crashes when I click the save button.',
    timestamp: '2026-01-15T10:00:00Z',
    device_context: {
      app_version: '1.0.0',
      browser: 'Chrome 120',
      os: 'macOS 14',
      screen: '1920x1080',
      language: 'en',
      connected_providers: ['google'],
      ai_provider: 'openai',
      enabled_features: ['ai-summary'],
      storage_used_mb: 42,
      online: true,
    },
    recent_errors: [
      { message: 'TypeError: undefined is not a function', timestamp: '2026-01-15T09:55:00Z' },
    ],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Feedback function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeData = {};
  });

  // ── POST /api/feedback — save feedback ──────────────────────────────────

  describe('POST / — save feedback', () => {
    it('saves feedback successfully and returns id', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.received).toBe(true);
      expect(data).toHaveProperty('id');
      expect(data.id).toMatch(/^fb_/);

      // Verify it was stored
      expect(mockStore.set).toHaveBeenCalledWith(data.id, expect.any(String));
      const stored = JSON.parse(mockStore.set.mock.calls[0][1]);
      expect(stored.category).toBe('bug');
      expect(stored.description).toBe('The app crashes when I click the save button.');
      expect(stored).toHaveProperty('received_at');
    });

    it('saves feedback with optional contact_email', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody({ contact_email: 'test@example.com' }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(201);

      const stored = JSON.parse(mockStore.set.mock.calls[0][1]);
      expect(stored.contact_email).toBe('test@example.com');
    });

    it('sanitizes device_context fields', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(201);

      const stored = JSON.parse(mockStore.set.mock.calls[0][1]);
      expect(stored.device_context).toBeDefined();
      expect(stored.device_context.app_version).toBe('1.0.0');
      expect(stored.device_context.online).toBe(true);
    });
  });

  // ── POST /api/feedback — validation errors ──────────────────────────────

  describe('POST / — rejects missing required fields', () => {
    it('returns 400 when category is missing', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody({ category: undefined }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('category');
    });

    it('returns 400 for an invalid category value', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody({ category: 'invalid_category' }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('category');
    });

    it('returns 400 when description is missing', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody({ description: undefined }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Description');
    });

    it('returns 400 when description is too short', async () => {
      const req = makeRequest('POST', '/api/feedback', {
        body: validFeedbackBody({ description: 'Hi' }),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('at least 5 characters');
    });

    it('returns 400 for invalid JSON body', async () => {
      const url = 'https://takus.netlify.app/api/feedback';
      const req = new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://takus.netlify.app',
        },
        body: '{bad json',
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid JSON');
    });
  });

  // ── Non-POST methods ───────────────────────────────────────────────────

  describe('Non-POST methods', () => {
    it('returns 405 for GET requests', async () => {
      const req = makeRequest('GET', '/api/feedback');
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });

    it('returns 405 for PUT requests', async () => {
      const req = makeRequest('PUT', '/api/feedback', {
        body: validFeedbackBody(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });

    it('returns 405 for DELETE requests', async () => {
      const req = makeRequest('DELETE', '/api/feedback');
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });
  });
});
