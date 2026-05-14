// Takus — Feedback Engine Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage.js BEFORE importing feedback-engine
vi.mock('../storage.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn(),
  openDB: vi.fn(),
}));

vi.mock('../settings-store.js', () => ({
  getSettingCached: vi.fn().mockResolvedValue(null),
}));

const { getSetting } = await import('../storage.js');
const { getSettingCached } = await import('../settings-store.js');

const {
  gatherDiagnostics,
  recordError,
  getRecentErrors,
  buildFeedbackPayload,
  getFeedbackHistory,
  saveFeedbackToHistory,
} = await import('../feedback-engine.js');

describe('gatherDiagnostics', () => {
  it('returns a structured diagnostics object', async () => {
    const diag = await gatherDiagnostics();
    expect(diag).toHaveProperty('app_version');
    expect(diag).toHaveProperty('browser');
    expect(diag).toHaveProperty('os');
    expect(diag).toHaveProperty('screen');
    expect(diag).toHaveProperty('language');
    expect(diag).toHaveProperty('timestamp');
    expect(diag).toHaveProperty('online');
    expect(diag.connected_providers).toBeInstanceOf(Array);
    expect(diag.enabled_features).toBeInstanceOf(Array);
  });

  it('never includes user content fields', async () => {
    const diag = await gatherDiagnostics();
    expect(diag).not.toHaveProperty('transcript');
    expect(diag).not.toHaveProperty('summary');
    expect(diag).not.toHaveProperty('apiKey');
    expect(diag).not.toHaveProperty('token');
    expect(diag).not.toHaveProperty('password');
  });

  it('reads aiProvider key (not ai_provider) from settings cache', async () => {
    getSettingCached.mockResolvedValueOnce('gemini');
    const diag = await gatherDiagnostics();
    expect(getSettingCached).toHaveBeenCalledWith('aiProvider');
    expect(diag.ai_provider).toBe('gemini');
  });

  it('reads desktopNotifications from settings cache', async () => {
    // First call is aiProvider, second is desktopNotifications
    getSettingCached.mockResolvedValueOnce(null);
    getSettingCached.mockResolvedValueOnce(true);
    const diag = await gatherDiagnostics();
    expect(getSettingCached).toHaveBeenCalledWith('desktopNotifications');
    expect(diag.enabled_features).toContain('desktop_notifications');
  });
});

describe('recordError + getRecentErrors', () => {
  it('records and retrieves errors', () => {
    recordError('Test error message');
    const errors = getRecentErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const last = errors[errors.length - 1];
    expect(last.message).toBe('Test error message');
    expect(last.timestamp).toBeTruthy();
  });

  it('sanitizes file paths from error messages', () => {
    recordError('Error at /home/user/Documents/Codebases/Takus/src/lib/storage.js:42');
    const errors = getRecentErrors();
    const last = errors[errors.length - 1];
    expect(last.message).not.toContain('/home/user');
    expect(last.message).toContain('[path]');
  });

  it('sanitizes URLs from error messages', () => {
    recordError('Failed to fetch https://api.example.com/v1/data?token=secret123');
    const errors = getRecentErrors();
    const last = errors[errors.length - 1];
    expect(last.message).not.toContain('secret123');
    expect(last.message).toContain('[url]');
  });

  it('sanitizes email addresses', () => {
    recordError('Error for user john@example.com');
    const errors = getRecentErrors();
    const last = errors[errors.length - 1];
    expect(last.message).not.toContain('john@example.com');
    expect(last.message).toContain('[email]');
  });

  it('limits to last 10 errors on retrieval', () => {
    for (let i = 0; i < 15; i++) recordError(`Error ${i}`);
    const errors = getRecentErrors();
    expect(errors.length).toBeLessThanOrEqual(10);
  });
});

describe('buildFeedbackPayload', () => {
  it('builds a structured payload', async () => {
    const payload = await buildFeedbackPayload('bug', 'Something is broken');
    expect(payload.category).toBe('bug');
    expect(payload.description).toBe('Something is broken');
    expect(payload.timestamp).toBeTruthy();
    expect(payload.device_context).toBeTruthy();
    expect(payload.recent_errors).toBeInstanceOf(Array);
  });

  it('excludes diagnostics when opted out', async () => {
    const payload = await buildFeedbackPayload('feature_request', 'Add dark mode', {
      includeDiagnostics: false,
    });
    expect(payload.device_context).toBeUndefined();
    expect(payload.recent_errors).toBeUndefined();
  });

  it('includes contact email when provided', async () => {
    const payload = await buildFeedbackPayload('ux', 'Hard to find settings', {
      contactEmail: 'user@test.com',
    });
    expect(payload.contact_email).toBe('user@test.com');
  });

  it('truncates long descriptions', async () => {
    const long = 'x'.repeat(3000);
    const payload = await buildFeedbackPayload('other', long);
    expect(payload.description.length).toBeLessThanOrEqual(2000);
  });
});

describe('feedbackHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(getFeedbackHistory()).toEqual([]);
  });

  it('saves and retrieves entries', () => {
    saveFeedbackToHistory({ id: 'fb1', category: 'bug', description: 'test', timestamp: '2026-01-01', status: 'sent' });
    const history = getFeedbackHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('fb1');
  });

  it('orders newest first', () => {
    saveFeedbackToHistory({ id: 'fb1', timestamp: '2026-01-01' });
    saveFeedbackToHistory({ id: 'fb2', timestamp: '2026-01-02' });
    const history = getFeedbackHistory();
    expect(history[0].id).toBe('fb2');
    expect(history[1].id).toBe('fb1');
  });

  it('caps at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      saveFeedbackToHistory({ id: `fb${i}`, timestamp: `2026-01-${String(i + 1).padStart(2, '0')}` });
    }
    expect(getFeedbackHistory().length).toBe(50);
  });
});
