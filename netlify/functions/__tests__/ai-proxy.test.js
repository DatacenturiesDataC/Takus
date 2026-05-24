// Takus — AI Proxy Function Tests
// Tests POST /api/ai-proxy/{transcribe,chat,embed} and method rejection.
// Uses a mocked @netlify/blobs getStore backed by an in-memory Map
// and a mocked global fetch for upstream AI API calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock stores ─────────────────────────────────────────────────────────────

let workspaceData = {};
let rateLimitData = {};

const mockWorkspaceStore = {
  get: vi.fn(async (key) => workspaceData[key] ?? null),
  set: vi.fn(async (key, value) => {
    workspaceData[key] = value;
  }),
};

const mockRateLimitStore = {
  get: vi.fn(async (key) => rateLimitData[key] ?? null),
  set: vi.fn(async (key, value) => {
    rateLimitData[key] = value;
  }),
};

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn((name) => {
    if (name === 'workspaces') return mockWorkspaceStore;
    if (name === 'rate-limits') return mockRateLimitStore;
    return mockWorkspaceStore;
  }),
}));

// Mock global fetch for upstream AI API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import handler AFTER mocks are registered
const { default: handler } = await import('../ai-proxy.mjs');

// ── Helpers ─────────────────────────────────────────────────────────────────

const VALID_WS_ID = 'ws-test-123';
const VALID_MEMBER_TOKEN = 'member-token-abc';

const validWorkspace = {
  id: VALID_WS_ID,
  name: 'Test Workspace',
  aiKey: 'sk-test-key-12345',
  aiProvider: 'openai',
  members: [{ name: 'Alice', token: VALID_MEMBER_TOKEN }],
};

function seedWorkspace(overrides = {}) {
  const ws = { ...validWorkspace, ...overrides };
  workspaceData[ws.id] = JSON.stringify(ws);
  return ws;
}

function makeRequest(method, path, { headers = {}, body, formData } = {}) {
  const url = `https://takus.netlify.app${path}`;
  const init = {
    method,
    headers: {
      origin: 'https://takus.netlify.app',
      'x-workspace-id': VALID_WS_ID,
      'x-member-token': VALID_MEMBER_TOKEN,
      ...headers,
    },
  };
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function mockUpstreamResponse(responseBody, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(responseBody), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AI Proxy function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceData = {};
    rateLimitData = {};
  });

  // ── Method not allowed ──────────────────────────────────────────────────

  describe('Method not allowed', () => {
    it('returns 405 for GET requests', async () => {
      const req = makeRequest('GET', '/api/ai-proxy/chat');
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });

    it('returns 405 for PUT requests', async () => {
      const req = makeRequest('PUT', '/api/ai-proxy/chat');
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });

    it('returns 405 for DELETE requests', async () => {
      const req = makeRequest('DELETE', '/api/ai-proxy/embed');
      const res = await handler(req, {});
      expect(res.status).toBe(405);
    });
  });

  // ── Authentication ────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('returns 401 when x-workspace-id header is missing', async () => {
      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        headers: { 'x-workspace-id': '', 'x-member-token': VALID_MEMBER_TOKEN },
        body: { messages: [{ role: 'user', content: 'Hello' }] },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('x-workspace-id');
    });

    it('returns 401 when x-member-token header is missing', async () => {
      seedWorkspace();
      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        headers: { 'x-member-token': '' },
        body: { messages: [{ role: 'user', content: 'Hello' }] },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('x-member-token');
    });

    it('returns 404 when workspace does not exist', async () => {
      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        body: { messages: [{ role: 'user', content: 'Hello' }] },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toContain('not found');
    });

    it('returns 403 for invalid member token', async () => {
      seedWorkspace();
      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        headers: { 'x-member-token': 'wrong-token' },
        body: { messages: [{ role: 'user', content: 'Hello' }] },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toContain('Invalid member token');
    });
  });

  // ── Unknown endpoint ──────────────────────────────────────────────────

  describe('Unknown endpoint', () => {
    it('returns 404 for an unrecognised subpath', async () => {
      seedWorkspace();
      const req = makeRequest('POST', '/api/ai-proxy/unknown', {
        body: {},
      });
      const res = await handler(req, {});
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toContain('Unknown endpoint');
    });
  });

  // ── Transcribe endpoint ───────────────────────────────────────────────

  describe('POST /api/ai-proxy/transcribe', () => {
    it('rejects files over 100 MB via Content-Length header', async () => {
      seedWorkspace();
      const formData = new FormData();
      const file = new File(['audio data'], 'test.mp3', { type: 'audio/mpeg' });
      formData.append('file', file);

      const req = makeRequest('POST', '/api/ai-proxy/transcribe', {
        headers: { 'content-length': String(200 * 1024 * 1024) }, // 200 MB
        formData,
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('too large');
    });

    it('rejects non-audio/video MIME types', async () => {
      seedWorkspace();
      const formData = new FormData();
      const file = new File(['not audio'], 'test.txt', { type: 'text/plain' });
      formData.append('file', file);

      const req = makeRequest('POST', '/api/ai-proxy/transcribe', {
        headers: { 'content-length': '100' },
        formData,
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid file type');
      expect(data.error).toContain('text/plain');
    });

    it('accepts audio/* MIME types and forwards to OpenAI', async () => {
      seedWorkspace();
      mockUpstreamResponse({ text: 'Hello world' });

      const formData = new FormData();
      const file = new File(['audio data'], 'test.mp3', { type: 'audio/mpeg' });
      formData.append('file', file);

      const req = makeRequest('POST', '/api/ai-proxy/transcribe', {
        headers: { 'content-length': '100' },
        formData,
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.text).toBe('Hello world');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/audio/transcriptions'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('accepts video/* MIME types', async () => {
      seedWorkspace();
      mockUpstreamResponse({ text: 'Video transcript' });

      const formData = new FormData();
      const file = new File(['video data'], 'test.mp4', { type: 'video/mp4' });
      formData.append('file', file);

      const req = makeRequest('POST', '/api/ai-proxy/transcribe', {
        headers: { 'content-length': '100' },
        formData,
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);
    });
  });

  // ── Chat endpoint ─────────────────────────────────────────────────────

  describe('POST /api/ai-proxy/chat', () => {
    it('forwards request to OpenAI and returns response', async () => {
      seedWorkspace();
      mockUpstreamResponse({
        choices: [{ message: { role: 'assistant', content: 'Hi there!' } }],
      });

      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        body: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.choices[0].message.content).toBe('Hi there!');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('chat/completions'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('forwards request to Gemini when provider is gemini', async () => {
      seedWorkspace({ aiProvider: 'gemini' });
      mockUpstreamResponse({
        candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }],
      });

      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        body: {
          model: 'gemini-pro',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.candidates[0].content.parts[0].text).toBe('Gemini response');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generateContent'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns 400 for invalid JSON body', async () => {
      seedWorkspace();
      const url = 'https://takus.netlify.app/api/ai-proxy/chat';
      const req = new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://takus.netlify.app',
          'x-workspace-id': VALID_WS_ID,
          'x-member-token': VALID_MEMBER_TOKEN,
        },
        body: 'not-json{{{',
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid JSON');
    });
  });

  // ── Embed endpoint ────────────────────────────────────────────────────

  describe('POST /api/ai-proxy/embed', () => {
    it('forwards embedding request to OpenAI', async () => {
      seedWorkspace();
      mockUpstreamResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      });

      const req = makeRequest('POST', '/api/ai-proxy/embed', {
        body: {
          model: 'text-embedding-ada-002',
          input: 'Test text',
        },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/embeddings'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('forwards embedding request to Gemini when provider is gemini', async () => {
      seedWorkspace({ aiProvider: 'gemini' });
      mockUpstreamResponse({
        embeddings: [{ values: [0.4, 0.5, 0.6] }],
      });

      const req = makeRequest('POST', '/api/ai-proxy/embed', {
        body: {
          model: 'text-embedding-004',
          input: 'Test text',
        },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('batchEmbedContents'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ── Workspace without AI key ──────────────────────────────────────────

  describe('Missing AI key', () => {
    it('returns 400 when workspace has no AI key configured', async () => {
      seedWorkspace({ aiKey: '' });
      const req = makeRequest('POST', '/api/ai-proxy/chat', {
        body: { messages: [{ role: 'user', content: 'Hello' }] },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('no AI API key');
    });
  });
});
