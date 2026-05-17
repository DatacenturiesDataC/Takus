// Takus — Calendar Poller (Phase 17: Auto-Recording Engine)
// Multi-provider calendar polling with event deduplication.

/**
 * @typedef {object} NormalizedEvent
 * @property {string} id             Provider-specific event ID
 * @property {string} title          Event title/summary
 * @property {Date}   start          Event start time
 * @property {Date}   end            Event end time
 * @property {string} status         'confirmed'|'tentative'|'cancelled'|'free'
 * @property {boolean} isAllDay      True if this is an all-day event
 * @property {Array<string>} organizers  Organizer email(s)
 * @property {Array<string>} attendees  Attendee emails
 * @property {string|null} conferenceUrl  Meeting link (Zoom, Meet, Teams)
 * @property {string} calendarId     Which calendar this event belongs to
 * @property {string} provider       'google'|'microsoft'
 * @property {boolean} isPrivate     Whether the event is marked private/confidential
 * @property {number} attendeeCount  Number of attendees
 */

let _pollTimer = null;
let _listeners = [];
let _latestEvents = [];

/**
 * Start polling calendars at a given interval.
 *
 * @param {Function} fetchEventsFn   Async function(calendarId, provider, hoursAhead) → NormalizedEvent[]
 * @param {Array<{calendarId: string, provider: string}>} selectedCalendars
 * @param {object} options
 * @param {number} options.intervalMs   Polling interval (default 5 min)
 * @param {number} options.hoursAhead   How far ahead to look (default 24)
 */
export function startPolling(fetchEventsFn, selectedCalendars, options = {}) {
  const { intervalMs = 5 * 60 * 1000, hoursAhead = 24 } = options;

  stopPolling(); // Clear any existing timer

  const poll = async () => {
    try {
      const allEvents = [];
      for (const cal of selectedCalendars) {
        const events = await fetchEventsFn(cal.calendarId, cal.provider, hoursAhead);
        allEvents.push(...events);
      }
      const deduped = deduplicateEvents(allEvents);
      _emitEvents(deduped);
    } catch (e) {
      console.warn('[CalendarPoller] Poll failed:', e.message);
    }
  };

  // Initial poll immediately
  poll();
  _pollTimer = setInterval(poll, intervalMs);
}

/** Stop the polling timer. */
export function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

/** @returns {boolean} Whether polling is active */
export function isPolling() {
  return _pollTimer !== null;
}

/**
 * Subscribe to polled events. Returns an unsubscribe function.
 * @param {Function} fn  Called with (events: NormalizedEvent[]) on each poll
 * @returns {Function}
 */
export function onEvents(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Get the most recent set of polled calendar events.
 * Returns an empty array if polling has not yet produced results.
 * @returns {NormalizedEvent[]}
 */
export function getLatestEvents() {
  return [..._latestEvents];
}

function _emitEvents(events) {
  _latestEvents = events;
  for (const fn of _listeners) {
    try { fn(events); } catch (e) { console.warn('[CalendarPoller] Listener error:', e); }
  }
}

/**
 * Deduplicate events from multiple calendars.
 * Uses 3-of-4 matching criteria:
 *   1. Same organizer email (case-insensitive)
 *   2. Identical title + start time (±1 minute)
 *   3. Same conference URL
 *   4. Same unique event ID
 *
 * @param {NormalizedEvent[]} events
 * @returns {NormalizedEvent[]}
 */
export function deduplicateEvents(events) {
  const seen = [];
  const result = [];

  for (const event of events) {
    let isDupe = false;
    for (const existing of seen) {
      const matchCount = _countMatches(event, existing);
      if (matchCount >= 3) {
        isDupe = true;
        break;
      }
    }
    if (!isDupe) {
      seen.push(event);
      result.push(event);
    }
  }

  return result;
}

/**
 * Count how many of the 4 dedup criteria match between two events.
 */
function _countMatches(a, b) {
  let matches = 0;

  // 1. Same organizer
  const aOrgs = (a.organizers || []).map(e => e.toLowerCase());
  const bOrgs = (b.organizers || []).map(e => e.toLowerCase());
  if (aOrgs.some(o => bOrgs.includes(o))) matches++;

  // 2. Identical title + start time (±1 minute)
  if (a.title && b.title && a.title.toLowerCase() === b.title.toLowerCase()) {
    const timeDiff = Math.abs(new Date(a.start).getTime() - new Date(b.start).getTime());
    if (timeDiff <= 60 * 1000) matches++;
  }

  // 3. Same conference URL
  if (a.conferenceUrl && b.conferenceUrl && a.conferenceUrl === b.conferenceUrl) matches++;

  // 4. Same event ID (rare cross-provider, but handles re-imported events)
  if (a.id && b.id && a.id === b.id) matches++;

  return matches;
}
