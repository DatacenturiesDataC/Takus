// Takus — Auto-Recording Engine (Phase 17)
// Decision logic and recording orchestration for calendar-triggered recordings.

import { notifyEphemeral } from './notification-manager.js';
import { AUTO_RECORD_PENDING } from './events.js';

/**
 * Emit a DOM event for the app-shell to show the auto-record notification.
 * This bridges the lib → component boundary without a direct import.
 * @param {import('./calendar-poller.js').NormalizedEvent} event
 */
export function emitAutoRecordPending(event) {
  document.dispatchEvent(new CustomEvent(AUTO_RECORD_PENDING, { detail: { event } }));
}

/**
 * @typedef {object} AutoRecordConfig
 * @property {boolean} autoRecordEnabled         Master toggle
 * @property {Set<string>} monitoredCalendars    Calendar IDs being monitored
 * @property {string[]} exclusionKeywords        Keywords to skip (e.g. "social", "lunch")
 * @property {number} maxConcurrent              1 or 2
 * @property {number} bufferBeforeMin            Minutes before event to start (0–5)
 * @property {number} bufferAfterMin             Minutes after event to stop (0–5)
 * @property {boolean} recordPrivateEvents       Whether to record private events
 * @property {number} maxParticipants            Skip meetings with more than N attendees (0 = no limit)
 * @property {boolean} preNotify                 Show notification before auto-start
 * @property {string[]} userEmails               All email addresses belonging to the current user
 */

/** @typedef {'RECORD'|'SKIP'|'QUEUE'} AutoRecordDecision */

/**
 * Evaluate whether an event should be auto-recorded.
 *
 * @param {import('./calendar-poller.js').NormalizedEvent} event
 * @param {AutoRecordConfig} config
 * @param {{ activeRecordingCount: number, suppressionList: Set<string> }} state
 * @returns {{ decision: AutoRecordDecision, reason: string }}
 */
export function evaluateAutoRecord(event, config, state = {}) {
  const { activeRecordingCount = 0, suppressionList = new Set() } = state;

  if (!config.autoRecordEnabled) {
    return { decision: 'SKIP', reason: 'Auto-recording is disabled' };
  }
  if (!config.monitoredCalendars?.has(event.calendarId)) {
    return { decision: 'SKIP', reason: 'Calendar not monitored' };
  }
  if (event.isAllDay) {
    return { decision: 'SKIP', reason: 'All-day event' };
  }
  if (event.status === 'cancelled' || event.status === 'free') {
    return { decision: 'SKIP', reason: `Event status: ${event.status}` };
  }
  if (!_isOrganizer(event.organizers, config.userEmails)) {
    return { decision: 'SKIP', reason: 'User is not the organizer' };
  }
  if (_containsExclusionKeyword(event.title, config.exclusionKeywords)) {
    return { decision: 'SKIP', reason: 'Title matches exclusion keyword' };
  }
  if (suppressionList.has(event.id)) {
    return { decision: 'SKIP', reason: 'User suppressed this event' };
  }
  if (!config.recordPrivateEvents && event.isPrivate) {
    return { decision: 'SKIP', reason: 'Private event (recording disabled)' };
  }
  if (config.maxParticipants > 0 && event.attendeeCount > config.maxParticipants) {
    return { decision: 'SKIP', reason: `Too many participants (${event.attendeeCount} > ${config.maxParticipants})` };
  }
  if (activeRecordingCount >= (config.maxConcurrent || 1)) {
    return { decision: 'QUEUE', reason: 'Max concurrent recordings reached' };
  }

  return { decision: 'RECORD', reason: 'All checks passed' };
}

/**
 * Check if the user is an organizer of the event.
 * Handles multiple organizers (some providers support this).
 * @param {string[]} organizers
 * @param {string[]} userEmails
 * @returns {boolean}
 */
function _isOrganizer(organizers, userEmails) {
  if (!organizers?.length || !userEmails?.length) return false;
  const normalizedUser = userEmails.map(e => e.toLowerCase());
  return organizers.some(org => normalizedUser.includes(org.toLowerCase()));
}

/**
 * Check if the event title contains any exclusion keyword.
 * @param {string} title
 * @param {string[]} keywords
 * @returns {boolean}
 */
function _containsExclusionKeyword(title, keywords) {
  if (!title || !keywords?.length) return false;
  const lower = title.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

// ── Timer Management ──────────────────────────────────────────────────────────

const _scheduledTimers = new Map(); // eventId → { notifyTimer, startTimer, stopTimer }

/**
 * Schedule a recording for an upcoming event.
 * Sets timers for: pre-notification, auto-start, and auto-stop.
 *
 * @param {import('./calendar-poller.js').NormalizedEvent} event
 * @param {AutoRecordConfig} config
 * @param {object} callbacks
 * @param {Function} callbacks.onPreNotify    Called at T - buffer to show confirm UI
 * @param {Function} callbacks.onAutoStart    Called to trigger recording (after user confirms)
 * @param {Function} callbacks.onAutoStop     Called at event.end + buffer to stop recording
 */
export function scheduleRecording(event, config, callbacks) {
  // Clear any existing schedule for this event
  cancelSchedule(event.id);

  const now = Date.now();
  const startMs = new Date(event.start).getTime();
  const endMs = new Date(event.end).getTime();
  const bufferBefore = (config.bufferBeforeMin || 1) * 60 * 1000;
  const bufferAfter = (config.bufferAfterMin || 2) * 60 * 1000;

  const notifyTime = startMs - bufferBefore - now;
  const stopTime = endMs + bufferAfter - now;

  const timers = {};

  // Pre-notification timer
  if (config.preNotify && notifyTime > 0) {
    timers.notifyTimer = setTimeout(() => {
      callbacks.onPreNotify?.(event);
    }, notifyTime);
  }

  // Auto-stop timer
  if (stopTime > 0) {
    timers.stopTimer = setTimeout(() => {
      callbacks.onAutoStop?.(event);
      _scheduledTimers.delete(event.id);
    }, stopTime);
  }

  _scheduledTimers.set(event.id, timers);
}

/** Cancel all timers for a specific event. */
export function cancelSchedule(eventId) {
  const timers = _scheduledTimers.get(eventId);
  if (timers) {
    clearTimeout(timers.notifyTimer);
    clearTimeout(timers.startTimer);
    clearTimeout(timers.stopTimer);
    _scheduledTimers.delete(eventId);
  }
}

/** Cancel all scheduled recordings. */
export function cancelAllSchedules() {
  for (const [id] of _scheduledTimers) cancelSchedule(id);
}

/** Returns the number of currently scheduled recordings. */
export function getScheduledCount() {
  return _scheduledTimers.size;
}

/**
 * Update the auto-stop timer when event end time changes.
 * (Handles the case where the organizer extends a meeting mid-recording.)
 *
 * @param {string} eventId
 * @param {Date} newEnd
 * @param {number} bufferAfterMin
 * @param {Function} onAutoStop
 */
export function updateStopTimer(eventId, newEnd, bufferAfterMin, onAutoStop) {
  const timers = _scheduledTimers.get(eventId);
  if (!timers) return;

  clearTimeout(timers.stopTimer);
  const stopTime = new Date(newEnd).getTime() + (bufferAfterMin || 2) * 60 * 1000 - Date.now();
  if (stopTime > 0) {
    timers.stopTimer = setTimeout(() => {
      onAutoStop?.({ id: eventId });
      _scheduledTimers.delete(eventId);
    }, stopTime);
  }
}

/**
 * Get the default auto-record configuration.
 * @returns {AutoRecordConfig}
 */
export function getDefaultConfig() {
  return {
    autoRecordEnabled: false,
    monitoredCalendars: new Set(),
    exclusionKeywords: [],
    maxConcurrent: 1,
    bufferBeforeMin: 1,
    bufferAfterMin: 2,
    recordPrivateEvents: false,
    maxParticipants: 0, // 0 = no limit
    preNotify: true,
    userEmails: [],
  };
}
