// Takus — Feedback Engine
// Gathers device diagnostics, sanitizes PII, and creates structured feedback objects.
// Part of the Unified Feedback System (human + system).

import { getSetting } from './storage.js';
import { getSettingCached } from './settings-store.js';

/**
 * Gather device diagnostics for feedback reports.
 * Collects ONLY technical metadata — never user content.
 *
 * @returns {Promise<object>} Sanitized device context
 */
export async function gatherDiagnostics() {
  const ua = navigator.userAgent;
  const browser = _parseBrowser(ua);
  const os = _parseOS(ua);

  // Storage usage
  let storageUsed = null;
  let storageQuota = null;
  try {
    const estimate = await navigator.storage.estimate();
    storageUsed = estimate.usage || null;
    storageQuota = estimate.quota || null;
  } catch { /* storage API not available */ }

  // Connected providers
  const providers = [];
  try {
    if (localStorage.getItem('takus_google_was_connected') === 'true') providers.push('google_drive');
    if (localStorage.getItem('takus_last_provider') === 'microsoft') providers.push('onedrive');
  } catch { /* localStorage blocked */ }

  // AI provider (use cache for fast reads, correct key is 'aiProvider')
  let aiProvider = null;
  try {
    aiProvider = await getSettingCached('aiProvider');
  } catch { /* settings not available */ }

  // Enabled features
  const features = [];
  try {
    const autoRecord = await getSetting('autoRecordEnabled');
    if (autoRecord) features.push('auto_record');
    const notifications = await getSettingCached('desktopNotifications');
    if (notifications) features.push('desktop_notifications');
  } catch { /* settings read failed */ }

  return {
    app_version: _getAppVersion(),
    browser,
    os,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    connected_providers: providers,
    ai_provider: aiProvider,
    enabled_features: features,
    storage_used_mb: storageUsed ? Math.round(storageUsed / 1024 / 1024) : null,
    storage_quota_mb: storageQuota ? Math.round(storageQuota / 1024 / 1024) : null,
    online: navigator.onLine,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Collect recent errors from the error boundary.
 * Only collects the last N errors (sanitized stack traces).
 *
 * @returns {Array<{message: string, timestamp: string}>}
 */
export function getRecentErrors() {
  return [..._errorLog].slice(-10);
}

/**
 * Record an error for diagnostic purposes.
 * Called by the error boundary. Sanitizes file paths and personal data.
 *
 * @param {string} message - Error message
 */
export function recordError(message) {
  const sanitized = _sanitizeMessage(message);
  _errorLog.push({
    message: sanitized,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 50 errors
  if (_errorLog.length > 50) _errorLog.splice(0, _errorLog.length - 50);
}

/**
 * Build a structured feedback payload.
 *
 * @param {'bug'|'feature_request'|'ux'|'other'} category
 * @param {string} description - User-written description
 * @param {object} [options]
 * @param {boolean} [options.includeDiagnostics=true]
 * @param {string} [options.contactEmail]
 * @returns {Promise<object>}
 */
export async function buildFeedbackPayload(category, description, options = {}) {
  const { includeDiagnostics = true, contactEmail } = options;

  const payload = {
    category,
    description: description.trim().slice(0, 2000),
    timestamp: new Date().toISOString(),
  };

  if (includeDiagnostics) {
    payload.device_context = await gatherDiagnostics();
    payload.recent_errors = getRecentErrors();
  }

  if (contactEmail) {
    payload.contact_email = contactEmail;
  }

  return payload;
}

/**
 * Submit feedback to the product team endpoint.
 *
 * @param {object} payload - Built by buildFeedbackPayload
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function submitFeedback(payload) {
  try {
    const resp = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { success: false, error: `Server error (${resp.status}): ${body}` };
    }

    const data = await resp.json().catch(() => ({}));
    return { success: true, id: data.id };
  } catch (err) {
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Get the locally stored feedback history.
 *
 * @returns {Array<object>}
 */
export function getFeedbackHistory() {
  try {
    const raw = localStorage.getItem('takus_feedback_history');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save a feedback submission to local history.
 *
 * @param {object} entry - { id, category, description, timestamp, status }
 */
export function saveFeedbackToHistory(entry) {
  const history = getFeedbackHistory();
  history.unshift(entry);
  // Keep last 50 entries
  if (history.length > 50) history.length = 50;
  try {
    localStorage.setItem('takus_feedback_history', JSON.stringify(history));
  } catch { /* localStorage full or blocked */ }
}

// ── Internal ──────────────────────────────────────────────────────────────────

/** In-memory error log for diagnostics */
const _errorLog = [];

function _getAppVersion() {
  // Read from the HTML meta tag if available, fallback to hardcoded
  try {
    const meta = document.querySelector('meta[name="version"]');
    if (meta) return meta.content;
  } catch { /* not in browser */ }
  return '0.13.0';
}

function _parseBrowser(ua) {
  if (ua.includes('Edg/')) return 'Edge ' + (ua.match(/Edg\/([\d.]+)/)?.[1] || '');
  if (ua.includes('Chrome/')) return 'Chrome ' + (ua.match(/Chrome\/([\d.]+)/)?.[1] || '');
  if (ua.includes('Firefox/')) return 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)?.[1] || '');
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari ' + (ua.match(/Version\/([\d.]+)/)?.[1] || '');
  return 'Unknown';
}

function _parseOS(ua) {
  if (ua.includes('Windows NT 10')) return 'Windows 10/11';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS ' + (ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '');
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Unknown';
}

/**
 * Sanitize an error message — strip file paths, URLs with tokens, and potential PII.
 */
function _sanitizeMessage(msg) {
  if (!msg) return '';
  return msg
    // Strip URLs with query params (may contain tokens) — must come before path stripping
    .replace(/https?:\/\/[^\s)]+/g, '[url]')
    // Strip absolute file paths
    .replace(/(?:\/[\w.-]+){3,}/g, '[path]')
    // Strip email addresses
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]')
    // Truncate
    .slice(0, 500);
}
