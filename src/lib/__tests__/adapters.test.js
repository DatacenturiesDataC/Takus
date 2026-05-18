// Tests for concrete inbound adapters: Slack, Email, Web Clipper
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SlackInboundAdapter } from '../adapters/slack-inbound.js';
import { EmailInboundAdapter } from '../adapters/email-inbound.js';
import { WebClipperAdapter } from '../adapters/web-clipper.js';

// ── Slack Adapter ──────────────────────────────────────────────────────────

describe('SlackInboundAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SlackInboundAdapter();
    vi.restoreAllMocks();
  });

  it('has correct identity', () => {
    expect(adapter.id).toBe('slack');
    expect(adapter.name).toBe('Slack');
    expect(adapter.connected).toBe(false);
  });

  it('requires token for connect', async () => {
    await expect(adapter.connect({})).rejects.toThrow('Bot Token is required');
  });

  it('requires channelIds for connect', async () => {
    // Mock fetch for auth.test
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, team: 'TestTeam', user_id: 'U123' }),
    });
    await expect(adapter.connect({ token: 'xoxb-test' })).rejects.toThrow('channel ID');
  });

  describe('normalize', () => {
    it('normalizes a Slack message', () => {
      const msg = {
        ts: '1234567890.123456',
        text: 'Let\'s ship the v2 API by Friday',
        user: 'U123',
        _channelId: 'C456',
      };

      const result = adapter.normalize(msg);

      expect(result.title).toBe("Let's ship the v2 API by Friday");
      expect(result.content).toContain('ship the v2 API');
      expect(result.type).toBe('chat');
      expect(result.source).toBe('slack');
      expect(result.sourceKey).toBe('slack:C456:1234567890.123456');
      expect(result.tags).toContain('slack');
      expect(result.metadata.channelId).toBe('C456');
      expect(result.metadata.userId).toBe('U123');
    });

    it('generates a title from channel when text is empty', () => {
      const msg = { ts: '1.2', text: '', _channelId: 'C789', user: 'U1' };
      const result = adapter.normalize(msg);
      expect(result.title).toContain('#C789');
    });

    it('converts Slack timestamp to milliseconds', () => {
      const msg = { ts: '1700000000.000000', text: 'Hello', _channelId: 'C1', user: 'U1' };
      const result = adapter.normalize(msg);
      expect(result.timestamp).toBe(1700000000 * 1000);
    });

    it('uses resolved channel name in title and tags', () => {
      // Pre-populate cache (simulating successful resolution)
      adapter._channelCache['C456'] = 'engineering';
      const msg = { ts: '1.0', text: '', _channelId: 'C456', user: 'U1' };
      const result = adapter.normalize(msg);
      expect(result.title).toContain('#engineering');
      expect(result.tags).toContain('#engineering');
      expect(result.metadata.channelName).toBe('engineering');
    });

    it('uses resolved user name in metadata', () => {
      adapter._userCache['U999'] = 'Alice Johnson';
      const msg = { ts: '1.0', text: 'Hello', _channelId: 'C1', user: 'U999' };
      const result = adapter.normalize(msg);
      expect(result.metadata.userName).toBe('Alice Johnson');
    });

    it('falls back to user ID when no cache entry', () => {
      const msg = { ts: '1.0', text: 'Hello', _channelId: 'C1', user: 'U_UNKNOWN' };
      const result = adapter.normalize(msg);
      expect(result.metadata.userName).toBe('U_UNKNOWN');
    });

    it('handles missing user gracefully', () => {
      const msg = { ts: '1.0', text: 'Bot message', _channelId: 'C1' };
      const result = adapter.normalize(msg);
      expect(result.metadata.userName).toBe('Unknown');
    });

    it('includes thread replies in content', () => {
      const msg = {
        ts: '1.0', text: 'Main message', _channelId: 'C1', user: 'U1',
        thread_ts: '1.0',
        replies: [
          { user: 'U2', text: 'Reply one' },
          { user: 'U3', text: 'Reply two' },
        ],
      };
      const result = adapter.normalize(msg);
      expect(result.content).toContain('Thread');
      expect(result.content).toContain('Reply one');
      expect(result.content).toContain('Reply two');
    });

    it('handles invalid timestamp gracefully', () => {
      const msg = { ts: 'not-a-number', text: 'Test', _channelId: 'C1', user: 'U1' };
      const result = adapter.normalize(msg);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('truncates long first lines for title', () => {
      const longText = 'A'.repeat(150) + '\nSecond line';
      const msg = { ts: '1.0', text: longText, _channelId: 'C1', user: 'U1' };
      const result = adapter.normalize(msg);
      expect(result.title.length).toBeLessThanOrEqual(100);
    });

    it('preserves reactions in metadata', () => {
      const msg = {
        ts: '1.0', text: 'Test', _channelId: 'C1', user: 'U1',
        reactions: [{ name: 'thumbsup' }, { name: 'bookmark' }],
      };
      const result = adapter.normalize(msg);
      expect(result.metadata.reactions).toEqual(['thumbsup', 'bookmark']);
    });
  });

  describe('_resolveChannelName', () => {
    it('fetches and caches channel name', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, channel: { name: 'general' } }),
      });

      const name = await adapter._resolveChannelName('C123');
      expect(name).toBe('general');
      expect(adapter._channelCache['C123']).toBe('general');
    });

    it('returns cached value on second call', async () => {
      adapter._config = { token: 'xoxb-test' };
      adapter._channelCache['C123'] = 'cached-channel';
      const spy = vi.fn();
      globalThis.fetch = spy;

      const name = await adapter._resolveChannelName('C123');
      expect(name).toBe('cached-channel');
      // fetch should not be called
      expect(spy).not.toHaveBeenCalled();
    });

    it('falls back to channel ID on API error', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }),
      });

      const name = await adapter._resolveChannelName('C_BAD');
      expect(name).toBe('C_BAD');
    });

    it('falls back to channel ID on network error', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));

      const name = await adapter._resolveChannelName('C_NET');
      expect(name).toBe('C_NET');
    });
  });

  describe('_resolveUserName', () => {
    it('fetches and caches user display name', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          user: { profile: { display_name: 'Alice' }, real_name: 'Alice Johnson', name: 'alice' },
        }),
      });

      const name = await adapter._resolveUserName('U456');
      expect(name).toBe('Alice');
      expect(adapter._userCache['U456']).toBe('Alice');
    });

    it('falls back to real_name when display_name is empty', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          user: { profile: { display_name: '' }, real_name: 'Bob Smith', name: 'bob' },
        }),
      });

      const name = await adapter._resolveUserName('U789');
      expect(name).toBe('Bob Smith');
    });

    it('falls back to username when no display or real name', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          user: { profile: {}, name: 'charlie' },
        }),
      });

      const name = await adapter._resolveUserName('U000');
      expect(name).toBe('charlie');
    });

    it('returns cached value on second call', async () => {
      adapter._config = { token: 'xoxb-test' };
      adapter._userCache['U456'] = 'Cached Alice';
      globalThis.fetch = vi.fn();

      const name = await adapter._resolveUserName('U456');
      expect(name).toBe('Cached Alice');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('falls back to user ID on API error', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: 'user_not_found' }),
      });

      const name = await adapter._resolveUserName('U_BAD');
      expect(name).toBe('U_BAD');
    });

    it('falls back to user ID on network error', async () => {
      adapter._config = { token: 'xoxb-test' };
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout'));

      const name = await adapter._resolveUserName('U_NET');
      expect(name).toBe('U_NET');
    });
  });

  describe('poll', () => {
    it('returns empty when not connected', async () => {
      const result = await adapter.poll();
      expect(result).toEqual([]);
    });

    it('fetches messages and pre-resolves names', async () => {
      // Setup connected state
      adapter._connected = true;
      adapter._config = {
        token: 'xoxb-test',
        channelIds: ['C100'],
        onlyStarred: false,
        maxMessages: 10,
      };

      const fetchCalls = [];
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        fetchCalls.push(url);
        if (url.includes('conversations.history')) {
          return Promise.resolve({
            json: () => Promise.resolve({
              ok: true,
              messages: [
                { ts: '2.0', text: 'Hello world', user: 'U1' },
                { ts: '1.0', text: 'Older msg', user: 'U2' },
              ],
            }),
          });
        }
        if (url.includes('conversations.info')) {
          return Promise.resolve({
            json: () => Promise.resolve({ ok: true, channel: { name: 'general' } }),
          });
        }
        if (url.includes('users.info')) {
          const userId = new URL(url).searchParams.get('user');
          return Promise.resolve({
            json: () => Promise.resolve({
              ok: true,
              user: { profile: { display_name: `User-${userId}` }, real_name: userId, name: userId },
            }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
      });

      const messages = await adapter.poll();

      expect(messages).toHaveLength(2);
      expect(messages[0]._channelId).toBe('C100');

      // Verify channel and user names were pre-resolved
      expect(adapter._channelCache['C100']).toBe('general');
      expect(adapter._userCache['U1']).toBe('User-U1');
      expect(adapter._userCache['U2']).toBe('User-U2');

      // Verify the resolved names flow through to normalize
      const normalized = adapter.normalize(messages[0]);
      expect(normalized.metadata.channelName).toBe('general');
      expect(normalized.metadata.userName).toBe('User-U1');
      expect(normalized.tags).toContain('#general');
    });

    it('filters to starred messages when configured', async () => {
      adapter._connected = true;
      adapter._config = {
        token: 'xoxb-test',
        channelIds: ['C100'],
        onlyStarred: true,
        maxMessages: 10,
      };

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('conversations.history')) {
          return Promise.resolve({
            json: () => Promise.resolve({
              ok: true,
              messages: [
                { ts: '3.0', text: 'Starred msg', user: 'U1', is_starred: true },
                { ts: '2.0', text: 'Bookmarked', user: 'U1', reactions: [{ name: 'bookmark' }] },
                { ts: '1.0', text: 'Normal msg', user: 'U1' },
              ],
            }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, channel: { name: 'test' }, user: { profile: {}, name: 'u' } }) });
      });

      const messages = await adapter.poll();
      expect(messages).toHaveLength(2); // Only starred + bookmarked
    });

    it('tracks latest timestamp for pagination', async () => {
      adapter._connected = true;
      adapter._config = {
        token: 'xoxb-test',
        channelIds: ['C100'],
        onlyStarred: false,
        maxMessages: 10,
      };

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('conversations.history')) {
          return Promise.resolve({
            json: () => Promise.resolve({
              ok: true,
              messages: [{ ts: '99.0', text: 'Latest', user: 'U1' }],
            }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, channel: { name: 'c' }, user: { profile: {}, name: 'u' } }) });
      });

      await adapter.poll();
      expect(adapter._lastTs).toBe('99.0');
    });

    it('handles channel API failure gracefully', async () => {
      adapter._connected = true;
      adapter._config = {
        token: 'xoxb-test',
        channelIds: ['C_FAIL'],
        onlyStarred: false,
        maxMessages: 10,
      };

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('conversations.history')) {
          return Promise.resolve({
            json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
      });

      const messages = await adapter.poll();
      expect(messages).toEqual([]);
    });
  });
});

// ── Email Adapter ──────────────────────────────────────────────────────────

describe('EmailInboundAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new EmailInboundAdapter();
  });

  it('has correct identity', () => {
    expect(adapter.id).toBe('email');
    expect(adapter.name).toBe('Email');
    expect(adapter.connected).toBe(false);
  });

  it('requires provider and auth for connect', async () => {
    await expect(adapter.connect({})).rejects.toThrow('provider is required');
    await expect(adapter.connect({ provider: 'google' })).rejects.toThrow('Auth instance');
  });

  describe('normalize', () => {
    it('normalizes an email', () => {
      const email = {
        id: 'msg_001',
        messageId: 'msg_001',
        subject: 'Sprint Planning Notes',
        from: 'alice@example.com',
        to: ['bob@example.com'],
        cc: [],
        body: 'Here are the sprint planning notes...',
        date: 1700000000000,
        threadId: 'thread_001',
        isStarred: true,
        labels: ['INBOX', 'STARRED'],
      };

      const result = adapter.normalize(email);

      expect(result.title).toBe('Sprint Planning Notes');
      expect(result.content).toContain('From: alice@example.com');
      expect(result.content).toContain('sprint planning notes');
      expect(result.type).toBe('email');
      expect(result.source).toBe('email');
      expect(result.sourceKey).toBe('email:msg_001');
      expect(result.metadata.from).toBe('alice@example.com');
      expect(result.metadata.to).toEqual(['bob@example.com']);
      expect(result.tags).toContain('email');
      expect(result.tags).toContain('from:alice@example.com');
      expect(result.timestamp).toBe(1700000000000);
    });

    it('handles email with Name <addr> format', () => {
      const email = {
        id: 'msg_002',
        subject: 'Test',
        from: 'Alice Smith <alice@example.com>',
        to: [],
        body: 'Body text',
        date: Date.now(),
      };

      const result = adapter.normalize(email);
      expect(result.tags).toContain('from:alice@example.com');
    });

    it('defaults missing subject', () => {
      const email = { id: 'x', from: '', to: [], body: 'hello', date: Date.now() };
      const result = adapter.normalize(email);
      expect(result.title).toBe('No Subject');
    });

    it('handles empty body gracefully', () => {
      const email = { id: 'e1', subject: 'Empty', from: 'a@b.com', to: [], body: '', date: Date.now() };
      const result = adapter.normalize(email);
      expect(result.content).toContain('From: a@b.com');
      expect(result.content).toContain('Subject: Empty');
    });

    it('preserves CC recipients in metadata', () => {
      const email = {
        id: 'e2', subject: 'CC test', from: 'a@b.com',
        to: ['b@c.com'], cc: ['d@e.com', 'f@g.com'],
        body: 'With CC', date: Date.now(),
      };
      const result = adapter.normalize(email);
      expect(result.metadata.cc).toEqual(['d@e.com', 'f@g.com']);
    });

    it('preserves thread and label metadata', () => {
      const email = {
        id: 'e3', subject: 'Thread test', from: 'x@y.com',
        to: [], body: 'Threaded', date: Date.now(),
        threadId: 'thr_42', labels: ['INBOX', 'IMPORTANT'],
        isStarred: true,
      };
      const result = adapter.normalize(email);
      expect(result.metadata.threadId).toBe('thr_42');
      expect(result.metadata.labels).toEqual(['INBOX', 'IMPORTANT']);
      expect(result.metadata.isStarred).toBe(true);
    });

    it('defaults missing date to now', () => {
      const before = Date.now();
      const email = { id: 'e4', subject: 'No date', from: 'x@y.com', to: [], body: 'hi' };
      const result = adapter.normalize(email);
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('includes To recipients in content', () => {
      const email = {
        id: 'e5', subject: 'Multi-to', from: 'a@b.com',
        to: ['x@y.com', 'z@w.com'], body: 'Content', date: Date.now(),
      };
      const result = adapter.normalize(email);
      expect(result.content).toContain('x@y.com, z@w.com');
    });
  });
});

// ── Web Clipper Adapter ────────────────────────────────────────────────────

describe('WebClipperAdapter', () => {
  let adapter;

  beforeEach(async () => {
    adapter = new WebClipperAdapter();
    await adapter.connect();
  });

  it('has correct identity', () => {
    expect(adapter.id).toBe('web-clipper');
    expect(adapter.name).toBe('Web Clipper');
    expect(adapter.connected).toBe(true);
  });

  it('clipFromUrl adds to pending queue', async () => {
    adapter.clipFromUrl({
      url: 'https://example.com/article',
      title: 'Example Article',
      content: 'Full article text here...',
    });

    const items = await adapter.poll();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Example Article');
    expect(items[0].url).toBe('https://example.com/article');

    // Poll again — queue should be empty
    const items2 = await adapter.poll();
    expect(items2).toHaveLength(0);
  });

  it('clipFromUrl requires url or content', () => {
    expect(() => adapter.clipFromUrl({})).toThrow('url or content');
  });

  it('clipFromUrl extracts title from URL when not provided', () => {
    adapter.clipFromUrl({ url: 'https://example.com/my-great-article' });
    const items = adapter._pendingClips;
    expect(items[0].title).toBe('my great article');
  });

  describe('normalize', () => {
    it('normalizes a web clip', () => {
      const clip = {
        url: 'https://docs.example.com/api-guide',
        title: 'API Guide',
        content: 'This is the API documentation...',
        timestamp: 1700000000000,
      };

      const result = adapter.normalize(clip);

      expect(result.title).toBe('API Guide');
      expect(result.content).toContain('Source: https://docs.example.com/api-guide');
      expect(result.content).toContain('API documentation');
      expect(result.type).toBe('bookmark');
      expect(result.source).toBe('web-clipper');
      expect(result.sourceKey).toMatch(/^clip:/);
      expect(result.tags).toContain('web-clip');
      expect(result.tags).toContain('docs.example.com');
      expect(result.metadata.url).toBe('https://docs.example.com/api-guide');
    });

    it('handles clip without URL', () => {
      const clip = { content: 'Some selected text', timestamp: Date.now() };
      const result = adapter.normalize(clip);
      expect(result.title).toBe('Web Clip');
      expect(result.type).toBe('bookmark');
    });

    it('marks selectedText clips in metadata', () => {
      const clip = {
        url: 'https://example.com/page',
        selectedText: 'A selected paragraph from the article',
        timestamp: Date.now(),
      };
      const result = adapter.normalize(clip);
      expect(result.metadata.hasSelection).toBe(true);
      expect(result.content).toContain('selected paragraph');
    });

    it('includes author when provided', () => {
      const clip = {
        url: 'https://blog.example.com/post',
        title: 'Blog Post',
        content: 'Article body',
        author: 'Jane Smith',
        timestamp: Date.now(),
      };
      const result = adapter.normalize(clip);
      expect(result.content).toContain('Author: Jane Smith');
      expect(result.metadata.author).toBe('Jane Smith');
    });

    it('extracts domain tag from URL', () => {
      const clip = {
        url: 'https://github.com/takus/repo/issues/42',
        content: 'Issue details',
        timestamp: Date.now(),
      };
      const result = adapter.normalize(clip);
      expect(result.tags).toContain('github.com');
    });

    it('handles content-only clips (no URL)', () => {
      const clip = { content: 'Quick note from browser', timestamp: Date.now() };
      const result = adapter.normalize(clip);
      expect(result.content).toBe('Quick note from browser');
      expect(result.tags).toContain('web-clip');
      // No domain tag when no URL
      expect(result.tags).toHaveLength(1);
    });
  });

  it('clipFromUrl accepts content-only clips', () => {
    adapter.clipFromUrl({ content: 'Just text, no URL' });
    expect(adapter._pendingClips).toHaveLength(1);
    expect(adapter._pendingClips[0].content).toBe('Just text, no URL');
  });

  it('handles multiple clips in queue', async () => {
    adapter.clipFromUrl({ url: 'https://a.com', content: 'A' });
    adapter.clipFromUrl({ url: 'https://b.com', content: 'B' });
    adapter.clipFromUrl({ url: 'https://c.com', content: 'C' });

    const items = await adapter.poll();
    expect(items).toHaveLength(3);
    // Queue is cleared after poll
    expect(adapter._pendingClips).toHaveLength(0);
  });

  it('connect with allowed origins stores config', async () => {
    const restricted = new WebClipperAdapter();
    await restricted.connect({ allowedOrigins: ['https://takus.app'] });
    expect(restricted.connected).toBe(true);
    expect(restricted._config.allowedOrigins).toEqual(['https://takus.app']);
  });

  it('disconnect removes listener and clears queue', async () => {
    adapter.clipFromUrl({ url: 'https://example.com', content: 'test' });
    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
    expect(adapter._pendingClips).toHaveLength(0);
  });
});
