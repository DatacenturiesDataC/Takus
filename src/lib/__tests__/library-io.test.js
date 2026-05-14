// Takus — Library I/O Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importLibrary } from '../library-io.js';

// Mock storage.saveRecording
vi.mock('../storage.js', () => ({
  saveRecording: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn(),
}));

// Mock notification-manager
vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

function makeFile(content) {
  return new File([content], 'test.json', { type: 'application/json' });
}

describe('importLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports valid recordings', async () => {
    const data = {
      version: 1,
      recordings: [
        { id: 'r1', date: 1700000000000, title: 'Test Recording' },
        { id: 'r2', date: 1700000001000, title: 'Another' },
      ],
    };
    const file = makeFile(JSON.stringify(data));
    const result = await importLibrary(file, []);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('skips duplicates', async () => {
    const data = {
      version: 1,
      recordings: [
        { id: 'r1', date: 1700000000000 },
        { id: 'r2', date: 1700000001000 },
      ],
    };
    const file = makeFile(JSON.stringify(data));
    const existing = [{ id: 'r1', date: 1700000000000 }];
    const result = await importLibrary(file, existing);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('skips recordings without id', async () => {
    const data = {
      version: 1,
      recordings: [
        { date: 1700000000000 },
        { id: 'r1', date: 1700000000000 },
      ],
    };
    const file = makeFile(JSON.stringify(data));
    const result = await importLibrary(file, []);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('skips recordings without date', async () => {
    const data = {
      version: 1,
      recordings: [
        { id: 'r1' },
        { id: 'r2', date: 1700000000000 },
      ],
    };
    const file = makeFile(JSON.stringify(data));
    const result = await importLibrary(file, []);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('throws on invalid JSON', async () => {
    const file = makeFile('not json at all {{{');
    await expect(importLibrary(file, [])).rejects.toThrow('Invalid file');
  });

  it('throws on missing recordings array', async () => {
    const file = makeFile(JSON.stringify({ version: 1 }));
    await expect(importLibrary(file, [])).rejects.toThrow('Not a valid Takus export file');
  });

  it('handles empty recordings array', async () => {
    const data = { version: 1, recordings: [] };
    const file = makeFile(JSON.stringify(data));
    const result = await importLibrary(file, []);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
