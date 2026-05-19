
// First-run guided setup for new users. Multi-step wizard with:
// 1. Welcome screen    2. Cloud provider connection
// 3. AI provider setup 4. Capture preferences
// 5. Ready screen

import { icons } from '../lib/icons.js';
import { getSetting, saveSetting } from '../lib/storage.js';

const SETUP_KEY = 'setupComplete';
const TOTAL_STEPS = 5;

/**
 * Check whether the setup wizard has been completed.
 * @returns {Promise<boolean>}
 */
export async function isSetupComplete() {
  const v = await getSetting(SETUP_KEY).catch(() => null);
  return v === true;
}

/**
 * Show the full-screen setup wizard overlay.
 * Resolves when the wizard is dismissed (completed or skipped).
 * @returns {Promise<void>}
 */
export function showSetupWizard() {
  return new Promise((resolve) => {
    let step = 1;

    const overlay = document.createElement('div');
    overlay.id = 'setup-wizard';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Setup wizard');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:var(--z-modal);',
      'display:flex;align-items:center;justify-content:center;padding:var(--space-4);',
      'background:var(--color-bg-deep);',
    ].join('');

    function render() {
      const progress = Math.round((step / TOTAL_STEPS) * 100);
      overlay.innerHTML = `
        <div style="width:100%;max-width:540px;display:flex;flex-direction:column;gap:var(--space-6);">
          <!-- Progress bar -->
          <div class="flex-center gap-3">
            <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${progress}%;background:var(--color-accent-gradient);border-radius:2px;transition:width 0.4s var(--ease-out);"></div>
            </div>
            <span style="font-size:var(--font-xs);color:var(--color-text-disabled);font-variant-numeric:tabular-nums;">${step}/${TOTAL_STEPS}</span>
            <button id="wizard-skip" class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);color:var(--color-text-disabled);">Skip setup</button>
          </div>

          <!-- Step content -->
          <div class="card" style="padding:var(--space-8) var(--space-6);text-align:center;">
            ${_stepContent(step)}
          </div>

          <!-- Navigation -->
          <div style="display:flex;justify-content:${step > 1 ? 'space-between' : 'flex-end'};gap:var(--space-3);">
            ${step > 1 ? `<button id="wizard-back" class="btn btn-ghost">${icons.chevronLeft?.(14) || '←'} Back</button>` : ''}
            <button id="wizard-next" class="btn btn-primary" style="min-width:140px;">
              ${step === TOTAL_STEPS ? 'Get Started' : `Next ${icons.chevronRight?.(14) || '→'}`}
            </button>
          </div>
        </div>`;

      // Bind events
      overlay.querySelector('#wizard-skip')?.addEventListener('click', finish);
      overlay.querySelector('#wizard-back')?.addEventListener('click', () => { step--; render(); });
      overlay.querySelector('#wizard-next')?.addEventListener('click', () => {
        if (step < TOTAL_STEPS) { step++; render(); }
        else finish();
      });

      // Cloud connect button — close wizard first, then navigate to settings
      overlay.querySelector('#wizard-connect-settings')?.addEventListener('click', async () => {
        await finish();
        setTimeout(() => {
          const tab = document.querySelector('.main-tab[data-tab="settings"]');
          if (tab) tab.click();
        }, 100);
      });
      // AI settings button — close wizard, navigate to settings
      overlay.querySelector('#wizard-ai-settings')?.addEventListener('click', async () => {
        await finish();
        setTimeout(() => {
          const tab = document.querySelector('.main-tab[data-tab="settings"]');
          if (tab) tab.click();
        }, 100);
      });

      // Focus the next button
      setTimeout(() => overlay.querySelector('#wizard-next')?.focus(), 50);
    }

    async function finish() {
      await saveSetting(SETUP_KEY, true).catch(() => {});
      overlay.remove();
      resolve();
    }

    document.body.appendChild(overlay);
    render();
  });
}

function _stepContent(step) {
  switch (step) {
    case 1: return `
      <div class="wiz-step-header">
        <div style="font-size:var(--font-5xl);margin-bottom:var(--space-2);">🎯</div>
        <h2 class="wiz-step-title" style="font-size:var(--font-2xl);">Welcome to Takus</h2>
        <p class="wiz-step-desc" style="max-width:400px;">
          Your adaptive Knowledge OS. Capture meetings, screens, and documents — then let AI connect your goals, tasks, people, and insights in one place.
        </p>
      </div>
      <div class="wiz-features">
        ${_featureBadge(icons.video(16), 'Capture', 'Entries, docs & more')}
        ${_featureBadge(icons.zap(16), 'AI Intelligence', 'Goals, tasks & insights')}
        ${_featureBadge(icons.users(16), 'People', 'Track contacts & engagement')}
      </div>`;

    case 2: return `
      <div class="wiz-step-header">
        ${icons.cloud(32)}
        <h2 class="wiz-step-title">Connect Cloud Storage</h2>
        <p class="wiz-step-desc">
          Back up entries to Google Drive or OneDrive. You can skip this and set it up later in Settings.
        </p>
      </div>
      <div class="wiz-features" style="gap:var(--space-3);">
        <button class="btn btn-ghost" id="wizard-connect-settings" style="padding:var(--space-3) var(--space-5);border:1px solid var(--color-border-strong);border-radius:var(--radius-md);display:flex;align-items:center;gap:var(--space-2);">
          ${icons.link(16)} Connect in Settings
        </button>
      </div>
      <p class="wiz-security-note">
        ${icons.shield(10)} Your data stays in your cloud. Takus never stores entries on our servers.
      </p>`;

    case 3: return `
      <div class="wiz-step-header">
        ${icons.zap(32)}
        <h2 class="wiz-step-title">AI Provider</h2>
        <p class="wiz-step-desc">
          Takus uses AI to generate meeting summaries, transcripts, and action items. Add your API key in Settings to get started.
        </p>
      </div>
      <div class="wiz-features" style="gap:var(--space-3);">
        ${_providerCard('OpenAI', 'GPT-4o & Whisper', 'Best accuracy')}
        ${_providerCard('Gemini', 'Google Gemini', 'Free tier available')}
      </div>
      <div style="margin-top:var(--space-4);">
        <button class="btn btn-ghost" id="wizard-ai-settings" style="padding:var(--space-2) var(--space-4);border:1px solid var(--color-border-strong);border-radius:var(--radius-md);font-size:var(--font-xs);">
          ${icons.settings(12)} Configure AI in Settings
        </button>
      </div>
      <p class="wiz-security-note">
        ${icons.shield(10)} API keys are stored locally and never leave your browser.
      </p>`;

    case 4: return `
      <div class="wiz-step-header">
        ${icons.settings(32)}
        <h2 class="wiz-step-title">Capture Preferences</h2>
        <p class="wiz-step-desc">
          These defaults can be changed anytime from the Settings tab.
        </p>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);max-width:320px;margin:var(--space-4) auto 0;text-align:left;">
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Video Quality</span>
          <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-text-primary);">1080p (default)</span>
        </div>
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Record Shortcut</span>
          <kbd class="wiz-kbd">R</kbd>
        </div>
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Pause Shortcut</span>
          <kbd class="wiz-kbd">Space</kbd>
        </div>
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Stop Shortcut</span>
          <kbd class="wiz-kbd">S</kbd>
        </div>
      </div>`;

    case 5: return `
      <div class="wiz-step-header">
        <div style="font-size:var(--font-5xl);margin-bottom:var(--space-2);">🚀</div>
        <h2 class="wiz-step-title" style="font-size:var(--font-2xl);">You're All Set!</h2>
        <p class="wiz-step-desc" style="max-width:400px;">
          Press <kbd style="background:var(--color-bg-elevated);padding:2px 8px;border-radius:4px;font-weight:var(--weight-semi);">R</kbd> or click the record button to capture your first entry. Takus will handle the rest.
        </p>
      </div>
      <div class="wiz-features">
        ${_tipBadge('💡', 'Capture screens, meetings, or import documents')}
        ${_tipBadge('⚡', 'AI connects goals, tasks, and insights')}
        ${_tipBadge('☁️', 'Everything syncs to your cloud')}
      </div>`;

    default: return '';
  }
}

function _featureBadge(icon, title, desc) {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-1);padding:var(--space-3);background:var(--color-bg-surface);border-radius:var(--radius-md);width:120px;">
    <span class="text-primary">${icon}</span>
    <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);">${title}</span>
    <span class="text-10-disabled">${desc}</span>
  </div>`;
}

function _providerCard(name, sub, badge) {
  return `<div style="padding:var(--space-4);background:var(--color-bg-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);width:150px;cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--color-primary)'" onmouseout="this.style.borderColor='var(--color-border)'">
    <div style="font-weight:var(--weight-bold);font-size:var(--font-sm);margin-bottom:var(--space-1);">${name}</div>
    <div class="text-xs" class="text-secondary">${sub}</div>
    <div style="font-size:10px;color:var(--color-primary-light);margin-top:var(--space-2);">${badge}</div>
  </div>`;
}

function _tipBadge(emoji, text) {
  return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg-surface);border-radius:var(--radius-md);font-size:var(--font-xs);color:var(--color-text-secondary);">
    <span>${emoji}</span> ${text}
  </div>`;
}
