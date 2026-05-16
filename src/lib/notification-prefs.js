// Takus — Notification Preferences (Phase 61)
// Configurable notification rules. Users control what they see and when.
//
// Mission: Adaptive AI with goal preservation in accordance with human well-being.
// Notifications must respect user sovereignty — every category is independently
// configurable and defaults to the least disruptive setting.
//
// This is a pure service — no UI. Components read these preferences to decide
// whether to surface notifications.

import { getSetting, saveSetting } from './storage.js';

const PREFS_KEY = 'takus_notification_prefs';

/**
 * @typedef {object} NotificationChannel
 * @property {boolean} enabled      Master toggle
 * @property {'all'|'important'|'none'} level  Verbosity
 * @property {boolean} sound        Play sound
 */

/**
 * @typedef {object} NotificationPrefs
 * @property {NotificationChannel} breaks     Break reminders
 * @property {NotificationChannel} tasks      Task assignments & completions
 * @property {NotificationChannel} goals      Goal state changes
 * @property {NotificationChannel} uploads    Upload progress & completion
 * @property {NotificationChannel} approvals  Approval requests
 * @property {NotificationChannel} calendar   Calendar-related alerts
 * @property {NotificationChannel} system     Platform health & errors
 * @property {boolean} quietHours             Enable quiet hours
 * @property {number}  quietStart             Quiet start hour (0-23, default 22)
 * @property {number}  quietEnd               Quiet end hour (0-23, default 7)
 * @property {boolean} doNotDisturb           Master DND toggle
 */

/** Default notification preferences — gentle by default */
const DEFAULTS = {
  breaks:    { enabled: true,  level: 'important', sound: false },
  tasks:     { enabled: true,  level: 'important', sound: false },
  goals:     { enabled: true,  level: 'important', sound: false },
  uploads:   { enabled: true,  level: 'all',       sound: false },
  approvals: { enabled: true,  level: 'all',       sound: false },
  calendar:  { enabled: true,  level: 'important', sound: false },
  system:    { enabled: true,  level: 'important', sound: false },
  quietHours: false,
  quietStart: 22,
  quietEnd: 7,
  doNotDisturb: false,
};

/** In-memory cache */
let _prefs = null;

/**
 * Get notification preferences.
 * @returns {Promise<NotificationPrefs>}
 */
export async function getNotificationPrefs() {
  if (_prefs) return { ...DEFAULTS, ..._prefs };
  try {
    const stored = await getSetting(PREFS_KEY);
    _prefs = stored || {};
  } catch {
    _prefs = {};
  }
  return { ...DEFAULTS, ..._prefs };
}

/**
 * Update notification preferences (partial merge).
 * @param {Partial<NotificationPrefs>} updates
 * @returns {Promise<NotificationPrefs>}
 */
export async function updateNotificationPrefs(updates) {
  const current = await getNotificationPrefs();
  const merged = { ...current };

  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === 'object' && value !== null && typeof merged[key] === 'object') {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }

  _prefs = merged;
  await saveSetting(PREFS_KEY, merged);
  return merged;
}

/**
 * Check if a specific notification should be shown.
 *
 * @param {string} category — 'breaks', 'tasks', 'goals', 'uploads', 'approvals', 'calendar', 'system'
 * @param {'info'|'important'|'error'} severity — How important is this notification?
 * @returns {Promise<boolean>}
 */
export async function shouldNotify(category, severity = 'info') {
  const prefs = await getNotificationPrefs();

  // Master DND
  if (prefs.doNotDisturb) return false;

  // Quiet hours
  if (prefs.quietHours) {
    const hour = new Date().getHours();
    const start = prefs.quietStart;
    const end = prefs.quietEnd;

    let inQuiet;
    if (start > end) {
      // Overnight: e.g. 22:00 – 07:00
      inQuiet = hour >= start || hour < end;
    } else {
      inQuiet = hour >= start && hour < end;
    }

    // During quiet hours, only allow errors
    if (inQuiet && severity !== 'error') return false;
  }

  // Category check
  const channel = prefs[category];
  if (!channel || !channel.enabled) return false;

  // Level check
  if (channel.level === 'none') return false;
  if (channel.level === 'important' && severity === 'info') return false;

  return true;
}

/**
 * Check if sound should play for a notification.
 *
 * @param {string} category
 * @returns {Promise<boolean>}
 */
export async function shouldPlaySound(category) {
  const prefs = await getNotificationPrefs();
  if (prefs.doNotDisturb) return false;
  const channel = prefs[category];
  return channel?.sound || false;
}

/**
 * Toggle Do Not Disturb.
 * @param {boolean} enabled
 * @returns {Promise<NotificationPrefs>}
 */
export async function setDoNotDisturb(enabled) {
  return updateNotificationPrefs({ doNotDisturb: enabled });
}

/**
 * Reset all notification preferences to defaults.
 * @returns {Promise<NotificationPrefs>}
 */
export async function resetNotificationPrefs() {
  _prefs = { ...DEFAULTS };
  await saveSetting(PREFS_KEY, _prefs);
  return { ..._prefs };
}
