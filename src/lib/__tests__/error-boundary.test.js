// Tests for error-boundary.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock notification-manager module
vi.mock('../../lib/notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

vi.mock('../../lib/feedback-engine.js', () => ({
  recordError: vi.fn(),
}));

import { installErrorBoundary, _resetForTesting } from '../../lib/error-boundary.js';
import { notifyEphemeral } from '../../lib/notification-manager.js';
import { recordError } from '../../lib/feedback-engine.js';

describe('error-boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    installErrorBoundary();
  });

  it('shows toast on unhandled rejection', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('Test failure') });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    expect(notifyEphemeral).toHaveBeenCalledWith('Unexpected error', 'Test failure', 'error');
  });

  it('records error on unhandled rejection', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('Tracked error') });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    expect(recordError).toHaveBeenCalledWith('Tracked error');
  });

  it('suppresses ResizeObserver loop errors', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'ResizeObserver loop completed with undelivered notifications.' });
    window.dispatchEvent(event);
    expect(notifyEphemeral).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
  });

  it('suppresses cross-origin script errors', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'Script error.' });
    window.dispatchEvent(event);
    expect(notifyEphemeral).not.toHaveBeenCalled();
  });

  it('suppresses ChunkLoadError', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'ChunkLoadError: Loading chunk 5 failed.' });
    window.dispatchEvent(event);
    expect(notifyEphemeral).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
  });

  it('suppresses Non-Error promise rejection', () => {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: 'Non-Error promise rejection captured' });
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

  it('prevents default for AbortError rejections', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('AbortError: The operation was aborted') });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('prevents default for NotAllowedError rejections', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('NotAllowedError: Permission denied') });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('handles null/undefined reason gracefully', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: null });
    event.preventDefault = vi.fn();
    window.dispatchEvent(event);
    // Should not crash
  });
});
