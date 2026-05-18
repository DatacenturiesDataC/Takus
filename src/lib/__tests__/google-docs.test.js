// Takus — Google Docs Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../google-auth.js', () => ({
  GoogleAuth: {
    getInstance: vi.fn(() => ({
      loadAPI: vi.fn().mockResolvedValue(),
      ensureValidToken: vi.fn().mockResolvedValue('test-token'),
    })),
  },
}));

vi.mock('../task-helpers.js', () => ({
  getTaskTitle: vi.fn((t) => t.title || 'Untitled'),
  isStepDone: vi.fn((s) => s.done === true),
}));

import { GoogleDocs } from '../google-docs.js';

describe('GoogleDocs', () => {
  let docs;

  beforeEach(() => {
    docs = new GoogleDocs();
    vi.restoreAllMocks();
  });

  it('instantiates with auth reference', () => {
    expect(docs.auth).toBeDefined();
  });

  it('creates a meeting doc and returns URL', async () => {
    globalThis.fetch = vi.fn()
      // First call: create document
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ documentId: 'doc-123' }),
      })
      // Second call: batch update formatting
      .mockResolvedValueOnce({ ok: true });

    const url = await docs.createMeetingDoc(
      'Sprint Review',
      '## Summary\n- Discussed roadmap',
      'Alice: Hello everyone...',
      'https://drive.google.com/file/abc'
    );

    expect(url).toBe('https://docs.google.com/document/d/doc-123/edit');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on doc creation failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Permission denied'),
    });

    await expect(
      docs.createMeetingDoc('Test', 'summary', 'transcript', '')
    ).rejects.toThrow('Failed to create Google Doc');
  });

  it('includes tasks in the document', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ documentId: 'doc-tasks' }),
      })
      .mockResolvedValueOnce({ ok: true });

    const url = await docs.createMeetingDoc(
      'Meeting',
      'Summary text',
      'Transcript text',
      'https://link',
      {
        takusTasks: [{ title: 'Follow up with team', status: 'pending' }],
        meTasks: [],
      }
    );

    expect(url).toContain('doc-tasks');
    // Verify the batch update includes task content
    const batchCall = fetch.mock.calls[1];
    const body = JSON.parse(batchCall[1].body);
    expect(body.requests[0].insertText.text).toContain('Follow up with team');
  });
});
