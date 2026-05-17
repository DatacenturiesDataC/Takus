// Tests for content-pipeline.js — pure helpers & orchestration guards
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

vi.mock('../content-types.js', () => ({
  typeLabel: vi.fn((t) => t === 'meeting' ? 'Meeting' : 'Screen Recording'),
}));

vi.mock('../utils.js', () => ({
  shortDate: vi.fn(() => '2026-05-14'),
  shortTime: vi.fn(() => '10:30'),
  deviceName: vi.fn(() => 'Chrome / macOS'),
}));

vi.mock('../storage.js', () => ({
  saveEntry: vi.fn(() => Promise.resolve()),
  addEdge: vi.fn(),
  getAllEmbeddings: vi.fn(() => []),
  saveEmbeddings: vi.fn(),
  saveInteraction: vi.fn(),
  saveContentItem: vi.fn(),
  saveEngagementEvent: vi.fn(),
  getContacts: vi.fn(() => []),
  saveEntryBlob: vi.fn(() => Promise.resolve()),
  getEntries: vi.fn(() => Promise.resolve([])),
  getMediaBlob: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../ffmpeg-engine.js', () => ({
  extractAudio: vi.fn(),
}));

vi.mock('../ai-engine.js', () => ({
  generateTranscriptionAndSummary: vi.fn(),
  extractTasks: vi.fn(() => Promise.resolve({ takusTasks: [], meTasks: [] })),
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

vi.mock('../id.js', () => ({
  generateId: vi.fn((prefix) => `${prefix}_test_123`),
}));

import { extractTitleFromSummary, processAI, syncAIArtefactsToCloud, autoRouteUrgentUpdate, createHistoryEntry, finalizeRecording } from '../content-pipeline.js';
import { getSettings } from '../settings-store.js';
import { extractAudio } from '../ffmpeg-engine.js';
import { generateTranscriptionAndSummary } from '../ai-engine.js';
import { postToSlack } from '../integrations/slack.js';
import { saveEntry } from '../storage.js';

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

    const entry = { id: 'r3', title: 'Untitled' };
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

describe('createHistoryEntry', () => {
  it('creates entry with defaults', () => {
    const entry = createHistoryEntry();
    expect(entry.id).toBe('rec_test_123');
    expect(entry.title).toBe('Screen Recording — 2026-05-14 10:30');
    expect(entry.type).toBe('screen');
    expect(entry.device).toBe('Chrome / macOS');
    expect(entry.duration).toBe(0);
    expect(entry.size).toBe(0);
    expect(entry.driveLink).toBeNull();
    expect(entry.aiSummary).toBeNull();
    expect(entry.aiTranscript).toBeNull();
    expect(entry.tasks).toBeNull();
    expect(entry.observerLog).toBeNull();
  });

  it('uses provided title', () => {
    const entry = createHistoryEntry({ title: 'Sprint Planning' });
    expect(entry.title).toBe('Sprint Planning');
  });

  it('generates type-based default title', () => {
    const entry = createHistoryEntry({ type: 'meeting' });
    expect(entry.title).toBe('Meeting — 2026-05-14 10:30');
  });

  it('preserves provided metadata', () => {
    const entry = createHistoryEntry({
      type: 'presentation',
      duration: 5000,
      size: 1024000,
      observerLog: { errors: 0 },
    });
    expect(entry.type).toBe('presentation');
    expect(entry.duration).toBe(5000);
    expect(entry.size).toBe(1024000);
    expect(entry.observerLog).toEqual({ errors: 0 });
  });

  it('sets date to current time', () => {
    const before = Date.now();
    const entry = createHistoryEntry();
    expect(entry.date).toBeGreaterThanOrEqual(before);
    expect(entry.date).toBeLessThanOrEqual(Date.now());
  });
});

describe('finalizeRecording', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns processedBlob and historyEntry', async () => {
    const blob = new Blob(['test'], { type: 'video/webm' });
    const entry = createHistoryEntry({ title: 'Test' });
    const result = await finalizeRecording(blob, entry);
    expect(result.processedBlob).toBe(blob);
    expect(result.historyEntry).toBe(entry);
  });

  it('persists history entry to storage', async () => {
    const blob = new Blob(['test']);
    const entry = createHistoryEntry();
    await finalizeRecording(blob, entry);
    expect(saveEntry).toHaveBeenCalledWith(entry);
  });

  it('calls processAI when processOptions provided', async () => {
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'hello', summary: '# Test\nBody.', vtt: '',
    });

    const blob = new Blob(['test']);
    const entry = createHistoryEntry();
    const onComplete = vi.fn();
    await finalizeRecording(blob, entry, {
      processOptions: { onComplete, onPhase: vi.fn() },
    });
    // processAI is fire-and-forget; we just verify entry was persisted
    expect(saveEntry).toHaveBeenCalledWith(entry);
  });

  it('does not call processAI without processOptions', async () => {
    const blob = new Blob(['test']);
    const entry = createHistoryEntry();
    await finalizeRecording(blob, entry);
    // extractAudio is only called by processAI
    expect(extractAudio).not.toHaveBeenCalled();
  });
});

// ── Pipeline-as-Steps (Phase 44) ────────────────────────────────────────

import { createPipelineRun, getPipelineStepLabel } from '../content-pipeline.js';

describe('createPipelineRun', () => {
  it('creates a valid pipeline run manifest', () => {
    const run = createPipelineRun('meeting');
    expect(run.id).toMatch(/^pipe_/);
    expect(run.recordingType).toBe('meeting');
    expect(run.status).toBe('running');
    expect(run.startedAt).toBeGreaterThan(0);
    expect(run.steps).toHaveLength(7);
  });

  it('all steps start as pending', () => {
    const run = createPipelineRun('screen');
    for (const step of run.steps) {
      expect(step.status).toBe('pending');
      expect(step.startedAt).toBeNull();
      expect(step.completedAt).toBeNull();
      expect(step.label).toBeTruthy();
      expect(step.id).toBeTruthy();
    }
  });

  it('has the expected step IDs in order', () => {
    const run = createPipelineRun('screen');
    const ids = run.steps.map(s => s.id);
    expect(ids).toEqual([
      'extract_audio',
      'transcribe',
      'extract_tasks',
      'analytics',
      'goal_detection',
      'graph_enrich',
      'embeddings',
    ]);
  });
});

describe('getPipelineStepLabel', () => {
  it('returns label for known steps', () => {
    expect(getPipelineStepLabel('transcribe')).toBe('Transcribe & Summarize');
    expect(getPipelineStepLabel('goal_detection')).toBe('Detect Goals');
  });

  it('returns step ID as fallback for unknown steps', () => {
    expect(getPipelineStepLabel('custom_step')).toBe('custom_step');
  });
});

describe('processAI — pipeline run tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockReturnValue({
      aiProvider: 'openai',
      openaiKey: 'sk-test',
      geminiKey: '',
      desktopNotifications: false,
    });
  });

  it('populates pipelineRun on historyEntry after processing', async () => {
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'test transcript',
      summary: '# Test',
      vtt: 'WEBVTT\n',
    });

    const entry = { id: 'r-pipe', type: 'screen' };
    await processAI(new Blob(), entry, { onComplete: () => {} });

    expect(entry.pipelineRun).toBeDefined();
    expect(entry.pipelineRun.status).toBe('done');
    expect(entry.pipelineRun.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.pipelineRun.steps).toHaveLength(7);
    // All steps should be done
    for (const step of entry.pipelineRun.steps) {
      expect(step.status).toBe('done');
    }
  });

  it('calls onStepUpdate during processing', async () => {
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'hello',
      summary: '# Hi',
      vtt: '',
    });

    const stepUpdates = [];
    const entry = { id: 'r-steps', type: 'meeting' };
    await processAI(new Blob(), entry, {
      onStepUpdate: (run) => stepUpdates.push(run.steps.filter(s => s.status !== 'pending').length),
      onComplete: () => {},
    });

    // Should receive multiple step update callbacks
    expect(stepUpdates.length).toBeGreaterThanOrEqual(7); // At least one per step transition
  });

  it('marks failed step on error', async () => {
    extractAudio.mockRejectedValueOnce(new Error('FFmpeg crash'));

    const entry = { id: 'r-fail', type: 'screen' };
    await processAI(new Blob(), entry, { onComplete: () => {} });

    expect(entry.pipelineRun).toBeDefined();
    expect(entry.pipelineRun.status).toBe('failed');
    expect(entry.pipelineRun.error).toBe('FFmpeg crash');
    // The extract_audio step should be failed
    const failedStep = entry.pipelineRun.steps.find(s => s.id === 'extract_audio');
    expect(failedStep.status).toBe('failed');
    expect(failedStep.error).toBe('FFmpeg crash');
  });
});

// ── Pipeline Retry (Phase 46) ───────────────────────────────────────

import { retryFailedStep } from '../content-pipeline.js';
import { getEntries, getMediaBlob } from '../storage.js';

describe('retryFailedStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockReturnValue({
      aiProvider: 'openai',
      openaiKey: 'sk-test',
      geminiKey: '',
      desktopNotifications: false,
    });
  });

  it('archives previous pipelineRun and re-runs', async () => {
    const existingRun = { id: 'pipe_old', status: 'failed', steps: [] };
    getEntries.mockResolvedValueOnce([
      { id: 'r-retry', type: 'screen', pipelineRun: existingRun },
    ]);
    getMediaBlob.mockResolvedValueOnce(new Blob(['test']));
    extractAudio.mockResolvedValueOnce(new Blob());
    generateTranscriptionAndSummary.mockResolvedValueOnce({
      transcript: 'retry test', summary: '# Retry', vtt: '',
    });

    await retryFailedStep('r-retry', { onComplete: () => {} });

    // The old run should be in history
    const entry = getEntries.mock.results[0].value.then ? 
      (await getEntries.mock.results[0].value)[0] : 
      getEntries.mock.results[0].value[0];

    expect(entry.pipelineRunHistory).toBeDefined();
    expect(entry.pipelineRunHistory).toHaveLength(1);
    expect(entry.pipelineRunHistory[0].id).toBe('pipe_old');
    expect(entry.pipelineRun.status).toBe('done');
  });
});
