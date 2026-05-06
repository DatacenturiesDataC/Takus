// Takus — Hero Section (landing when idle)
import { icons } from '../lib/icons.js';

/**
 * Returns a browser compatibility descriptor.
 * Screen capture requires getDisplayMedia, which is unavailable on:
 *  - iOS (all browsers — Apple restricts the API)
 *  - Android (most browsers except Chrome/Edge on Android 11+, still limited)
 *  - Very old desktop browsers
 */
function getCompatInfo() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid;
  const hasDisplayMedia = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

  if (isIOS) {
    return { supported: false, reason: 'iOS does not support screen recording in the browser. Please use a Mac, Windows, or Linux desktop browser.' };
  }
  if (isAndroid && !hasDisplayMedia) {
    return { supported: false, reason: 'Screen recording is not supported in this Android browser. Try Chrome on a desktop device.' };
  }
  if (!hasDisplayMedia) {
    return { supported: false, reason: 'Your browser does not support screen capture. Please use Chrome, Edge, or Firefox on a desktop.' };
  }
  if (!hasMediaRecorder) {
    return { supported: false, reason: 'Your browser does not support the MediaRecorder API required for recording. Please update your browser.' };
  }
  return { supported: true, isMobile };
}

export function renderHeroSection(container) {
  const compat = getCompatInfo();

  if (!compat.supported) {
    container.innerHTML = `
      <div class="card animate-in" style="text-align:center;padding:var(--space-10) var(--space-8);border-color:rgba(245,158,11,0.3);">
        <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-5);">
          <div style="width:64px;height:64px;border-radius:var(--radius-xl);background:rgba(245,158,11,0.15);display:flex;align-items:center;justify-content:center;">
            ${icons.alertTriangle(32)}
          </div>
          <div>
            <h2 style="font-size:var(--font-2xl);font-weight:var(--weight-heavy);letter-spacing:-0.03em;margin-bottom:var(--space-3);">
              Desktop Browser Required
            </h2>
            <p style="font-size:var(--font-base);color:var(--color-text-secondary);max-width:480px;margin:0 auto;line-height:1.6;">
              ${compat.reason}
            </p>
          </div>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;justify-content:center;margin-top:var(--space-2);">
            <span style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);background:rgba(255,255,255,0.04);padding:6px 12px;border-radius:99px;border:1px solid rgba(255,255,255,0.08);">
              ${icons.zap(14)} Chrome
            </span>
            <span style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);background:rgba(255,255,255,0.04);padding:6px 12px;border-radius:99px;border:1px solid rgba(255,255,255,0.08);">
              ${icons.zap(14)} Edge
            </span>
            <span style="display:flex;align-items:center;gap:var(--font-sm);font-size:var(--font-sm);color:var(--color-text-muted);background:rgba(255,255,255,0.04);padding:6px 12px;border-radius:99px;border:1px solid rgba(255,255,255,0.08);">
              ${icons.zap(14)} Firefox
            </span>
          </div>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:var(--space-1);">
            You can still connect your cloud account and browse your recording history below.
          </p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card animate-in" style="text-align:center;padding:var(--space-10) var(--space-8);">
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-5);">
        <div style="width:64px;height:64px;border-radius:var(--radius-xl);background:var(--color-accent-gradient);display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-glow);">
          ${icons.video(32)}
        </div>
        <div>
          <h2 style="font-size:var(--font-3xl);font-weight:var(--weight-heavy);letter-spacing:-0.03em;margin-bottom:var(--space-2);">
            Record. Vault. Share.
          </h2>
          <p style="font-size:var(--font-lg);color:var(--color-text-secondary);max-width:460px;margin:0 auto;line-height:1.6;">
            Record any screen or video call. Automatically save to Google Drive or OneDrive. Free forever.
          </p>
        </div>
        <div style="display:flex;gap:var(--space-6);flex-wrap:wrap;justify-content:center;margin-top:var(--space-2);">
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);">
            ${icons.shield(16)} Privacy-first
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);">
            ${icons.zap(16)} No install needed
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);">
            ${icons.hardDrive(16)} Your Cloud, your data
          </div>
        </div>
      </div>
    </div>
  `;
}

/** Whether the current browser/device can actually record the screen. */
export function isScreenCaptureSupported() {
  return getCompatInfo().supported;
}
