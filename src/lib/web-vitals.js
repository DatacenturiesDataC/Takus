// Takus — Core Web Vitals measurement (no dependencies)
//
// Measures LCP, FID, INP, CLS, FCP, and TTFB using the PerformanceObserver
// API. Each metric is reported via the supplied callback with a rating based
// on Google's Core Web Vitals thresholds.
//
// Usage:
//   import { initWebVitals } from './web-vitals.js';
//   initWebVitals(({ name, value, rating }) => { … });

/**
 * @typedef {'good' | 'needs-improvement' | 'poor'} Rating
 * @typedef {{ name: string, value: number, rating: Rating }} Metric
 * @typedef {(metric: Metric) => void} OnMetric
 */

// Google's Core Web Vitals thresholds (milliseconds / unitless for CLS)
// [good, needs-improvement] — anything above the second value is "poor".
const THRESHOLDS = {
  LCP:  [2500, 4000],
  FID:  [100,  300],
  INP:  [200,  500],
  CLS:  [0.1,  0.25],
  FCP:  [1800, 3000],
  TTFB: [800,  1800],
};

/**
 * Rate a metric value against Google thresholds.
 * @param {string} name
 * @param {number} value
 * @returns {Rating}
 */
function rate(name, value) {
  const t = THRESHOLDS[name];
  if (!t) return 'good';
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'needs-improvement';
  return 'poor';
}

/**
 * Safely create a PerformanceObserver for the given entry type.
 * Returns null if the browser doesn't support the type.
 * @param {string} type
 * @param {(entries: PerformanceEntryList) => void} callback
 * @returns {PerformanceObserver | null}
 */
function observe(type, callback) {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;

    const observer = new PerformanceObserver((list) => {
      callback(list.getEntries());
    });
    observer.observe({ type, buffered: true });
    return observer;
  } catch {
    return null;
  }
}

/**
 * Initialize Core Web Vitals measurement.
 *
 * Calls `onMetric` once per metric as it becomes available. Metrics are
 * reported at most once each (except CLS which accumulates).
 *
 * @param {OnMetric} onMetric
 */
export function initWebVitals(onMetric) {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

  // ── LCP (Largest Contentful Paint) ──────────────────────────────────────
  let lcpValue = 0;
  const lcpObserver = observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcpValue = last.startTime;
  });

  // LCP is finalised when the user interacts or the page is hidden.
  if (lcpObserver) {
    const reportLCP = () => {
      if (lcpValue > 0) {
        onMetric({ name: 'LCP', value: lcpValue, rating: rate('LCP', lcpValue) });
        lcpValue = 0; // prevent double-report
      }
      lcpObserver.disconnect();
    };
    // Use 'once' to avoid leaking listeners
    addEventListener('keydown', reportLCP, { once: true, capture: true });
    addEventListener('pointerdown', reportLCP, { once: true, capture: true });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportLCP();
    }, { once: true });
  }

  // ── FID (First Input Delay) ─────────────────────────────────────────────
  observe('first-input', (entries) => {
    const first = entries[0];
    if (first) {
      const value = first.processingStart - first.startTime;
      onMetric({ name: 'FID', value, rating: rate('FID', value) });
    }
  });

  // ── INP (Interaction to Next Paint) ─────────────────────────────────────
  let inpValue = 0;
  const inpObserver = observe('event', (entries) => {
    for (const entry of entries) {
      // Only consider entries with a valid interactionId (user interactions)
      if (entry.interactionId) {
        const duration = entry.duration;
        if (duration > inpValue) inpValue = duration;
      }
    }
  });

  if (inpObserver) {
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && inpValue > 0) {
        onMetric({ name: 'INP', value: inpValue, rating: rate('INP', inpValue) });
        inpObserver.disconnect();
      }
    }, { once: true });
  }

  // ── CLS (Cumulative Layout Shift) ───────────────────────────────────────
  let clsValue = 0;
  let clsSessionValue = 0;
  let clsSessionEntries = [];
  const clsObserver = observe('layout-shift', (entries) => {
    for (const entry of entries) {
      // Ignore shifts caused by user input
      if (entry.hadRecentInput) continue;

      const lastEntry = clsSessionEntries[clsSessionEntries.length - 1];
      // Start a new session window if >1s gap or session exceeds 5s
      if (
        lastEntry &&
        entry.startTime - lastEntry.startTime < 1000 &&
        entry.startTime - clsSessionEntries[0].startTime < 5000
      ) {
        clsSessionValue += entry.value;
      } else {
        clsSessionValue = entry.value;
        clsSessionEntries = [];
      }
      clsSessionEntries.push(entry);

      if (clsSessionValue > clsValue) {
        clsValue = clsSessionValue;
      }
    }
  });

  if (clsObserver) {
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        onMetric({ name: 'CLS', value: clsValue, rating: rate('CLS', clsValue) });
        clsObserver.disconnect();
      }
    }, { once: true });
  }

  // ── FCP (First Contentful Paint) ────────────────────────────────────────
  observe('paint', (entries) => {
    const fcp = entries.find((e) => e.name === 'first-contentful-paint');
    if (fcp) {
      onMetric({ name: 'FCP', value: fcp.startTime, rating: rate('FCP', fcp.startTime) });
    }
  });

  // ── TTFB (Time to First Byte) ──────────────────────────────────────────
  observe('navigation', (entries) => {
    const nav = entries[0];
    if (nav) {
      const value = nav.responseStart - nav.startTime;
      onMetric({ name: 'TTFB', value, rating: rate('TTFB', value) });
    }
  });
}
