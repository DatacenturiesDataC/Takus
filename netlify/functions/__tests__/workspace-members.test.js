// Takus — Workspace Member Endpoint Tests
// Tests the GET /members and DELETE /members routes in the workspace function.
// Uses a mocked @netlify/blobs getStore to avoid real network calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data ───────────────────────────────────────────────────────────────

const ADMIN_TOKEN = 'admin-token-abc123';
const MEMBER_TOKEN = 'member-token-xyz789';
const WORKSPACE_ID = 'ws_testws01';

function makeWorkspace(overrides = {}) {
  return {
    id: WORKSPACE_ID,
    name: 'Test Workspace',
    createdAt: Date.now(),
    adminToken: ADMIN_TOKEN,
    inviteCode: 'ABCD-1234',
    aiProvider: 'openai',
    aiKey: 'sk-test',
    members: [
      { name: 'Alice', token: ADMIN_TOKEN, joinedAt: 1000 },
      { name: 'Bob', token: MEMBER_TOKEN, joinedAt: 2000 },
      { name: 'Carol', token: 'carol-token-000', joinedAt: 3000 },
    ],
    settings: {},
    ...overrides,
  };
}

// ── Mock store ──────────────────────────────────────────────────────────────

let storeData = {};

const mockStore = {
  get: vi.fn(async (key) => storeData[key] ?? null),
  set: vi.fn(async (key, value) => {
    storeData[key] = value;
  }),
  list: vi.fn(async () => ({
    blobs: Object.keys(storeData).map((key) => ({ key })),
  })),
};

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn(() => mockStore),
}));

// Import handler AFTER mocks are registered
const { default: handler } = await import('../workspace.mjs');

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

function adminHeaders() {
  return {
    'x-workspace-id': WORKSPACE_ID,
    'x-admin-token': ADMIN_TOKEN,
  };
}

function memberHeaders() {
  return {
    'x-workspace-id': WORKSPACE_ID,
    'x-admin-token': MEMBER_TOKEN, // not admin — should be rejected
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Workspace member endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const ws = makeWorkspace();
    storeData = { [WORKSPACE_ID]: JSON.stringify(ws) };
  });

  // ── GET /api/workspace/members ──────────────────────────────────────────

  describe('GET /members — list members', () => {
    it('returns member list without tokens', async () => {
      const req = makeRequest('GET', '/api/workspace/members', {
        headers: adminHeaders(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.members).toHaveLength(3);

      // Verify tokens are stripped
      for (const member of data.members) {
        expect(member).not.toHaveProperty('token');
        expect(member).toHaveProperty('name');
        expect(member).toHaveProperty('joinedAt');
        expect(member).toHaveProperty('isAdmin');
      }

      // Admin flag should be set correctly
      const alice = data.members.find((m) => m.name === 'Alice');
      expect(alice.isAdmin).toBe(true);

      const bob = data.members.find((m) => m.name === 'Bob');
      expect(bob.isAdmin).toBe(false);
    });

    it('rejects non-admin with 403', async () => {
      const req = makeRequest('GET', '/api/workspace/members', {
        headers: memberHeaders(),
      });
      const res = await handler(req, {});
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 401 when headers are missing', async () => {
      const req = makeRequest('GET', '/api/workspace/members');
      const res = await handler(req, {});
      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /api/workspace/members ───────────────────────────────────────

  describe('DELETE /members — remove a member', () => {
    it('removes a member and returns updated count', async () => {
      const req = makeRequest('DELETE', '/api/workspace/members', {
        headers: adminHeaders(),
        body: { memberName: 'Bob' },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.removed).toBe('Bob');
      expect(data.memberCount).toBe(2);

      // Verify store was updated
      expect(mockStore.set).toHaveBeenCalledWith(
        WORKSPACE_ID,
        expect.any(String),
      );
      const saved = JSON.parse(mockStore.set.mock.calls[0][1]);
      expect(saved.members).toHaveLength(2);
      expect(saved.members.find((m) => m.name === 'Bob')).toBeUndefined();
    });

    it('prevents admin from removing themselves', async () => {
      const req = makeRequest('DELETE', '/api/workspace/members', {
        headers: adminHeaders(),
        body: { memberName: 'Alice' },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Cannot remove the workspace admin');
    });

    it('rejects non-admin with 403', async () => {
      const req = makeRequest('DELETE', '/api/workspace/members', {
        headers: memberHeaders(),
        body: { memberName: 'Carol' },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 404 for non-existent member', async () => {
      const req = makeRequest('DELETE', '/api/workspace/members', {
        headers: adminHeaders(),
        body: { memberName: 'Zara' },
      });
      const res = await handler(req, {});
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe('Member not found');
    });

    it('returns 400 when memberName is missing', async () => {
      const req = makeRequest('DELETE', '/api/workspace/members', {
        headers: adminHeaders(),
        body: {},
      });
      const res = await handler(req, {});
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('memberName is required');
    });
  });
});
