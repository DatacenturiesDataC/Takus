// Takus — Hero Section (browser compatibility check)

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

/** Whether the current browser/device can actually record the screen. */
export function isScreenCaptureSupported() {
  return getCompatInfo().supported;
}
