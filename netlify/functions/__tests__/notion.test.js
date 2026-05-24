// Takus — Notion Function Tests
// Tests POST /api/notion (createPage, verify, listDatabases) and method rejection.
// Mocks global fetch for Notion API calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch for Notion API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import handler AFTER mocks are registered
const { default: handler } = await import('../notion.mjs');

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

function validNotionBody(overrides = {}) {
  return {
    apiKey: 'ntn_test_api_key_123',
    action: 'createPage',
    databaseId: 'db-abc-123',
    title: 'Meeting Notes',
    content: '## Summary\n\nDiscussed project roadmap.\n\n- Item 1\n- Item 2',
    ...overrides,
  };
}

function mockNotionResponse(responseBody, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(responseBody), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Notion function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /api/notion — create page ────────────────────────────────────

  describe('POST / — creates a Notion page successfully', () => {
    it('creates a page in a database and returns url + id', async () => {
      mockNotionResponse({
        id: 'page-id-456',
        url: 'https://www.notion.so/Meeting-Notes-page-id-456',
      }, 201);

      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.id).toBe('page-id-456');
      expect(data.url).toContain('notion.so');

      // Verify fetch was called with correct endpoint and auth
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer ntn_test_api_key_123',
            'Notion-Version': '2022-06-28',
          }),
        }),
      );

      // Verify the body includes parent and properties
      const fetchCall = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1].body);
      expect(sentBody.parent).toEqual({ database_id: 'db-abc-123' });
      expect(sentBody.properties.title.title[0].text.content).toBe('Meeting Notes');
      // Verify markdown was converted to blocks
      expect(sentBody.children.length).toBeGreaterThan(0);
    });

    it('creates a page with parentId instead of databaseId', async () => {
      mockNotionResponse({
        id: 'page-id-789',
        url: 'https://www.notion.so/Child-Page-page-id-789',
      }, 201);

      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody({ databaseId: undefined, parentId: 'parent-page-111' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1].body);
      expect(sentBody.parent).toEqual({ page_id: 'parent-page-111' });
    });

    it('converts markdown content to Notion blocks', async () => {
      mockNotionResponse({ id: 'page-id-md', url: 'https://notion.so/md' }, 201);

      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody({
          content: '# Heading 1\n## Heading 2\n### Heading 3\n- Bullet item\nRegular paragraph',
        }),
      });
      const res = await handler(req);
      expect(res.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1].body);
      const blocks = sentBody.children;

      expect(blocks[0].type).toBe('heading_1');
      expect(blocks[1].type).toBe('heading_2');
      expect(blocks[2].type).toBe('heading_3');
      expect(blocks[3].type).toBe('bulleted_list_item');
      expect(blocks[4].type).toBe('paragraph');
    });

    it('returns upstream Notion error on API failure', async () => {
      mockNotionResponse({ message: 'Could not find database' }, 404);

      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toContain('Notion error');
    });
  });

  // ── POST /api/notion — verify connection ──────────────────────────────

  describe('POST / — verify action', () => {
    it('returns ok + name on successful verify', async () => {
      mockNotionResponse({ name: 'Alice Bot', type: 'bot' });

      const req = makeRequest('POST', '/api/notion', {
        body: { apiKey: 'ntn_key', action: 'verify' },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.name).toBe('Alice Bot');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/users/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ntn_key',
          }),
        }),
      );
    });

    it('returns error on failed verify', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' },
      }));

      const req = makeRequest('POST', '/api/notion', {
        body: { apiKey: 'bad_key', action: 'verify' },
      });
      const res = await handler(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('Notion auth failed');
    });
  });

  // ── POST /api/notion — listDatabases ──────────────────────────────────

  describe('POST / — listDatabases action', () => {
    it('returns list of databases', async () => {
      mockNotionResponse({
        results: [
          { id: 'db-1', title: [{ plain_text: 'Tasks DB' }] },
          { id: 'db-2', title: [{ plain_text: 'Notes DB' }] },
        ],
      });

      const req = makeRequest('POST', '/api/notion', {
        body: { apiKey: 'ntn_key', action: 'listDatabases' },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.databases).toHaveLength(2);
      expect(data.databases[0].title).toBe('Tasks DB');
      expect(data.databases[1].title).toBe('Notes DB');
    });
  });

  // ── POST /api/notion — rejects missing required fields ────────────────

  describe('POST / — rejects missing required fields', () => {
    it('returns 400 when apiKey is missing', async () => {
      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody({ apiKey: '' }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('apiKey');
    });

    it('returns 400 when createPage has no databaseId or parentId', async () => {
      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody({ databaseId: undefined, parentId: undefined }),
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('databaseId');
    });

    it('returns 400 for unknown action', async () => {
      const req = makeRequest('POST', '/api/notion', {
        body: { apiKey: 'ntn_key', action: 'deleteEverything' },
      });
      const res = await handler(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Unknown action');
    });

    it('returns 400 for invalid JSON body', async () => {
      const url = 'https://takus.netlify.app/api/notion';
      const req = new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://takus.netlify.app',
        },
        body: '{bad json!!!',
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
      const req = makeRequest('GET', '/api/notion');
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it('returns 405 for PUT requests', async () => {
      const req = makeRequest('PUT', '/api/notion', {
        body: validNotionBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it('returns 405 for DELETE requests', async () => {
      const req = makeRequest('DELETE', '/api/notion');
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it('returns 204 for OPTIONS (CORS preflight)', async () => {
      const req = makeRequest('OPTIONS', '/api/notion');
      const res = await handler(req);
      expect(res.status).toBe(204);
    });
  });

  // ── Upstream error handling ───────────────────────────────────────────

  describe('Upstream error handling', () => {
    it('returns 502 when fetch throws a network error on createPage', async () => {
      mockFetch.mockRejectedValueOnce(new Error('DNS resolution failed'));

      const req = makeRequest('POST', '/api/notion', {
        body: validNotionBody(),
      });
      const res = await handler(req);
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain('DNS resolution failed');
    });

    it('returns 502 when fetch throws a network error on verify', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const req = makeRequest('POST', '/api/notion', {
        body: { apiKey: 'ntn_key', action: 'verify' },
      });
      const res = await handler(req);
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain('Connection refused');
    });
  });
});
