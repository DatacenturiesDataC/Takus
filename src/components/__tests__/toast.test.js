
// Unit tests for the Toast notification system.
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../lib/icons.js', () => ({
  icons: {
    check:         (s) => `<svg data-icon="check" width="${s}"></svg>`,
    x:             (s) => `<svg data-icon="x" width="${s}"></svg>`,
    alertTriangle: (s) => `<svg data-icon="alertTriangle" width="${s}"></svg>`,
    info:          (s) => `<svg data-icon="info" width="${s}"></svg>`,
  },
}));

vi.mock('../../lib/utils.js', () => ({
  esc: (str) => String(str ?? ''),
}));

// Dynamic import so mocks are in place first
const { showToast, toast } = await import('../toast.js');

describe('Toast Notification System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear any leftover toast containers from prior tests
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllTimers();
  });

  // ── Showing Different Toast Types ──────────────────────────────────────

  describe('Showing different toast types', () => {
    it('creates a success toast with the correct class and icon', () => {
      const el = showToast('Done', '', 'success');
      expect(el.classList.contains('toast')).toBe(true);
      expect(el.classList.contains('success')).toBe(true);
      expect(el.querySelector('.toast-icon')).toBeTruthy();
      expect(el.querySelector('[data-icon="check"]')).toBeTruthy();
    });

    it('creates an error toast with the correct class and icon', () => {
      const el = showToast('Fail', '', 'error');
      expect(el.classList.contains('error')).toBe(true);
      expect(el.querySelector('[data-icon="x"]')).toBeTruthy();
    });

    it('creates an info toast with the correct class and icon', () => {
      const el = showToast('FYI', '', 'info');
      expect(el.classList.contains('info')).toBe(true);
      expect(el.querySelector('[data-icon="info"]')).toBeTruthy();
    });

    it('creates a warning toast with the correct class and icon', () => {
      const el = showToast('Careful', '', 'warning');
      expect(el.classList.contains('warning')).toBe(true);
      expect(el.querySelector('[data-icon="alertTriangle"]')).toBeTruthy();
    });

    it('renders the title text', () => {
      const el = showToast('Hello World', '', 'info');
      expect(el.querySelector('.toast-title').textContent).toBe('Hello World');
    });

    it('renders optional message text', () => {
      const el = showToast('Title', 'Some detail', 'info');
      expect(el.querySelector('.toast-msg').textContent).toBe('Some detail');
    });

    it('omits message element when message is empty', () => {
      const el = showToast('Title', '', 'info');
      expect(el.querySelector('.toast-msg')).toBeNull();
    });
  });

  // ── Container Creation ─────────────────────────────────────────────────

  describe('Toast container', () => {
    it('creates a container in document.body on first toast', () => {
      showToast('First', '', 'info');
      const container = document.querySelector('.toast-container');
      expect(container).toBeTruthy();
      expect(container.getAttribute('role')).toBe('status');
      expect(container.getAttribute('aria-live')).toBe('polite');
    });

    it('reuses the same container for subsequent toasts', () => {
      showToast('One', '', 'info');
      showToast('Two', '', 'success');
      const containers = document.querySelectorAll('.toast-container');
      expect(containers.length).toBe(1);
    });
  });

  // ── Auto-dismiss Timing ────────────────────────────────────────────────

  describe('Auto-dismiss', () => {
    it('removes a toast after the default duration (5000 ms)', () => {
      const el = showToast('Auto', '', 'info');
      expect(el.parentNode).toBeTruthy();

      // Advance past the dismiss timeout
      vi.advanceTimersByTime(5000);
      // The dismiss function adds "removing" class, then uses a 500ms fallback
      expect(el.classList.contains('removing')).toBe(true);
      vi.advanceTimersByTime(500);
      expect(el.parentNode).toBeNull();
    });

    it('removes a toast after a custom duration', () => {
      const el = showToast('Custom', '', 'info', 1000);
      vi.advanceTimersByTime(1000);
      expect(el.classList.contains('removing')).toBe(true);
      vi.advanceTimersByTime(500);
      expect(el.parentNode).toBeNull();
    });

    it('does not auto-dismiss when duration is 0', () => {
      const el = showToast('Persist', '', 'info', 0);
      vi.advanceTimersByTime(60000); // Wait a long time
      expect(el.classList.contains('removing')).toBe(false);
      expect(el.parentNode).toBeTruthy();
    });
  });

  // ── Manual Dismiss ─────────────────────────────────────────────────────

  describe('Manual dismiss via close button', () => {
    it('adds removing class when close button is clicked', () => {
      const el = showToast('Click close', '', 'info', 0);
      const closeBtn = el.querySelector('.toast-close');
      expect(closeBtn).toBeTruthy();

      closeBtn.click();
      expect(el.classList.contains('removing')).toBe(true);
    });

    it('removes the element from DOM after close animation fallback', () => {
      const el = showToast('Click close', '', 'info', 0);
      el.querySelector('.toast-close').click();
      vi.advanceTimersByTime(500);
      expect(el.parentNode).toBeNull();
    });
  });

  // ── Queue / Max Visible Toasts ─────────────────────────────────────────

  describe('Queue behavior (max toasts cap)', () => {
    it('caps visible toasts at 5, dismissing oldest first', () => {
      // Create 6 toasts with distinct titles to avoid dedup
      for (let i = 0; i < 6; i++) {
        showToast(`Toast ${i}`, '', 'info', 0);
      }

      const container = document.querySelector('.toast-container');
      // The 6th toast triggers dismiss on the 1st; after the 500ms fallback remove
      vi.advanceTimersByTime(500);
      expect(container.children.length).toBeLessThanOrEqual(5);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────────────

  describe('Deduplication', () => {
    it('increments count badge for duplicate toasts with the same title and type', () => {
      const el1 = showToast('Dup', '', 'info', 0);
      const el2 = showToast('Dup', '', 'info', 0);

      // Should return the same element
      expect(el2).toBe(el1);
      const badge = el1.querySelector('.toast-dedup-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('×2');
    });

    it('updates the badge count on third duplicate', () => {
      const el = showToast('Triple', '', 'warning', 0);
      showToast('Triple', '', 'warning', 0);
      showToast('Triple', '', 'warning', 0);

      const badge = el.querySelector('.toast-dedup-badge');
      expect(badge.textContent).toBe('×3');
    });

    it('does not deduplicate toasts with different types', () => {
      const el1 = showToast('Same title', '', 'info', 0);
      const el2 = showToast('Same title', '', 'error', 0);
      expect(el2).not.toBe(el1);
    });

    it('updates message text on duplicate toast with new message', () => {
      const el = showToast('Update msg', 'first', 'info', 0);
      showToast('Update msg', 'second', 'info', 0);
      const msg = el.querySelector('.toast-msg');
      expect(msg.textContent).toBe('second');
    });
  });

  // ── Convenience API ────────────────────────────────────────────────────

  describe('Exported convenience API (toast object)', () => {
    it('toast.success creates a success toast', () => {
      const el = toast.success('Yay', 'It worked');
      expect(el.classList.contains('success')).toBe(true);
      expect(el.querySelector('.toast-title').textContent).toBe('Yay');
    });

    it('toast.error creates an error toast', () => {
      const el = toast.error('Oh no', 'Something broke');
      expect(el.classList.contains('error')).toBe(true);
    });

    it('toast.warning creates a warning toast', () => {
      const el = toast.warning('Heads up');
      expect(el.classList.contains('warning')).toBe(true);
    });

    it('toast.info creates an info toast', () => {
      const el = toast.info('Note');
      expect(el.classList.contains('info')).toBe(true);
    });

    it('toast.error uses a longer duration (12000 ms)', () => {
      const el = toast.error('Slow dismiss');
      // Should NOT be removing after 5 s (default)
      vi.advanceTimersByTime(5000);
      expect(el.classList.contains('removing')).toBe(false);
      // Should be removing after 12 s
      vi.advanceTimersByTime(7000);
      expect(el.classList.contains('removing')).toBe(true);
    });
  });
});
