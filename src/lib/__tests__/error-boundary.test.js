// Tests for error-boundary.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock notification-manager module
vi.mock('../../lib/notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

import { installErrorBoundary } from '../../lib/error-boundary.js';
import { notifyEphemeral } from '../../lib/notification-manager.js';

describe('error-boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installErrorBoundary();
  });

  it('shows toast on unhandled rejection', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('Test failure') });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    expect(notifyEphemeral).toHaveBeenCalledWith('Unexpected error', 'Test failure', 'error');
  });

  it('suppresses ResizeObserver loop errors', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'ResizeObserver loop completed with undelivered notifications.' });
    window.dispatchEvent(event);
    expect(notifyEphemeral).not.toHaveBeenCalled();
  });

  it('suppresses cross-origin script errors', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'Script error.' });
    window.dispatchEvent(event);
    expect(notifyEphemeral).not.toHaveBeenCalled();
  });

  it('truncates long error messages', () => {
    const longMsg = 'A'.repeat(200);
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error(longMsg) });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    const call = notifyEphemeral.mock.calls[0];
    expect(call[1].length).toBeLessThanOrEqual(120);
    expect(call[1]).toContain('…');
  });
});
