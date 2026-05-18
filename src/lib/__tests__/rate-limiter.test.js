// Takus — Rate Limiter Tests
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureLimit,
  check,
  consume,
  waitAndConsume,
  getUsage,
  resetLimit,
  resetAllLimits,
  removeLimit,
  getAllLimits,
} from '../rate-limiter.js';

describe('Rate Limiter', () => {
  beforeEach(() => {
    resetAllLimits();
  });

  describe('configureLimit', () => {
    it('configures a rate limit', () => {
      configureLimit('test', { maxRequests: 5, windowMs: 60000 });
      const limits = getAllLimits();
      expect(limits).toHaveLength(1);
      expect(limits[0].key).toBe('test');
      expect(limits[0].maxRequests).toBe(5);
    });
  });

  describe('check', () => {
    it('allows requests when unconfigured', () => {
      const result = check('unknown');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('allows requests under limit', () => {
      configureLimit('api', { maxRequests: 3, windowMs: 60000 });
      const result = check('api');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });

    it('does not consume slots', () => {
      configureLimit('api', { maxRequests: 2, windowMs: 60000 });
      check('api');
      check('api');
      check('api');
      // All checks, no consumes — should still have full remaining
      expect(check('api').remaining).toBe(2);
    });
  });

  describe('consume', () => {
    it('consumes a slot and decrements remaining', () => {
      configureLimit('api', { maxRequests: 3, windowMs: 60000 });
      const r1 = consume('api');
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = consume('api');
      expect(r2.remaining).toBe(1);

      const r3 = consume('api');
      expect(r3.remaining).toBe(0);
    });

    it('blocks when limit is exhausted', () => {
      configureLimit('api', { maxRequests: 1, windowMs: 60000 });
      consume('api');

      const blocked = consume('api');
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it('allows after window expires', async () => {
      configureLimit('fast', { maxRequests: 1, windowMs: 50 }); // 50ms window
      consume('fast');

      // Wait for window to expire
      await new Promise(r => setTimeout(r, 60));

      const result = consume('fast');
      expect(result.allowed).toBe(true);
    });
  });

  describe('waitAndConsume', () => {
    it('returns immediately when slot is available', async () => {
      configureLimit('api', { maxRequests: 5, windowMs: 60000 });
      const result = await waitAndConsume('api');
      expect(result.allowed).toBe(true);
      expect(result.waited).toBeLessThan(100);
    });

    it('waits and retries when limit is hit', async () => {
      configureLimit('tight', { maxRequests: 1, windowMs: 50 });
      consume('tight');

      const result = await waitAndConsume('tight', 200);
      expect(result.allowed).toBe(true);
      expect(result.waited).toBeGreaterThanOrEqual(40);
    });

    it('times out when limit cannot be satisfied', async () => {
      configureLimit('blocked', { maxRequests: 1, windowMs: 10000 });
      consume('blocked');

      const result = await waitAndConsume('blocked', 50);
      expect(result.allowed).toBe(false);
    });
  });

  describe('getUsage', () => {
    it('returns zeroes for unconfigured keys', () => {
      const u = getUsage('none');
      expect(u.used).toBe(0);
      expect(u.limit).toBe(0);
    });

    it('tracks usage accurately', () => {
      configureLimit('api', { maxRequests: 10, windowMs: 60000 });
      consume('api');
      consume('api');
      consume('api');

      const u = getUsage('api');
      expect(u.used).toBe(3);
      expect(u.limit).toBe(10);
      expect(u.remaining).toBe(7);
    });
  });

  describe('resetLimit', () => {
    it('clears usage for a specific key', () => {
      configureLimit('api', { maxRequests: 2, windowMs: 60000 });
      consume('api');
      consume('api');
      expect(consume('api').allowed).toBe(false);

      resetLimit('api');
      expect(consume('api').allowed).toBe(true);
    });
  });

  describe('removeLimit', () => {
    it('removes config and window', () => {
      configureLimit('api', { maxRequests: 1, windowMs: 60000 });
      consume('api');
      removeLimit('api');

      // After removal, no limit applies
      expect(check('api').allowed).toBe(true);
      expect(check('api').remaining).toBe(Infinity);
    });
  });

  describe('getAllLimits', () => {
    it('returns all configured limits', () => {
      configureLimit('a', { maxRequests: 5, windowMs: 1000 });
      configureLimit('b', { maxRequests: 10, windowMs: 2000 });

      const limits = getAllLimits();
      expect(limits).toHaveLength(2);
      expect(limits.map(l => l.key)).toEqual(expect.arrayContaining(['a', 'b']));
    });
  });
});
