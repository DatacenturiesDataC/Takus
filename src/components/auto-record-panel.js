
// Configuration UI for auto-recording preferences.
// Rendered inline as part of the Settings tab.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { getSetting, saveSetting } from '../lib/storage.js';
import { getDefaultConfig } from '../lib/auto-record-engine.js';
import { toast } from './toast.js';

const _settingsKeys = {
  enabled:          'autoRecordEnabled',
  calendars:        'autoRecordCalendars',
  exclusionWords:   'autoRecordExclusions',
  maxConcurrent:    'autoRecordMaxConcurrent',
  bufferBefore:     'autoRecordBufferBefore',
  bufferAfter:      'autoRecordBufferAfter',
  recordPrivate:    'autoRecordPrivate',
  maxParticipants:  'autoRecordMaxParticipants',
  preNotify:        'autoRecordPreNotify',
};

/**
 * Render the auto-record settings section into a container.
 * @param {HTMLElement} container
 */
export async function renderAutoRecordSettings(container) {
  if (!container) return;

  const defaults = getDefaultConfig();
  const enabled = (await getSetting(_settingsKeys.enabled)) ?? defaults.autoRecordEnabled;
  const exclusions = (await getSetting(_settingsKeys.exclusionWords)) ?? '';
  const maxConcurrent = (await getSetting(_settingsKeys.maxConcurrent)) ?? defaults.maxConcurrent;
  const bufferBefore = (await getSetting(_settingsKeys.bufferBefore)) ?? defaults.bufferBeforeMin;
  const bufferAfter = (await getSetting(_settingsKeys.bufferAfter)) ?? defaults.bufferAfterMin;
  const recordPrivate = (await getSetting(_settingsKeys.recordPrivate)) ?? defaults.recordPrivateEvents;
  const maxParticipants = (await getSetting(_settingsKeys.maxParticipants)) ?? defaults.maxParticipants;
  const preNotify = (await getSetting(_settingsKeys.preNotify)) ?? defaults.preNotify;

  container.innerHTML = `
    <div class="card card-compact mt-4-sp" >
      <div class="card-header">
        <h3 class="flex-center">${icons.calendar(14)} Auto-Recording</h3>
        <label class="toggle-switch" for="ar-enabled" title="Enable auto-recording">
          <input type="checkbox" id="ar-enabled" ${enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div id="ar-settings-body" style="${enabled ? '' : 'opacity:0.4;pointer-events:none;'}display:flex;flex-direction:column;gap:var(--space-4);padding:0 var(--space-4) var(--space-4);">

        <!-- Pre-notification -->
        <div class="input-group" style="flex-direction:row;align-items:center;gap:var(--space-2);">
          <input type="checkbox" id="ar-prenotify" ${preNotify ? 'checked' : ''} />
          <label for="ar-prenotify" class="section-subtitle">
            Show confirmation before starting
          </label>
        </div>

        <!-- Buffer timings -->
        <div class="grid-2col">
          <div class="input-group">
            <label for="ar-buffer-before">Start buffer (min)</label>
            <select class="select" id="ar-buffer-before">
              ${[0, 1, 2, 3, 5].map(v => `<option value="${v}" ${v === bufferBefore ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="input-group">
            <label for="ar-buffer-after">Stop buffer (min)</label>
            <select class="select" id="ar-buffer-after">
              ${[0, 1, 2, 3, 5].map(v => `<option value="${v}" ${v === bufferAfter ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Exclusion keywords -->
        <div class="input-group">
          <label for="ar-exclusions">Exclusion keywords</label>
          <input class="input" type="text" id="ar-exclusions" value="${esc(exclusions)}" placeholder="lunch, social, ooo" autocomplete="off" />
          <span class="text-10-disabled">Comma-separated — events with these words in the title will be skipped.</span>
        </div>

        <!-- Limits -->
        <div class="grid-2col">
          <div class="input-group">
            <label for="ar-max-concurrent">Max concurrent</label>
            <select class="select" id="ar-max-concurrent">
              ${[1, 2].map(v => `<option value="${v}" ${v === maxConcurrent ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="input-group">
            <label for="ar-max-participants">Max attendees (0 = any)</label>
            <input class="input" type="number" id="ar-max-participants" value="${maxParticipants}" min="0" max="1000" step="1" />
          </div>
        </div>

        <!-- Privacy -->
        <div class="input-group" style="flex-direction:row;align-items:center;gap:var(--space-2);">
          <input type="checkbox" id="ar-private" ${recordPrivate ? 'checked' : ''} />
          <label for="ar-private" class="section-subtitle">
            Record private/confidential events
          </label>
        </div>
      </div>
    </div>`;

  _bindAutoRecordEvents(container);
}

function _bindAutoRecordEvents(root) {
  // Toggle master switch
  root.querySelector('#ar-enabled')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await saveSetting(_settingsKeys.enabled, enabled).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
    const body = root.querySelector('#ar-settings-body');
    if (body) {
      body.style.opacity = enabled ? '' : '0.4';
      body.style.pointerEvents = enabled ? '' : 'none';
    }
    toast.info(enabled ? 'Auto-recording enabled' : 'Auto-recording disabled', '');
  });

  // Pre-notify
  root.querySelector('#ar-prenotify')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.preNotify, e.target.checked).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });

  // Buffer before
  root.querySelector('#ar-buffer-before')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.bufferBefore, parseInt(e.target.value, 10)).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });

  // Buffer after
  root.querySelector('#ar-buffer-after')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.bufferAfter, parseInt(e.target.value, 10)).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });

  // Exclusion keywords
  root.querySelector('#ar-exclusions')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.exclusionWords, e.target.value.trim()).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });

  // Max concurrent
  root.querySelector('#ar-max-concurrent')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.maxConcurrent, parseInt(e.target.value, 10)).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });

  // Max participants
  root.querySelector('#ar-max-participants')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.maxParticipants, parseInt(e.target.value, 10) || 0).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });

  // Record private
  root.querySelector('#ar-private')?.addEventListener('change', async (e) => {
    await saveSetting(_settingsKeys.recordPrivate, e.target.checked).catch(err => console.warn('[AutoRecord] Setting save failed:', err?.message));
  });
}
