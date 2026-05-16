// Takus — Header Component (multi-provider account widget)
import { icons } from '../lib/icons.js';
import { esc, getInitials } from '../lib/utils.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { isGoogleConfigured, isMicrosoftConfigured } from '../lib/config.js';
import { States } from '../lib/state-machine.js';
import { toast } from './toast.js';
import { openSettingsModal } from './settings-panel.js';
import { isAutonomyRunning } from '../lib/autonomy-engine.js';

// Track the unsubscribe function so we don't stack listeners on every render.
let _unsubscribeProvider = null;
let _outsideClickHandler = null;



/** SVG chevron-down */
const chevronDown = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

/** Google "G" logo as inline SVG */
const googleLogo = `<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

/** Microsoft logo as inline SVG */
const msLogo = `<svg width="16" height="16" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>`;



export function renderHeader(container, state) {
  const cpm = CloudProviderManager.getInstance();

  const isRecording = state === States.RECORDING;
  const isPaused = state === States.PAUSED;
  const showRecIndicator = isRecording || isPaused;
  const autonomyActive = isAutonomyRunning();

  // Clean up any stale outside-click handler from previous render cycle
  _cleanupOutsideClick();

  container.innerHTML = `
    <header class="app-header" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;">
      <div style="display:flex;align-items:center;gap:var(--space-3);">
        <div class="logo" style="width:36px;height:36px;border-radius:var(--radius-md);background:var(--color-accent-gradient);display:flex;align-items:center;justify-content:center;">
          ${icons.video(20)}
        </div>
        <div>
          <h1 style="font-size:var(--font-xl);font-weight:var(--weight-bold);letter-spacing:-0.02em;">Takus</h1>
          <span class="header-tagline" style="display:inline-flex;align-items:center;gap:4px;">Knowledge OS${autonomyActive ? `<span style="width:5px;height:5px;border-radius:50%;background:var(--color-success);animation:pulse 2s infinite;" title="Autonomy active"></span>` : ''}</span>
        </div>
      </div>

      <div id="header-status" style="display:flex;align-items:center;gap:var(--space-3);">
        ${showRecIndicator ? `
          <span class="badge badge-danger" style="animation:${isRecording ? 'blink 1.5s ease-in-out infinite' : 'none'};">
            <span class="status-dot recording"></span>
            <span id="header-rec-time">${isPaused ? 'Paused' : 'Recording'}</span>
          </span>
        ` : ''}
        <div id="account-slot"></div>
      </div>
    </header>
  `;

  _renderAccountWidget(cpm);

  // Unsubscribe previous listener to prevent stacking
  if (_unsubscribeProvider) _unsubscribeProvider();
  _unsubscribeProvider = cpm.onChange(() => _renderAccountWidget(cpm));
}

function _renderAccountWidget(cpm) {
  const slot = document.getElementById('account-slot');
  if (!slot) return;

  const googleAuth = cpm.google.auth;
  const msAuth = cpm.microsoft.auth;
  const anyConnected = googleAuth.isConnected || msAuth.isConnected;
  const googleConfigured = isGoogleConfigured();
  const msConfigured = isMicrosoftConfigured();

  // Clean up any stale outside-click handler from previous widget render
  _cleanupOutsideClick();

  // While a silent Google re-auth is in flight show a non-intrusive spinner
  // so the user knows we're trying to restore their session.
  if (googleAuth.isRestoring && !anyConnected) {
    slot.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);padding:var(--space-1) var(--space-2);">
        <div class="spinner" style="width:14px;height:14px;border-width:2px;"></div>
        <span>Reconnecting…</span>
      </div>
    `;
    return;
  }

  if (anyConnected) {
    // Show the active provider's user info
    const activeProvider = cpm.getProvider();
    const auth = activeProvider?.auth || googleAuth;
    const name = auth.userName || '';
    const email = auth.userEmail || '';
    const photo = auth.userPhoto || '';
    const initials = getInitials(name, email).toUpperCase();
    const displayName = name || email?.split('@')[0] || 'Connected';

    slot.innerHTML = `
      <div class="account-widget" id="account-widget">
        <button class="account-trigger account-trigger--user" id="account-trigger" aria-haspopup="true" aria-expanded="false">
          <span class="status-dot online" style="margin-right:-2px;"></span>
          <span class="account-avatar">
            ${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" />` : esc(initials)}
          </span>
          <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(displayName)}</span>
          <span class="account-chevron">${chevronDown}</span>
        </button>
        <div class="account-menu hidden" id="account-menu" role="menu">
          <div class="account-menu-label">${icons.shield(12)} ${esc(email)}</div>
          <div class="account-menu-divider"></div>
          ${_renderProviderRow('google', googleAuth, googleConfigured)}
          ${_renderProviderRow('microsoft', msAuth, msConfigured)}
          <div class="account-menu-divider"></div>
          <button class="account-menu-item" id="account-open-settings" role="menuitem">
            ${icons.settings(14)}
            <span>Settings</span>
          </button>
          <div class="account-menu-divider"></div>
          <button class="account-menu-item account-menu-item--danger" id="account-disconnect-active" role="menuitem">
            ${icons.x(14)}
            <span>Disconnect${cpm.activeId ? ` ${cpm.getProvider()?.name}` : ''}</span>
          </button>
        </div>
      </div>
    `;

    _attachMenuHandlers(cpm);
  } else {
    slot.innerHTML = `
      <div class="account-widget" id="account-widget">
        <button class="account-trigger account-trigger--cta" id="account-trigger" aria-haspopup="true" aria-expanded="false">
          ${icons.link(14)}
          <span>Connect</span>
          <span class="account-chevron">${chevronDown}</span>
        </button>
        <div class="account-menu hidden" id="account-menu" role="menu">
          <button class="account-menu-item ${!googleConfigured ? 'account-menu-item--disabled' : ''}" id="account-connect-google" role="menuitem" ${!googleConfigured ? 'disabled' : ''}>
            ${googleLogo}
            <span>Google Drive</span>
          </button>
          <button class="account-menu-item ${!msConfigured ? 'account-menu-item--disabled' : ''}" id="account-connect-microsoft" role="menuitem" ${!msConfigured ? 'disabled' : ''}>
            ${msLogo}
            <span>Microsoft OneDrive</span>
            ${!msConfigured ? '<span class="coming-soon-tag" style="margin-left:auto;">Configure</span>' : ''}
          </button>
          <div class="account-menu-divider"></div>
          <button class="account-menu-item" id="account-open-settings" role="menuitem">
            ${icons.settings(14)}
            <span>Settings</span>
          </button>
        </div>
      </div>
    `;

    _attachMenuHandlers(cpm);
  }
}

/** Render a provider row in the connected dropdown */
function _renderProviderRow(providerId, auth, configured) {
  const isGoogle = providerId === 'google';
  const logo = isGoogle ? googleLogo : msLogo;
  const label = isGoogle ? 'Google Drive' : 'Microsoft OneDrive';

  if (auth.isConnected) {
    return `
      <button class="account-menu-item" role="menuitem" disabled style="opacity:0.7;cursor:default;">
        ${logo}
        <span>${label}</span>
        <span class="badge badge-success" style="margin-left:auto;font-size:10px;">Connected</span>
      </button>`;
  }

  if (!configured) {
    return `
      <button class="account-menu-item account-menu-item--disabled" role="menuitem" disabled>
        ${logo}
        <span>${label}</span>
        <span class="coming-soon-tag" style="margin-left:auto;">Configure</span>
      </button>`;
  }

  return `
    <button class="account-menu-item" id="account-switch-${providerId}" role="menuitem">
      ${logo}
      <span>${label}</span>
      <span style="margin-left:auto;font-size:var(--font-xs);color:var(--color-primary-light);">Connect</span>
    </button>`;
}

function _attachMenuHandlers(cpm) {
  const widget = document.getElementById('account-widget');
  const trigger = document.getElementById('account-trigger');
  const menu = document.getElementById('account-menu');
  if (!widget || !trigger || !menu) return;

  // Toggle dropdown
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) {
      _closeMenu(widget, menu, trigger);
    } else {
      menu.classList.remove('hidden');
      widget.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      _cleanupOutsideClick();
      _outsideClickHandler = (evt) => {
        if (!widget.contains(evt.target)) {
          _closeMenu(widget, menu, trigger);
        }
      };
      requestAnimationFrame(() => document.addEventListener('click', _outsideClickHandler));
    }
  });

  // Escape key closes dropdown (WCAG 2.1)
  widget.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
      e.stopPropagation();
      _closeMenu(widget, menu, trigger);
      trigger.focus(); // Return focus to trigger
    }
  });

  // Connect Google (from disconnected state)
  const connectGoogleBtn = document.getElementById('account-connect-google');
  if (connectGoogleBtn) {
    connectGoogleBtn.addEventListener('click', async () => {
      _closeMenu(widget, menu, trigger);
      try {
        await cpm.connect('google');
      } catch (e) {
        toast.error('Google connection failed', e.message);
      }
    });
  }

  // Connect Microsoft (from disconnected state)
  const connectMsBtn = document.getElementById('account-connect-microsoft');
  if (connectMsBtn) {
    connectMsBtn.addEventListener('click', async () => {
      _closeMenu(widget, menu, trigger);
      try {
        await cpm.connect('microsoft');
      } catch (e) {
        toast.error('Microsoft connection failed', e.message);
      }
    });
  }

  // Switch to Google (from connected state, when MS is active)
  const switchGoogleBtn = document.getElementById('account-switch-google');
  if (switchGoogleBtn) {
    switchGoogleBtn.addEventListener('click', async () => {
      _closeMenu(widget, menu, trigger);
      try {
        await cpm.connect('google');
        toast.success('Switched to Google Drive');
      } catch (e) {
        toast.error('Google connection failed', e.message);
      }
    });
  }

  // Switch to Microsoft (from connected state, when Google is active)
  const switchMsBtn = document.getElementById('account-switch-microsoft');
  if (switchMsBtn) {
    switchMsBtn.addEventListener('click', async () => {
      _closeMenu(widget, menu, trigger);
      try {
        await cpm.connect('microsoft');
        toast.success('Switched to Microsoft OneDrive');
      } catch (e) {
        toast.error('Microsoft connection failed', e.message);
      }
    });
  }

  // Open Settings — prefer tab switch, fallback to modal
  const settingsBtn = document.getElementById('account-open-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      _closeMenu(widget, menu, trigger);
      const tab = document.querySelector('.main-tab[data-tab="settings"]');
      if (tab) tab.click();
      else openSettingsModal();
    });
  }

  // Disconnect active provider
  const disconnectBtn = document.getElementById('account-disconnect-active');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      _closeMenu(widget, menu, trigger);
      const activeId = cpm.activeId;
      if (activeId) {
        cpm.disconnect(activeId);
        toast.info(`Disconnected from ${cpm.getProviderById(activeId)?.name || activeId}`);
      }
    });
  }
}

function _closeMenu(widget, menu, trigger) {
  menu.classList.add('hidden');
  widget.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
  _cleanupOutsideClick();
}

function _cleanupOutsideClick() {
  if (_outsideClickHandler) {
    document.removeEventListener('click', _outsideClickHandler);
    _outsideClickHandler = null;
  }
}

/**
 * Live-updates the recording timer in the header badge.
 * Called from app-shell's onTick callback.
 */
export function updateHeaderRecTime(elapsed) {
  const el = document.getElementById('header-rec-time');
  if (!el) return;
  const s = Math.floor(elapsed / 1000) % 60;
  const m = Math.floor(elapsed / 60000) % 60;
  const h = Math.floor(elapsed / 3600000);
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
