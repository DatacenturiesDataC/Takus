// Takus — Upload Manager Unit Tests
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { withRetry, uploadToCloud, retryableUpload, downloadMP4, downloadGIF, resilientUpload } from '../upload-manager.js';

vi.mock('../ffmpeg-engine.js', () => ({
  convertToMP4: vi.fn(() => Promise.resolve(new Blob(['mp4'], { type: 'video/mp4' }))),
  convertToGIF: vi.fn(() => Promise.resolve(new Blob(['gif'], { type: 'image/gif' }))),
}));

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

vi.mock('../offline-queue.js', () => ({
  registerQueueHandler: vi.fn(),
  enqueue: vi.fn(() => Promise.resolve('op-123')),
}));

import { convertToMP4, convertToGIF } from '../ffmpeg-engine.js';
import { notifyEphemeral } from '../notification-manager.js';
import { enqueue } from '../offline-queue.js';

vi.mock('../storage.js', () => ({
  saveEntry: vi.fn(() => Promise.resolve()),
  saveVaultSync: vi.fn(() => Promise.resolve()),
}));
vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({ autoCopyLink: false })),
}));
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ calendar: { enabled: false } })),
  isMicrosoftConfigured: vi.fn(() => false),
}));

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 2, baseMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    await expect(withRetry(fn, { maxRetries: 2, baseMs: 10 }))
      .rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry 4xx errors', async () => {
    const err = new Error('bad request');
    err.status = 400;
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxRetries: 3, baseMs: 10 }))
      .rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1); // no retries
  });

  it('calls onRetry callback before each retry', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('err1'))
      .mockRejectedValueOnce(new Error('err2'))
      .mockResolvedValue('ok');
    await withRetry(fn, { maxRetries: 3, baseMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error));
  });

  it('passes attempt number to fn', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    await withRetry(fn, { maxRetries: 1, baseMs: 10 });
    expect(fn).toHaveBeenCalledWith(0);
    expect(fn).toHaveBeenCalledWith(1);
  });
});

describe('uploadToCloud', () => {
  const makeProvider = (link = 'https://drive.google.com/file/123') => ({
    name: 'Google Drive',
    storage: {
      uploadResumable: vi.fn().mockResolvedValue({ link }),
    },
  });

  it('uploads and returns drive link', async () => {
    const provider = makeProvider();
    const blob = new Blob(['test']);
    const entry = { id: 'rec_1', title: 'Test' };
    const result = await uploadToCloud({ blob, filename: 'test.webm', historyEntry: entry, provider });
    expect(result.link).toBe('https://drive.google.com/file/123');
    expect(provider.storage.uploadResumable).toHaveBeenCalled();
  });

  it('throws on missing blob', async () => {
    const provider = makeProvider();
    await expect(uploadToCloud({ blob: null, filename: 'x.webm', historyEntry: {}, provider }))
      .rejects.toThrow('No blob to upload');
  });

  it('throws on missing provider', async () => {
    const blob = new Blob(['test']);
    await expect(uploadToCloud({ blob, filename: 'x.webm', historyEntry: {}, provider: null }))
      .rejects.toThrow('No cloud provider connected');
  });

  it('calls onProgress callback', async () => {
    const provider = makeProvider();
    // Override to call onProgress
    provider.storage.uploadResumable = vi.fn(async (blob, filename, onProgress) => {
      onProgress(50, 100);
      return { link: 'https://example.com' };
    });
    const onProgress = vi.fn();
    const blob = new Blob(['test']);
    await uploadToCloud({ blob, filename: 'test.webm', historyEntry: {}, provider }, { onProgress });
    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });
});

describe('retryableUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls uploadFn with blob and filename', async () => {
    const uploadFn = vi.fn(() => Promise.resolve({ link: 'https://...' }));
    const blob = new Blob(['data']);
    await retryableUpload(uploadFn, blob, 'test.webm', vi.fn());
    expect(uploadFn).toHaveBeenCalledWith(blob, 'test.webm', expect.any(Function));
  });

  it('retries on upload failure then succeeds', async () => {
    let calls = 0;
    const uploadFn = vi.fn(() => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('net'));
      return Promise.resolve({ link: 'ok' });
    });
    const result = await retryableUpload(uploadFn, new Blob(), 'f.webm', vi.fn());
    expect(result.link).toBe('ok');
    expect(uploadFn).toHaveBeenCalledTimes(2);
  });

  it('notifies on retry attempts', async () => {
    let calls = 0;
    const uploadFn = vi.fn(() => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('net'));
      return Promise.resolve({ link: 'ok' });
    });
    await retryableUpload(uploadFn, new Blob(), 'f.webm', vi.fn());
    expect(notifyEphemeral).toHaveBeenCalledWith('Retrying upload', expect.stringContaining('Attempt'), 'info');
  });
});

describe('downloadMP4', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns early if blob is null', async () => {
    await downloadMP4(null, 'test.webm');
    expect(convertToMP4).not.toHaveBeenCalled();
  });

  it('calls convertToMP4 and notifies', async () => {
    const blob = new Blob(['data'], { type: 'video/webm' });
    await downloadMP4(blob, 'recording.webm');
    expect(convertToMP4).toHaveBeenCalledWith(blob);
    expect(notifyEphemeral).toHaveBeenCalledWith('Converting to MP4', expect.any(String), 'info');
  });

  it('notifies on conversion failure', async () => {
    convertToMP4.mockRejectedValueOnce(new Error('codec error'));
    const blob = new Blob(['data']);
    await downloadMP4(blob, 'test.webm');
    expect(notifyEphemeral).toHaveBeenCalledWith('MP4 conversion failed', 'codec error', 'error');
  });
});

describe('downloadGIF', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns early if blob is null', async () => {
    await downloadGIF(null, 'test.webm');
    expect(convertToGIF).not.toHaveBeenCalled();
  });

  it('calls convertToGIF and notifies', async () => {
    const blob = new Blob(['data'], { type: 'video/webm' });
    await downloadGIF(blob, 'recording.webm');
    expect(convertToGIF).toHaveBeenCalledWith(blob);
    expect(notifyEphemeral).toHaveBeenCalledWith('Converting to GIF', expect.any(String), 'info');
  });

  it('notifies on conversion failure', async () => {
    convertToGIF.mockRejectedValueOnce(new Error('frame error'));
    const blob = new Blob(['data']);
    await downloadGIF(blob, 'test.webm');
    expect(notifyEphemeral).toHaveBeenCalledWith('GIF conversion failed', 'frame error', 'error');
  });
});

describe('resilientUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns upload result on success', async () => {
    const provider = {
      storage: { uploadResumable: vi.fn().mockResolvedValue({ link: 'https://ok' }) },
    };
    const result = await resilientUpload({
      blob: new Blob(['data']),
      filename: 'test.webm',
      historyEntry: { id: 'rec-1' },
      provider,
    });
    expect(result.link).toBe('https://ok');
  });

  it('re-throws non-network errors', async () => {
    await expect(resilientUpload({
      blob: null,
      filename: 'test.webm',
      historyEntry: { id: 'rec-1' },
      provider: { storage: {} },
    })).rejects.toThrow('No blob');
  });
});
