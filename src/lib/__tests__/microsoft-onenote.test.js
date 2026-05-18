// Takus — Microsoft OneNote Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../microsoft-auth.js', () => ({
  MicrosoftAuth: {
    getInstance: vi.fn(() => ({
      ensureValidToken: vi.fn().mockResolvedValue('ms-test-token'),
    })),
  },
}));

import { MicrosoftOneNote } from '../microsoft-onenote.js';

describe('MicrosoftOneNote', () => {
  let onenote;

  beforeEach(() => {
    onenote = new MicrosoftOneNote();
    onenote._sectionId = null;
    vi.restoreAllMocks();
  });

  it('instantiates with auth reference', () => {
    expect(onenote.auth).toBeDefined();
  });

  it('creates a meeting page and returns URL', async () => {
    // Pre-set section ID to skip _ensureSection chain
    onenote._sectionId = 'section-abc';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        links: { oneNoteWebUrl: { href: 'https://onenote.com/page/123' } },
      }),
    });

    const url = await onenote.createMeetingDoc(
      'Sprint Review',
      '## Summary\nDiscussed roadmap',
      'Alice: Hello everyone...',
      'https://onedrive.com/file/abc'
    );

    expect(url).toBe('https://onenote.com/page/123');
    expect(fetch).toHaveBeenCalledTimes(1);
    // Verify HTML content was sent
    const callArgs = fetch.mock.calls[0];
    expect(callArgs[1].headers['Content-Type']).toBe('text/html');
    expect(callArgs[1].body).toContain('Sprint Review');
  });

  it('throws on page creation failure', async () => {
    onenote._sectionId = 'section-abc';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });

    await expect(
      onenote.createMeetingDoc('Test', 'summary', 'transcript', '')
    ).rejects.toThrow('OneNote page creation failed');
  });

  it('escapes HTML in content to prevent injection', async () => {
    onenote._sectionId = 'section-abc';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ links: { oneNoteWebUrl: { href: 'https://onenote.com/page/safe' } } }),
    });

    await onenote.createMeetingDoc(
      '<script>alert("xss")</script>',
      'Summary with <b>html</b>',
      'Normal transcript',
      'https://link'
    );

    const body = fetch.mock.calls[0][1].body;
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('caches section ID for subsequent calls', async () => {
    onenote._sectionId = 'cached-section';
    expect(onenote._sectionId).toBe('cached-section');
  });
});
