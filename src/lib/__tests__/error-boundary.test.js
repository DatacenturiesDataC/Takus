// Tests for error-boundary.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock toast module
vi.mock('../../components/toast.js', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import { installErrorBoundary } from '../../lib/error-boundary.js';
import { toast } from '../../components/toast.js';

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
    expect(toast.error).toHaveBeenCalledWith('Unexpected error', 'Test failure');
  });

  it('suppresses ResizeObserver loop errors', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'ResizeObserver loop completed with undelivered notifications.' });
    window.dispatchEvent(event);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('suppresses cross-origin script errors', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'Script error.' });
    window.dispatchEvent(event);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('truncates long error messages', () => {
    const longMsg = 'A'.repeat(200);
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error(longMsg) });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    const call = toast.error.mock.calls[0];
    expect(call[1].length).toBeLessThanOrEqual(120);
    expect(call[1]).toContain('…');
  });
});
