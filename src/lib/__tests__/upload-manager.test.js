// Takus — Upload Manager Unit Tests (retry logic)
import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../upload-manager.js';

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
