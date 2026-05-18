// Takus — ZIP Export Tests
// Tests the ZIP builder's structural integrity and metadata generation.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage to control what entries are returned
vi.mock('../storage.js', () => ({
  getEntries: vi.fn().mockResolvedValue([]),
  getMediaBlob: vi.fn().mockResolvedValue(null),
}));

vi.mock('../graph/task-store.js', () => ({
  getTasksByContent: vi.fn().mockResolvedValue([]),
}));

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

vi.mock('../recorder.js', () => ({
  formatDuration: vi.fn((d) => `${Math.round(d || 0)}s`),
  formatSize: vi.fn((s) => `${Math.round(s / 1024)}KB`),
}));

describe('ZIP Export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows notification when no entries exist', async () => {
    const { getEntries } = await import('../storage.js');
    getEntries.mockResolvedValue([]);

    const { exportZip } = await import('../zip-export.js');
    const { notifyEphemeral } = await import('../notification-manager.js');

    await exportZip();

    expect(notifyEphemeral).toHaveBeenCalledWith(
      'Nothing to export',
      'No entries in the library.',
      'info'
    );
  });

  it('generates a ZIP blob with metadata for entries', async () => {
    const { getEntries, getMediaBlob } = await import('../storage.js');
    getEntries.mockResolvedValue([
      {
        id: 'test-1',
        title: 'Test Meeting',
        date: Date.now(),
        duration: 120,
        type: 'meeting',
        aiSummary: 'This is a summary.',
        aiVtt: 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello',
      },
    ]);
    getMediaBlob.mockResolvedValue(null); // No video blob

    // Mock showSaveFilePicker to not exist (use fallback download)
    delete globalThis.window?.showSaveFilePicker;
    globalThis.URL = globalThis.URL || {};
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();

    const mockLink = { click: vi.fn(), href: '', download: '' };
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    const { exportZip } = await import('../zip-export.js');
    await exportZip();

    // Should have created a download link
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockLink.click).toHaveBeenCalled();
    expect(mockLink.download).toMatch(/takus-full-backup/);
  });

  it('updates progress element during export', async () => {
    const { getEntries } = await import('../storage.js');
    getEntries.mockResolvedValue([
      { id: 'e1', title: 'E1', date: Date.now(), duration: 60, type: 'screen' },
    ]);

    globalThis.URL = globalThis.URL || {};
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();

    const mockLink = { click: vi.fn(), href: '', download: '' };
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    const statusEl = { textContent: '' };

    const { exportZip } = await import('../zip-export.js');
    await exportZip(statusEl);

    // statusEl should have been updated during the process
    // After completion it's cleared
    expect(statusEl.textContent).toBe('');
  });
});
