// Takus — Inbox Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auto-runs module
let mockAutoRunResult = { shouldProcess: false };
vi.mock('../auto-runs.js', () => ({
  evaluateAutoRuns: vi.fn(() => mockAutoRunResult),
}));

const {
  submitToInbox,
  processInboxItem,
  completeInboxItem,
  failInboxItem,
  onInboxEvent,
} = await import('../inbox.js');

beforeEach(() => {
  mockAutoRunResult = { shouldProcess: false };
});

describe('submitToInbox', () => {
  it('creates an inbox item with defaults', () => {
    const { item } = submitToInbox({ title: 'Test Recording' });
    expect(item.id).toMatch(/^inbox_/);
    expect(item.title).toBe('Test Recording');
    expect(item.state).toBe('inbox');
    expect(item.appId).toBe('unknown');
    expect(item.createdAt).toBeGreaterThan(0);
    expect(item.metadata).toEqual({});
  });

  it('preserves provided fields', () => {
    const { item } = submitToInbox({
      id: 'custom-id',
      appId: 'recorder',
      type: 'recording',
      title: 'Sprint Planning',
      metadata: { duration: 3600 },
    });
    expect(item.id).toBe('custom-id');
    expect(item.appId).toBe('recorder');
    expect(item.type).toBe('recording');
    expect(item.metadata.duration).toBe(3600);
  });

  it('holds items when no Auto-Run matches', () => {
    mockAutoRunResult = { shouldProcess: false };
    const result = submitToInbox({ title: 'Screen recording' });
    expect(result.action).toBe('hold');
    expect(result.item.state).toBe('inbox');
    expect(result.matchedRule).toBeUndefined();
  });

  it('auto-processes items when Auto-Run matches', () => {
    const rule = { id: 'ar_1', label: 'Process meetings' };
    mockAutoRunResult = { shouldProcess: true, matchedRule: rule };
    const result = submitToInbox({ type: 'meeting', title: 'Standup' });
    expect(result.action).toBe('auto-process');
    expect(result.item.state).toBe('processing');
    expect(result.item.matchedRuleId).toBe('ar_1');
    expect(result.matchedRule).toBe(rule);
  });
});

describe('item state transitions', () => {
  it('processInboxItem sets state to processing', () => {
    const { item } = submitToInbox({ title: 'Test' });
    expect(item.state).toBe('inbox');
    processInboxItem(item);
    expect(item.state).toBe('processing');
  });

  it('completeInboxItem sets state to processed', () => {
    const { item } = submitToInbox({ title: 'Test' });
    processInboxItem(item);
    completeInboxItem(item);
    expect(item.state).toBe('processed');
  });

  it('failInboxItem sets state to error with message', () => {
    const { item } = submitToInbox({ title: 'Test' });
    processInboxItem(item);
    failInboxItem(item, 'Transcription failed');
    expect(item.state).toBe('error');
    expect(item.metadata.error).toBe('Transcription failed');
  });
});

describe('inbox events', () => {
  it('emits inbox:received for held items', () => {
    const events = [];
    const unsub = onInboxEvent((event, item) => events.push({ event, item }));
    mockAutoRunResult = { shouldProcess: false };

    submitToInbox({ title: 'Held item' });
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('inbox:received');
    expect(events[0].item.title).toBe('Held item');
    unsub();
  });

  it('emits inbox:auto-processed for matched items', () => {
    const events = [];
    const unsub = onInboxEvent((event) => events.push(event));
    mockAutoRunResult = { shouldProcess: true, matchedRule: { id: 'r1' } };

    submitToInbox({ title: 'Auto item' });
    expect(events).toContain('inbox:auto-processed');
    unsub();
  });

  it('emits inbox:processing on manual process', () => {
    const events = [];
    const unsub = onInboxEvent((event) => events.push(event));

    const { item } = submitToInbox({ title: 'Manual' });
    events.length = 0; // clear received event
    processInboxItem(item);
    expect(events).toContain('inbox:processing');
    unsub();
  });

  it('emits inbox:completed on complete', () => {
    const events = [];
    const unsub = onInboxEvent((event) => events.push(event));

    const { item } = submitToInbox({ title: 'Complete' });
    events.length = 0;
    completeInboxItem(item);
    expect(events).toContain('inbox:completed');
    unsub();
  });

  it('emits inbox:error on failure', () => {
    const events = [];
    const unsub = onInboxEvent((event) => events.push(event));

    const { item } = submitToInbox({ title: 'Fail' });
    events.length = 0;
    failInboxItem(item, 'error');
    expect(events).toContain('inbox:error');
    unsub();
  });

  it('unsubscribe stops events', () => {
    const events = [];
    const unsub = onInboxEvent((event) => events.push(event));
    unsub();

    submitToInbox({ title: 'After unsub' });
    expect(events).toHaveLength(0);
  });

  it('listener errors do not break inbox', () => {
    const unsub = onInboxEvent(() => { throw new Error('Bad listener'); });
    expect(() => submitToInbox({ title: 'Robust' })).not.toThrow();
    unsub();
  });
});
