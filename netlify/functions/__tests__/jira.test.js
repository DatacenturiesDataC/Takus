// Takus — Jira Function Tests
// Tests POST /api/jira (create issue, dry-run) and method rejection.
// Mocks global fetch for Jira Cloud REST API calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch for Jira API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import handler AFTER mocks are registered
const { default: handler } = await import('../jira.mjs');

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

function validJiraBody(overrides = {}) {
  return {
    host: 'myteam.atlassian.net',
    email: 'alice@example.com',
    token: 'jira-api-token-123',
    project: 'TAKUS',
    summary: 'Fix login bug',
    description: 'Users cannot log in on mobile.',
    issueType: 'Bug',
    ...overrides,
  };
}

function mockJiraResponse(responseBody, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(responseBody), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Jira function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /api/jira — create issue ─────────────────────────────────────

  describe('POST / — creates a Jira issue successfully', () => {
    it('creates an issue and returns key + URL', async () => {
      mockJiraResponse({ key: 'TAKUS-42', id: '10042', self: 'https://myteam.atlassian.net/rest/api/3/issue/10042' }, 201);

      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.key).toBe('TAKUS-42');
      expect(data.url).toContain('myteam.atlassian.net/browse/TAKUS-42');

      // Verify fetch was called with the right Jira URL
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('myteam.atlassian.net/rest/api/3/issue'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('uses default issueType "Task" when not specified', async () => {
      mockJiraResponse({ key: 'TAKUS-43' }, 201);

      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ issueType: undefined }),
      });
      const res = await handler(req);
      expect(res.status).toBe(201);

      // Verify the body sent to Jira uses "Task" as default
      const fetchCall = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1].body);
      expect(sentBody.fields.issuetype.name).toBe('Task');
    });

    it('strips protocol and trailing slash from host', async () => {
      mockJiraResponse({ key: 'TAKUS-44' }, 201);

      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ host: 'https://myteam.atlassian.net/' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(201);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://myteam.atlassian.net/rest/api/3/issue',
        expect.anything(),
      );
    });
  });

  // ── POST /api/jira — dry run ──────────────────────────────────────────

  describe('POST / — dry run (verify connection)', () => {
    it('returns ok + displayName on successful auth check', async () => {
      mockJiraResponse({ displayName: 'Alice Johnson' });

      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ dryRun: true }),
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.displayName).toBe('Alice Johnson');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/myself'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      );
    });

    it('returns Jira error status on failed auth check', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' },
      }));

      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ dryRun: true }),
      });
      const res = await handler(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('Jira auth failed');
    });
  });

  // ── POST /api/jira — rejects missing required fields ──────────────────

  describe('POST / — rejects missing required fields', () => {
    it('returns 400 when host is missing', async () => {
      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ host: '' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('host');
    });

    it('returns 400 when email is missing', async () => {
      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ email: '' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('email');
    });

    it('returns 400 when token is missing', async () => {
      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ token: '' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('token');
    });

    it('returns 400 when project is missing (non-dry-run)', async () => {
      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ project: '' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('project');
    });

    it('returns 400 when summary is missing (non-dry-run)', async () => {
      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody({ summary: '' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('summary');
    });
  });

  // ── POST /api/jira — returns 400 for invalid JSON ─────────────────────

  describe('POST / — returns 400 for invalid JSON', () => {
    it('returns 400 for invalid JSON body', async () => {
      const url = 'https://takus.netlify.app/api/jira';
      const req = new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://takus.netlify.app',
        },
        body: 'not-json{{{',
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid JSON');
    });
  });

  // ── Non-POST methods ──────────────────────────────────────────────────

  describe('Non-POST methods', () => {
    it('returns 405 for GET requests', async () => {
      const req = makeRequest('GET', '/api/jira');
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it('returns 405 for PUT requests', async () => {
      const req = makeRequest('PUT', '/api/jira', {
        body: validJiraBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it('returns 405 for DELETE requests', async () => {
      const req = makeRequest('DELETE', '/api/jira');
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it('returns 204 for OPTIONS (CORS preflight)', async () => {
      const req = makeRequest('OPTIONS', '/api/jira');
      const res = await handler(req);
      expect(res.status).toBe(204);
    });
  });

  // ── Upstream error handling ───────────────────────────────────────────

  describe('Upstream error handling', () => {
    it('returns 502 when fetch throws a network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

      const req = makeRequest('POST', '/api/jira', {
        body: validJiraBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain('Network unreachable');
    });
  });
});
