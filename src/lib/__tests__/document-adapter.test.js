// Takus — Document Adapter Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage
vi.mock('../storage.js', () => ({
  saveEntry: vi.fn().mockResolvedValue(),
  saveEmbeddings: vi.fn().mockResolvedValue(),
  addEdge: vi.fn().mockResolvedValue(),
  getAllEmbeddings: vi.fn().mockResolvedValue([]),
}));

// Mock AI engine
vi.mock('../ai-engine.js', () => ({
  generateTranscriptionAndSummary: vi.fn().mockResolvedValue({
    transcript: 'doc text', summary: '## Doc Summary', vtt: '',
  }),
  extractTasks: vi.fn().mockResolvedValue({ takusTasks: [], meTasks: [] }),
  summarizeText: vi.fn().mockResolvedValue({ summary: '## Doc Summary' }),
}));

// Mock embeddings
vi.mock('../embeddings.js', () => ({
  embedTranscript: vi.fn().mockResolvedValue([]),
  cosineSimilarity: vi.fn().mockReturnValue(0),
}));

// Mock settings
vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn().mockReturnValue({
    aiProvider: 'openai',
    openaiKey: 'test-key',
    geminiKey: null,
  }),
}));

// Mock notification
vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

const { ingestDocument, extractTextFromFile, DocumentType } = await import('../document-adapter.js');

describe('DocumentType constants', () => {
  it('defines expected document types', () => {
    expect(DocumentType.TEXT).toBe('document');
    expect(DocumentType.MARKDOWN).toBe('markdown');
    expect(DocumentType.MEETING_NOTES).toBe('document');
    expect(DocumentType.PDF_TEXT).toBe('document');
    expect(DocumentType.EMAIL).toBe('email');
    expect(DocumentType.NOTE).toBe('note');
    expect(DocumentType.BOOKMARK).toBe('bookmark');
  });
});

describe('ingestDocument', () => {
  it('rejects empty content', async () => {
    const result = await ingestDocument({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('content is required');
  });

  it('rejects non-string content', async () => {
    const result = await ingestDocument({ content: 123 });
    expect(result.success).toBe(false);
  });

  it('ingests a valid text document', async () => {
    const result = await ingestDocument({
      title: 'Test Doc',
      content: 'Hello, this is a test document.',
      type: DocumentType.TEXT,
    }, { generateSummary: false, generateEmbeddings: false });

    expect(result.success).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry.title).toBe('Test Doc');
    expect(result.entry.textContent).toBe('Hello, this is a test document.');
    expect(result.entry.state).toBe('active');
    expect(result.entry.id).toMatch(/^doc_/);
  });

  it('defaults title to "Imported Document"', async () => {
    const result = await ingestDocument({
      content: 'Some content',
    }, { generateSummary: false, generateEmbeddings: false });

    expect(result.entry.title).toBe('Imported Document');
  });

  it('truncates very long documents', async () => {
    const longContent = 'x'.repeat(150_000);
    const result = await ingestDocument({
      title: 'Long doc',
      content: longContent,
    }, { generateSummary: false, generateEmbeddings: false });

    expect(result.success).toBe(true);
    expect(result.entry.textContent.length).toBeLessThan(longContent.length);
    expect(result.entry.textContent).toContain('[Truncated');
  });

  it('preserves tags', async () => {
    const result = await ingestDocument({
      title: 'Tagged doc',
      content: 'Hello',
      tags: ['notes', 'meeting'],
    }, { generateSummary: false, generateEmbeddings: false });

    expect(result.entry.tags).toEqual(['notes', 'meeting']);
  });
});

describe('extractTextFromFile', () => {
  it('extracts text from a .txt file', async () => {
    const file = new File(['Hello world'], 'test.txt', { type: 'text/plain' });
    const result = await extractTextFromFile(file);
    expect(result.title).toBe('test');
    expect(result.content).toBe('Hello world');
    expect(result.type).toBe(DocumentType.TEXT);
  });

  it('detects markdown files', async () => {
    const file = new File(['# Title\n\nBody text'], 'notes.md', { type: 'text/markdown' });
    const result = await extractTextFromFile(file);
    expect(result.type).toBe(DocumentType.MARKDOWN);
    expect(result.title).toBe('notes');
  });

  it('strips HTML tags from .html files', async () => {
    const html = '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p><script>alert(1)</script></body></html>';
    const file = new File([html], 'page.html', { type: 'text/html' });
    const result = await extractTextFromFile(file);
    expect(result.type).toBe(DocumentType.TEXT);
    expect(result.title).toBe('page');
    // Should strip tags and scripts
    expect(result.content).not.toContain('<h1>');
    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('alert');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('World');
  });

  it('handles .htm extension', async () => {
    const file = new File(['<p>Content</p>'], 'doc.htm', { type: 'text/html' });
    const result = await extractTextFromFile(file);
    expect(result.type).toBe(DocumentType.TEXT);
    expect(result.content).toContain('Content');
    expect(result.content).not.toContain('<p>');
  });

  it('passes CSV content through unchanged', async () => {
    const csv = 'Name,Score,Grade\nAlice,95,A\nBob,87,B+';
    const file = new File([csv], 'grades.csv', { type: 'text/csv' });
    const result = await extractTextFromFile(file);
    expect(result.type).toBe(DocumentType.TEXT);
    expect(result.title).toBe('grades');
    expect(result.content).toBe(csv);
  });

  it('parses .eml files — extracts subject and body', async () => {
    const eml = 'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Sprint Review Notes\r\n\r\nHere are the sprint review notes from today.';
    const file = new File([eml], 'sprint-review.eml', { type: 'message/rfc822' });
    const result = await extractTextFromFile(file);
    expect(result.type).toBe(DocumentType.EMAIL);
    expect(result.title).toBe('Sprint Review Notes');
    expect(result.content).toContain('sprint review notes');
  });

  it('parses .eml with LF line endings', async () => {
    const eml = 'From: a@b.com\nSubject: LF Test\n\nBody here.';
    const file = new File([eml], 'test.eml', { type: 'message/rfc822' });
    const result = await extractTextFromFile(file);
    expect(result.title).toBe('LF Test');
    expect(result.content).toContain('Body here');
  });

  it('uses filename as title when .eml has no Subject header', async () => {
    const eml = 'From: a@b.com\n\nBody only.';
    const file = new File([eml], 'no-subject.eml', { type: 'message/rfc822' });
    const result = await extractTextFromFile(file);
    expect(result.title).toBe('no-subject');
    expect(result.content).toContain('Body only');
  });

  it('handles .json files as plain text', async () => {
    const json = '{"key": "value"}';
    const file = new File([json], 'data.json', { type: 'application/json' });
    const result = await extractTextFromFile(file);
    expect(result.type).toBe(DocumentType.TEXT);
    expect(result.content).toBe(json);
  });
});
