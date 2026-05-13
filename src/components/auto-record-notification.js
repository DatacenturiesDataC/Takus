// Takus — Auto-Record Notification (Phase 17)
// Pre-start confirmation modal that appears T-1 minute before a scheduled recording.
// Auto-dismisses and starts recording after 30 seconds unless user cancels.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';

/** @type {HTMLElement|null} */
let _activeNotification = null;
let _countdownTimer = null;
let _countdownValue = 30;

/**
 * Show the pre-recording notification modal.
 *
 * @param {import('../lib/calendar-poller.js').NormalizedEvent} event
 * @param {object} callbacks
 * @param {Function} callbacks.onConfirm   User confirms → start recording
 * @param {Function} callbacks.onDismiss   User cancels → skip this recording
 * @param {Function} callbacks.onSuppress  User wants to suppress future auto-records for this event
 * @param {number}   autoStartSeconds      Countdown before auto-start (default 30)
 */
export function showAutoRecordNotification(event, callbacks, autoStartSeconds = 30) {
  // Remove any existing notification
  hideAutoRecordNotification();

  _countdownValue = autoStartSeconds;

  const overlay = document.createElement('div');
  overlay.id = 'auto-record-notification';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Auto-recording confirmation');
  overlay.style.cssText = [
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;',
    'z-index:var(--z-modal);padding:var(--space-4);',
    'background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);',
    'animation:fade-in 0.3s ease;',
  ].join('');

  const startTime = event.start ? new Date(event.start) : null;
  const timeStr = startTime ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const attendeeText = event.attendeeCount > 1 ? `${event.attendeeCount} attendees` : '1 attendee';

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:440px;text-align:center;padding:var(--space-8) var(--space-6);">
      <!-- Pulsing recording indicator -->
      <div style="display:flex;justify-content:center;margin-bottom:var(--space-4);">
        <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#ef4444,#dc2626);display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(239,68,68,0.3);animation:record-pulse 2s ease-in-out infinite;">
          ${icons.video(22)}
        </div>
      </div>

      <h3 style="font-size:var(--font-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);margin-bottom:var(--space-2);">
        Recording Starting Soon
      </h3>

      <div style="display:flex;flex-direction:column;gap:var(--space-1);margin-bottom:var(--space-5);">
        <span style="font-size:var(--font-base);font-weight:var(--weight-semi);color:var(--color-text-primary);">
          ${esc(event.title || 'Untitled Meeting')}
        </span>
        <span style="font-size:var(--font-sm);color:var(--color-text-secondary);">
          ${timeStr}${event.attendeeCount ? ` · ${attendeeText}` : ''}
        </span>
        ${event.conferenceUrl ? `<span style="font-size:var(--font-xs);color:var(--color-primary-light);">🔗 Conference link detected</span>` : ''}
      </div>

      <!-- Countdown -->
      <div style="margin-bottom:var(--space-5);">
        <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-2);">
          Auto-starting in
        </div>
        <div id="auto-record-countdown" style="font-size:var(--font-3xl);font-weight:var(--weight-heavy);color:var(--color-recording);font-variant-numeric:tabular-nums;">
          ${_countdownValue}s
        </div>
        <!-- Visual countdown bar -->
        <div style="width:80%;margin:var(--space-2) auto 0;height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
          <div id="auto-record-bar" style="height:100%;width:100%;background:linear-gradient(90deg,var(--color-recording),#f97316);border-radius:2px;transition:width 1s linear;"></div>
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;">
        <button class="btn btn-primary btn-lg" id="auto-record-confirm" style="min-width:140px;">
          ${icons.video(16)} Start Now
        </button>
        <button class="btn btn-ghost" id="auto-record-dismiss">
          ${icons.x(14)} Skip
        </button>
      </div>

      <button class="btn btn-ghost btn-sm" id="auto-record-suppress" style="margin-top:var(--space-4);font-size:var(--font-xs);color:var(--color-text-disabled);">
        Don't auto-record this event
      </button>
    </div>`;

  document.body.appendChild(overlay);
  _activeNotification = overlay;

  // Focus the confirm button for accessibility
  setTimeout(() => overlay.querySelector('#auto-record-confirm')?.focus(), 50);

  // Start countdown
  _countdownTimer = setInterval(() => {
    _countdownValue--;
    const countdownEl = overlay.querySelector('#auto-record-countdown');
    const barEl = overlay.querySelector('#auto-record-bar');
    if (countdownEl) countdownEl.textContent = `${_countdownValue}s`;
    if (barEl) barEl.style.width = `${(_countdownValue / autoStartSeconds) * 100}%`;

    if (_countdownValue <= 0) {
      hideAutoRecordNotification();
      callbacks.onConfirm?.(event);
    }
  }, 1000);

  // Button bindings
  overlay.querySelector('#auto-record-confirm')?.addEventListener('click', () => {
    hideAutoRecordNotification();
    callbacks.onConfirm?.(event);
  });

  overlay.querySelector('#auto-record-dismiss')?.addEventListener('click', () => {
    hideAutoRecordNotification();
    callbacks.onDismiss?.(event);
  });

  overlay.querySelector('#auto-record-suppress')?.addEventListener('click', () => {
    hideAutoRecordNotification();
    callbacks.onSuppress?.(event);
  });

  // Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      hideAutoRecordNotification();
      callbacks.onDismiss?.(event);
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/** Remove the notification and clear countdown. */
export function hideAutoRecordNotification() {
  if (_countdownTimer) {
    clearInterval(_countdownTimer);
    _countdownTimer = null;
  }
  if (_activeNotification) {
    _activeNotification.remove();
    _activeNotification = null;
  }
  _countdownValue = 30;
}

/** Returns whether a notification is currently displayed. */
export function isNotificationActive() {
  return _activeNotification !== null;
}
