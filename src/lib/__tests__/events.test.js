// Takus — Events Constants Tests (Phase 69)
import { describe, it, expect } from 'vitest';
import {
  OPEN_RECORDING,
  DATE_FILTER,
  VAULT_SYNC_COMPLETE,
  CLOUD_CONNECTED,
  AUTO_RECORD_PENDING,
  NOTIFY,
} from '../events.js';

describe('Events Constants', () => {
  it('exports all required event names as strings', () => {
    expect(typeof OPEN_RECORDING).toBe('string');
    expect(typeof DATE_FILTER).toBe('string');
    expect(typeof VAULT_SYNC_COMPLETE).toBe('string');
    expect(typeof CLOUD_CONNECTED).toBe('string');
    expect(typeof AUTO_RECORD_PENDING).toBe('string');
    expect(typeof NOTIFY).toBe('string');
  });

  it('event names follow takus: prefix convention', () => {
    expect(OPEN_RECORDING).toMatch(/^takus:/);
    expect(DATE_FILTER).toMatch(/^takus:/);
    expect(VAULT_SYNC_COMPLETE).toMatch(/^takus:/);
    expect(CLOUD_CONNECTED).toMatch(/^takus:/);
    expect(AUTO_RECORD_PENDING).toMatch(/^takus:/);
    expect(NOTIFY).toMatch(/^takus:/);
  });

  it('all event names are unique', () => {
    const names = [OPEN_RECORDING, DATE_FILTER, VAULT_SYNC_COMPLETE, CLOUD_CONNECTED, AUTO_RECORD_PENDING, NOTIFY];
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('can be used to dispatch and listen for events', () => {
    const handler = vi.fn();
    document.addEventListener(OPEN_RECORDING, handler);
    document.dispatchEvent(new CustomEvent(OPEN_RECORDING, { detail: { id: 'r1' } }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.id).toBe('r1');
    document.removeEventListener(OPEN_RECORDING, handler);
  });
});

// Need vi for the dispatch test
import { vi } from 'vitest';
