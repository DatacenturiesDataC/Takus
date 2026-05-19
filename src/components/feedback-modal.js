// Takus — Feedback Modal
// Floating feedback button + modal for submitting bug reports and feature requests.
// Part of the Unified Feedback System.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { toast } from './toast.js';
import { buildFeedbackPayload, submitFeedback, saveFeedbackToHistory, getFeedbackHistory } from '../lib/feedback-engine.js';
import { getSetting } from '../lib/storage.js';

let _modalEl = null;
let _btnEl = null;

/**
 * Initialize the feedback button.
 * Call once during app bootstrap.
 */
export function initFeedbackButton() {
  if (_btnEl) return;

  _btnEl = document.createElement('button');
  _btnEl.id = 'feedback-btn';
  _btnEl.className = 'feedback-fab';
  _btnEl.setAttribute('aria-label', 'Send feedback');
  _btnEl.setAttribute('title', 'Send feedback');
  _btnEl.innerHTML = icons.send(16);
  _btnEl.addEventListener('click', openFeedbackModal);
  document.body.appendChild(_btnEl);
}

/**
 * Open the feedback modal.
 */
export async function openFeedbackModal() {
  if (_modalEl) return;

  const feedbackEnabled = await getSetting('feedbackEnabled');

  _modalEl = document.createElement('div');
  _modalEl.id = 'feedback-modal';
  _modalEl.className = 'feedback-overlay';
  _modalEl.setAttribute('role', 'dialog');
  _modalEl.setAttribute('aria-modal', 'true');
  _modalEl.setAttribute('aria-label', 'Send feedback');

  _modalEl.innerHTML = `
    <div class="feedback-panel">
      <div class="feedback-header">
        <h3>Send Feedback</h3>
        <button class="feedback-close" aria-label="Close">${icons.x(16)}</button>
      </div>

      <div class="feedback-body">
        <label class="feedback-label" for="feedback-category">Category</label>
        <div class="feedback-categories" id="feedback-category" role="radiogroup">
          <button class="feedback-cat active" data-cat="bug" aria-pressed="true">🐛 Bug</button>
          <button class="feedback-cat" data-cat="feature_request" aria-pressed="false">💡 Feature</button>
          <button class="feedback-cat" data-cat="ux" aria-pressed="false">🎨 UX</button>
          <button class="feedback-cat" data-cat="other" aria-pressed="false">💬 Other</button>
        </div>

        <label class="feedback-label" for="feedback-desc">Description</label>
        <textarea
          id="feedback-desc"
          class="feedback-textarea"
          placeholder="Tell us what happened or what you'd like to see…"
          rows="5"
          maxlength="2000"
        ></textarea>
        <div class="feedback-char-count"><span id="feedback-char">0</span>/2000</div>

        <label class="feedback-toggle-row">
          <input type="checkbox" id="feedback-diag" checked />
          <span>Include device diagnostics</span>
          <span class="feedback-hint">(browser, OS, version — no personal data)</span>
        </label>

        <label class="feedback-label" for="feedback-email">Email (optional, for follow-up)</label>
        <input type="email" id="feedback-email" class="feedback-input" placeholder="you@example.com" />

        <div class="feedback-preview-toggle">
          <button class="feedback-preview-btn" id="feedback-preview-btn">Preview what will be sent ▾</button>
          <pre class="feedback-preview-pre" id="feedback-preview-pre" hidden></pre>
        </div>
      </div>

      <div class="feedback-footer">
        <button class="feedback-cancel" id="feedback-cancel-btn">Cancel</button>
        <button class="feedback-submit" id="feedback-submit-btn">
          ${icons.send(14)} Send Feedback
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(_modalEl);

  // Focus trap
  const textarea = _modalEl.querySelector('#feedback-desc');
  textarea.focus();

  // ── Event listeners ──

  // Close
  _modalEl.querySelector('.feedback-close').addEventListener('click', _close);
  _modalEl.querySelector('#feedback-cancel-btn').addEventListener('click', _close);
  _modalEl.addEventListener('click', (e) => {
    if (e.target === _modalEl) _close();
  });

  // Escape key
  const _onKey = (e) => { if (e.key === 'Escape') _close(); };
  document.addEventListener('keydown', _onKey);
  _modalEl._cleanupKey = () => document.removeEventListener('keydown', _onKey);

  // Category selector
  _modalEl.querySelectorAll('.feedback-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      _modalEl.querySelectorAll('.feedback-cat').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  // Character count
  textarea.addEventListener('input', () => {
    _modalEl.querySelector('#feedback-char').textContent = textarea.value.length;
  });

  // Preview toggle
  _modalEl.querySelector('#feedback-preview-btn').addEventListener('click', async () => {
    const pre = _modalEl.querySelector('#feedback-preview-pre');
    if (!pre.hidden) {
      pre.hidden = true;
      return;
    }
    const payload = await _buildCurrentPayload();
    pre.textContent = JSON.stringify(payload, null, 2);
    pre.hidden = false;
  });

  // Submit
  _modalEl.querySelector('#feedback-submit-btn').addEventListener('click', _submit);
}

async function _buildCurrentPayload() {
  const category = _modalEl.querySelector('.feedback-cat.active')?.dataset.cat || 'other';
  const description = _modalEl.querySelector('#feedback-desc').value;
  const includeDiag = _modalEl.querySelector('#feedback-diag').checked;
  const email = _modalEl.querySelector('#feedback-email').value.trim();

  return buildFeedbackPayload(category, description, {
    includeDiagnostics: includeDiag,
    contactEmail: email || undefined,
  });
}

async function _submit() {
  const desc = _modalEl.querySelector('#feedback-desc').value.trim();
  if (desc.length < 5) {
    toast.warning('Too short', 'Please write at least 5 characters.');
    return;
  }

  const btn = _modalEl.querySelector('#feedback-submit-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner spinner-xs-11" ></div> Sending…`;

  try {
    const payload = await _buildCurrentPayload();
    const result = await submitFeedback(payload);

    if (result.success) {
      saveFeedbackToHistory({
        id: result.id,
        category: payload.category,
        description: payload.description.slice(0, 100),
        timestamp: payload.timestamp,
        status: 'sent',
      });
      toast.success('Feedback sent', 'Thank you! Your feedback helps improve Takus.');
      _close();
    } else {
      toast.error('Send failed', result.error || 'Could not reach the feedback server.');
      btn.disabled = false;
      btn.innerHTML = `${icons.send(14)} Send Feedback`;
    }
  } catch (err) {
    toast.error('Send failed', err.message || 'Unexpected error.');
    btn.disabled = false;
    btn.innerHTML = `${icons.send(14)} Send Feedback`;
  }
}

function _close() {
  if (!_modalEl) return;
  _modalEl._cleanupKey?.();
  _modalEl.remove();
  _modalEl = null;
}

/**
 * Render the feedback history list for the Settings panel.
 *
 * @returns {string} HTML string
 */
export function renderFeedbackHistory() {
  const history = getFeedbackHistory();
  if (!history.length) return '<p class="text-muted text-xs">No feedback reports sent yet.</p>';

  return `
    <div class="feedback-history-list">
      ${history.map(h => `
        <div class="feedback-history-item">
          <span class="feedback-history-cat">${_catEmoji(h.category)} ${esc(h.category)}</span>
          <span class="feedback-history-desc">${esc(h.description)}</span>
          <span class="feedback-history-date text-muted text-xs">${new Date(h.timestamp).toLocaleDateString()}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function _catEmoji(cat) {
  switch (cat) {
    case 'bug': return '🐛';
    case 'feature_request': return '💡';
    case 'ux': return '🎨';
    default: return '💬';
  }
}
