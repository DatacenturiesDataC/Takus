// Tests for ingestContent() — canonical ingestion API
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage
vi.mock('../storage.js', () => ({
  saveEntry: vi.fn().mockResolvedValue(undefined),
  getEntries: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  saveEmbeddings: vi.fn().mockResolvedValue(undefined),
  getAllEmbeddings: vi.fn().mockResolvedValue([]),
  addEdge: vi.fn().mockResolvedValue(undefined),
}));

// Mock settings
vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({ aiProvider: null, openaiKey: null, geminiKey: null })),
}));

// Mock inbox
vi.mock('../inbox.js', () => ({
  submitToInbox: vi.fn().mockReturnValue({ action: 'hold', item: {} }),
}));

// Mock notification-manager
vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

// Mock id generator
vi.mock('../id.js', () => ({
  generateId: vi.fn((prefix) => `${prefix}_test_123`),
}));

import { ingestContent } from '../content-pipeline.js';
import { saveEntry } from '../storage.js';
import { submitToInbox } from '../inbox.js';

describe('ingestContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws without content string', async () => {
    await expect(ingestContent({})).rejects.toThrow('requires a content string');
    await expect(ingestContent({ content: 123 })).rejects.toThrow('requires a content string');
  });

  it('creates an entry from normalized content', async () => {
    const content = {
      title: 'Sprint Retro Notes',
      content: 'We discussed improvements to our CI pipeline...',
      type: 'document',
      source: 'slack',
      sourceKey: 'slack:C123:1234.5678',
      metadata: { channelId: 'C123' },
      tags: ['slack', '#engineering'],
      timestamp: 1700000000000,
    };

    const result = await ingestContent(content);

    expect(result.entry).toBeDefined();
    expect(result.entry.title).toBe('Sprint Retro Notes');
    expect(result.entry.type).toBe('document');
    expect(result.entry.source).toBe('slack');
    expect(result.entry.sourceKey).toBe('slack:C123:1234.5678');
    expect(result.entry.tags).toEqual(['slack', '#engineering']);
    expect(result.entry.textContent).toContain('CI pipeline');
    expect(result.entry.state).toBe('raw');
    expect(result.action).toBe('hold');
  });

  it('persists entry to storage', async () => {
    await ingestContent({
      title: 'Test',
      content: 'Hello world',
      type: 'note',
      source: 'test',
      sourceKey: 'test:1',
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    });

    expect(saveEntry).toHaveBeenCalled();
    const savedEntry = saveEntry.mock.calls[0][0];
    expect(savedEntry.title).toBe('Test');
    expect(savedEntry.type).toBe('note');
  });

  it('routes through inbox submitToInbox', async () => {
    await ingestContent({
      title: 'Inbox Test',
      content: 'Content for inbox routing',
      type: 'email',
      source: 'email',
      sourceKey: 'email:msg_001',
      metadata: { from: 'alice@example.com' },
      tags: ['email'],
      timestamp: Date.now(),
    });

    expect(submitToInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'email',
        type: 'email',
        title: 'Inbox Test',
      })
    );
  });

  it('generates correct ID prefix per type', async () => {
    const emailResult = await ingestContent({
      title: 'Email',
      content: 'Email body',
      type: 'email',
      source: 'email',
      sourceKey: 'email:1',
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    });
    expect(emailResult.entry.id).toBe('eml_test_123');

    const chatResult = await ingestContent({
      title: 'Chat',
      content: 'Chat message',
      type: 'chat',
      source: 'slack',
      sourceKey: 'slack:1',
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    });
    expect(chatResult.entry.id).toBe('chat_test_123');

    const docResult = await ingestContent({
      title: 'Doc',
      content: 'Document text',
      type: 'document',
      source: 'web-clipper',
      sourceKey: 'clip:1',
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    });
    expect(docResult.entry.id).toBe('doc_test_123');
  });

  it('auto-processes when auto-run rule matches', async () => {
    submitToInbox.mockReturnValueOnce({ action: 'auto-process', item: {} });

    const result = await ingestContent({
      title: 'Auto-processed',
      content: 'This matches a rule',
      type: 'document',
      source: 'test',
      sourceKey: 'test:auto',
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    });

    expect(result.action).toBe('auto-process');
    // Entry should be saved twice (initial + state update to 'processing')
    expect(saveEntry).toHaveBeenCalledTimes(2);
    const secondSave = saveEntry.mock.calls[1][0];
    expect(secondSave.state).toBe('processing');
  });

  it('defaults missing fields', async () => {
    const result = await ingestContent({
      content: 'Minimal content',
    });

    expect(result.entry.title).toBe('Untitled');
    expect(result.entry.type).toBe('document');
    expect(result.entry.source).toBeNull();
    expect(result.entry.tags).toEqual([]);
    expect(result.entry.timestamp || result.entry.date).toBeDefined();
  });
});
