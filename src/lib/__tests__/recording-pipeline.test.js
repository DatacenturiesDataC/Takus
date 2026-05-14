// Tests for recording-pipeline.js — pure helpers & orchestration guards
import { describe, it, expect, vi, beforeEach } from 'vitest';

// extractTitleFromSummary is the main pure-function export worth testing
// The rest are async orchestrators that need heavy mocking

vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({
    aiProvider: 'openai',
    openaiKey: 'sk-test',
    geminiKey: '',
    desktopNotifications: false,
  })),
  initSettings: vi.fn(),
  getShortcuts: vi.fn(),
  restoreSettingsFromCloud: vi.fn(),
}));

vi.mock('../recording-types.js', () => ({
  typeLabel: vi.fn((t) => t === 'meeting' ? 'Meeting' : 'Screen Recording'),
}));

vi.mock('../utils.js', () => ({
  shortDate: vi.fn(() => '2026-05-14'),
  shortTime: vi.fn(() => '10:30'),
}));

vi.mock('../storage.js', () => ({
  saveRecording: vi.fn(),
  addEdge: vi.fn(),
  getAllEmbeddings: vi.fn(() => []),
  saveEmbeddings: vi.fn(),
  saveInteraction: vi.fn(),
  saveContentItem: vi.fn(),
  saveEngagementEvent: vi.fn(),
  getContacts: vi.fn(() => []),
}));

vi.mock('../ffmpeg-engine.js', () => ({
  extractAudio: vi.fn(),
}));

vi.mock('../ai-engine.js', () => ({
  generateTranscriptionAndSummary: vi.fn(),
  extractTasks: vi.fn(() => ({ takusTasks: [], meTasks: [] })),
}));

vi.mock('../embeddings.js', () => ({
  embedTranscript: vi.fn(() => []),
  cosineSimilarity: vi.fn(() => 0),
}));

vi.mock('../analytics.js', () => ({
  analyzeFillerWords: vi.fn(() => ({})),
  computeQualityScore: vi.fn(() => 80),
  isUrgentUpdate: vi.fn(() => false),
  buildUrgentUpdateSlackPayload: vi.fn(),
}));

vi.mock('../integration-config.js', () => ({
  getIntegrationConfig: vi.fn(() => ({ configured: false })),
}));

vi.mock('../integrations/slack.js', () => ({
  postToSlack: vi.fn(),
}));

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

import { extractTitleFromSummary, processAI, syncAIArtefactsToCloud, autoRouteUrgentUpdate } from '../recording-pipeline.js';
import { getSettings } from '../settings-store.js';
import { extractAudio } from '../ffmpeg-engine.js';
import { generateTranscriptionAndSummary } from '../ai-engine.js';
import { postToSlack } from '../integrations/slack.js';

describe('extractTitleFromSummary', () => {
  it('returns null for empty/null summary', () => {
    expect(extractTitleFromSummary(null, 'screen')).toBeNull();
    expect(extractTitleFromSummary('', 'screen')).toBeNull();
    expect(extractTitleFromSummary(undefined, 'screen')).toBeNull();
  });

  it('extracts title from # heading', () => {
    const summary = '# Weekly Team Standup\nThis meeting covered sprints.';
    expect(extractTitleFromSummary(summary, 'meeting')).toBe('Weekly Team Standup');
  });

  it('extracts title from ## heading', () => {
    const summary = '## Sprint Planning Session\nDetails below.';
    expect(extractTitleFromSummary(summary, 'meeting')).toBe('Sprint Planning Session');
  });

  it('extracts title from ### heading', () => {
    const summary = '### Q3 Review\nSome notes.';
    expect(extractTitleFromSummary(summary, 'meeting')).toBe('Q3 Review');
  });

  it('strips bold markers from heading', () => {
    const summary = '# **Important Meeting**\nNotes.';
    expect(extractTitleFromSummary(summary, 'meeting')).toBe('Important Meeting');
  });

  it('strips markdown links from heading', () => {
    const summary = '# Review of [Project Alpha](https://example.com)\nNotes.';
    expect(extractTitleFromSummary(summary, 'meeting')).toBe('Review of Project Alpha');
  });

  it('truncates headings longer than 80 chars', () => {
    const longTitle = 'A'.repeat(100);
    const summary = `# ${longTitle}\nBody.`;
    const result = extractTitleFromSummary(summary, 'meeting');
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('…')).toBe(true);
  });

  it('falls back to first non-heading line', () => {
    const summary = 'This is a plain text summary without headings.\nSecond line.';
    expect(extractTitleFromSummary(summary, 'screen')).toBe('This is a plain text summary without headings.');
  });

  it('skips table lines for fallback', () => {
    const summary = '| Col1 | Col2 |\n| --- | --- |\nActual content here.';
    expect(extractTitleFromSummary(summary, 'screen')).toBe('Actual content here.');
  });

  it('strips list markers from fallback line', () => {
    const summary = '- First bullet point about the project\nSecond line.';
    expect(extractTitleFromSummary(summary, 'screen')).toBe('First bullet point about the project');
  });

  it('falls back to type-based timestamp when no usable text', () => {
    const summary = '# Hi\nAb';  // heading < 5 chars, fallback line < 5 chars
    const result = extractTitleFromSummary(summary, 'meeting');
    expect(result).toBe('Meeting — 2026-05-14 10:30');
  });

  it('ignores heading shorter than 5 chars', () => {
    const summary = '# Hi\nThis is the actual summary content line.';
    expect(extractTitleFromSummary(summary, 'meeting')).toBe('This is the actual summary content line.');
  });
});

describe('processAI', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('exits early if no API key', async () => {
    getSettings.mockReturnValueOnce({ aiProvider: 'openai', openaiKey: '', geminiKey: '' });
    const entry = { id: 'r1' };
    await processAI(new Blob(), entry);
    expect(extractAudio).not.toHaveBeenCalled();
  });

  it('calls onPhase during processing', async () => {
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'hello world',
      summary: '# Test\nSummary.',
      vtt: 'WEBVTT\n',
    });

    const phases = [];
    const entry = { id: 'r2', type: 'meeting' };
    await processAI(new Blob(), entry, {
      onPhase: (label) => phases.push(label),
      onComplete: () => {},
    });

    expect(phases).toContain('Extracting audio…');
    expect(phases).toContain('Transcribing audio…');
    expect(phases.length).toBeGreaterThanOrEqual(3);
  });

  it('auto-generates title from summary', async () => {
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'test transcript',
      summary: '# Sprint Review\nGood progress.',
      vtt: '',
    });

    const entry = { id: 'r3', title: 'Untitled Recording' };
    await processAI(new Blob(), entry, { onComplete: () => {} });
    expect(entry.title).toBe('Sprint Review');
  });

  it('does not overwrite custom title', async () => {
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'test',
      summary: '# AI Generated Title\nBody.',
      vtt: '',
    });

    const entry = { id: 'r4', title: 'My Custom Title' };
    await processAI(new Blob(), entry, { onComplete: () => {} });
    expect(entry.title).toBe('My Custom Title');
  });
});

describe('syncAIArtefactsToCloud', () => {
  it('exits early if no cloud provider', async () => {
    await syncAIArtefactsToCloud({ id: 'r1' }, () => null);
    // Should not throw
  });

  it('exits early if no folder ID', async () => {
    const mockProvider = {
      auth: { isConnected: true },
      storage: { uploadSmallFile: vi.fn() },
    };
    await syncAIArtefactsToCloud({ id: 'r1' }, () => mockProvider);
    expect(mockProvider.storage.uploadSmallFile).not.toHaveBeenCalled();
  });

  it('uploads summary, VTT, metadata, and tasks', async () => {
    const upload = vi.fn(() => Promise.resolve());
    const mockProvider = {
      auth: { isConnected: true },
      storage: { uploadSmallFile: upload },
    };
    const entry = {
      id: 'r5',
      title: 'Test',
      date: '2026-01-01',
      duration: 60,
      aiSummary: '# Summary',
      aiVtt: 'WEBVTT',
      driveFolderId: 'folder123',
      tasks: { takusTasks: [{ id: 't1' }], meTasks: [] },
    };
    await syncAIArtefactsToCloud(entry, () => mockProvider);
    expect(upload).toHaveBeenCalledTimes(4); // summary.md + transcript.vtt + metadata.json + tasks.json
  });
});

describe('autoRouteUrgentUpdate', () => {
  it('does nothing if slack not configured', async () => {
    await autoRouteUrgentUpdate({ id: 'r6', title: 'Urgent' });
    expect(postToSlack).not.toHaveBeenCalled();
  });
});
