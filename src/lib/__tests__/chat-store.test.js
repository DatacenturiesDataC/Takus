// Tests for chat-store.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage module
vi.mock('../storage.js', () => ({
  saveWikiEntry: vi.fn(async () => {}),
  getWikiEntries: vi.fn(async () => []),
  deleteWikiEntry: vi.fn(async () => {}),
}));

vi.mock('../id.js', () => ({
  generateId: vi.fn((prefix) => `${prefix}_test_123`),
}));

import { createThread, saveThread, getThreads, getLegacyWiki, deleteThread } from '../chat-store.js';
import { saveWikiEntry, getWikiEntries, deleteWikiEntry } from '../storage.js';

describe('chat-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createThread', () => {
    it('creates a thread with correct structure', () => {
      const thread = createThread('Hello, what did I discuss last week?');
      expect(thread.id).toBe('chat_test_123');
      expect(thread.isThread).toBe(true);
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0].role).toBe('user');
      expect(thread.messages[0].content).toBe('Hello, what did I discuss last week?');
      expect(thread.subject).toBe('Hello, what did I discuss last week?');
      expect(thread.query).toBe('Hello, what did I discuss last week?');
    });

    it('truncates long subjects to 60 chars', () => {
      const longMsg = 'A'.repeat(100);
      const thread = createThread(longMsg);
      expect(thread.subject.length).toBe(60);
    });

    it('handles empty message with default subject', () => {
      const thread = createThread('');
      expect(thread.subject).toBe('New conversation');
    });
  });

  describe('saveThread', () => {
    it('calls saveWikiEntry with updated date', async () => {
      const thread = createThread('Test message');
      thread.messages.push({ role: 'assistant', content: 'AI response', timestamp: Date.now() });
      await saveThread(thread);

      expect(saveWikiEntry).toHaveBeenCalledTimes(1);
      const saved = saveWikiEntry.mock.calls[0][0];
      expect(saved.query).toBe('Test message');
      expect(saved.answer).toBe('AI response');
    });

    it('syncs wiki-compat fields from latest messages', async () => {
      const thread = createThread('First question');
      thread.messages.push({ role: 'assistant', content: 'First answer', timestamp: Date.now() });
      thread.messages.push({ role: 'user', content: 'Follow-up question', timestamp: Date.now() });
      thread.messages.push({ role: 'assistant', content: 'Follow-up answer', timestamp: Date.now() });

      await saveThread(thread);
      const saved = saveWikiEntry.mock.calls[0][0];
      expect(saved.query).toBe('Follow-up question');
      expect(saved.answer).toBe('Follow-up answer');
    });
  });

  describe('getThreads', () => {
    it('returns only thread entries', async () => {
      getWikiEntries.mockResolvedValue([
        { id: '1', isThread: true, query: 'q1' },
        { id: '2', query: 'q2' }, // legacy wiki (no isThread)
        { id: '3', isThread: true, query: 'q3' },
      ]);

      const threads = await getThreads();
      expect(threads).toHaveLength(2);
      expect(threads[0].id).toBe('1');
      expect(threads[1].id).toBe('3');
    });

    it('returns empty array on error', async () => {
      getWikiEntries.mockRejectedValue(new Error('IDB error'));
      const threads = await getThreads();
      expect(threads).toEqual([]);
    });
  });

  describe('getLegacyWiki', () => {
    it('returns only non-thread entries', async () => {
      getWikiEntries.mockResolvedValue([
        { id: '1', isThread: true, query: 'q1' },
        { id: '2', query: 'q2' },
        { id: '3', query: 'q3' },
      ]);

      const wiki = await getLegacyWiki();
      expect(wiki).toHaveLength(2);
      expect(wiki[0].id).toBe('2');
    });
  });

  describe('deleteThread', () => {
    it('delegates to deleteWikiEntry', async () => {
      await deleteThread('thread_123');
      expect(deleteWikiEntry).toHaveBeenCalledWith('thread_123');
    });
  });
});
