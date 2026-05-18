
// Captures console errors, failed network requests, and user action events
// during a recording session. Runs entirely in the browser; no data leaves
// the page until the entry is approved.
//
// Privacy contract:
//   - Input VALUES are never captured (only element selectors + event types)
//   - Password / token / secret field selectors are redacted to "[redacted]"
//   - Network request bodies are never captured (status codes only)

const MAX_ENTRIES = 500; // cap per channel to avoid unbounded memory

/** Selector of an element, truncated and PII-field redacted. */
function _selector(el) {
  if (!el || el === document || el === window) return '(document)';
  try {
    const tag  = el.tagName?.toLowerCase() || 'unknown';
    const id   = el.id   ? `#${el.id}`   : '';
    const cls  = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const name = el.name  ? `[name="${el.name}"]`  : '';
    const type = el.type  ? `[type="${el.type}"]`  : '';
    const raw  = `${tag}${id}${cls}${name}${type}`;
    // Redact common PII field patterns
    if (/password|token|secret|api[_-]?key|auth|credential/i.test(raw)) return '[redacted-field]';
    return raw.slice(0, 80);
  } catch {
    return '(unknown)';
  }
}

function _now() { return Date.now(); }

export class Observer {
  constructor() {
    this._running  = false;
    this._consoleErrors  = [];  // { ts, level, message }
    this._networkErrors  = [];  // { ts, method, url, status }
    this._actions        = [];  // { ts, type, target, detail }
    this._cleanupFns     = [];
  }

  /** Start observing. Call once when entry begins. */
  start() {
    if (this._running) return;
    this._running = true;
    this._consoleErrors  = [];
    this._networkErrors  = [];
    this._actions        = [];

    this._hookConsole();
    this._hookNetwork();
    this._hookActions();
    this._hookErrors();
  }

  /** Stop observing and return a frozen snapshot. */
  stop() {
    if (!this._running) return this._snapshot();
    this._running = false;
    this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
    this._cleanupFns = [];
    return this._snapshot();
  }

  _snapshot() {
    return {
      consoleErrors: [...this._consoleErrors],
      networkErrors: [...this._networkErrors],
      actions:       [...this._actions],
    };
  }

  // ─── Console hook ──────────────────────────────────────────────────────────

  _hookConsole() {
    const levels = ['error', 'warn'];
    const originals = {};
    for (const level of levels) {
      originals[level] = console[level].bind(console);
      console[level] = (...args) => {
        originals[level](...args);
        if (!this._running) return;
        if (this._consoleErrors.length >= MAX_ENTRIES) return;
        const message = args.map(a => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch { return String(a); }
        }).join(' ').slice(0, 500);
        this._consoleErrors.push({ ts: _now(), level, message });
      };
    }
    this._cleanupFns.push(() => {
      for (const level of levels) console[level] = originals[level];
    });
  }

  // ─── Global error hook ─────────────────────────────────────────────────────

  _hookErrors() {
    const onError = (e) => {
      if (!this._running || this._consoleErrors.length >= MAX_ENTRIES) return;
      this._consoleErrors.push({
        ts: _now(),
        level: 'uncaught',
        message: `${e.message || 'Error'} (${e.filename || ''}:${e.lineno || ''})`.slice(0, 500),
      });
    };
    const onUnhandled = (e) => {
      if (!this._running || this._consoleErrors.length >= MAX_ENTRIES) return;
      const reason = e.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      this._consoleErrors.push({ ts: _now(), level: 'unhandled-rejection', message: msg.slice(0, 500) });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    this._cleanupFns.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    });
  }

  // ─── Network hook ──────────────────────────────────────────────────────────

  _hookNetwork() {
    // Patch fetch
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      let res;
      try {
        res = await origFetch(...args);
      } catch (fetchErr) {
        // Network-level failures (offline, DNS, CORS) throw a TypeError.
        // Log them so the observer captures true connectivity issues.
        if (this._running && this._networkErrors.length < MAX_ENTRIES) {
          const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url || '').slice(0, 200);
          const method = (args[1]?.method || 'GET').toUpperCase();
          this._networkErrors.push({ ts: _now(), method, url, status: 0, error: fetchErr.message?.slice(0, 100) || 'network error' });
        }
        throw fetchErr; // re-throw so callers still see the failure
      }
      if (this._running && (res.status >= 400) && this._networkErrors.length < MAX_ENTRIES) {
        const url  = (typeof args[0] === 'string' ? args[0] : args[0]?.url || '').slice(0, 200);
        const method = (args[1]?.method || 'GET').toUpperCase();
        this._networkErrors.push({ ts: _now(), method, url, status: res.status });
      }
      return res;
    };

    // Patch XHR
    const OrigXHR = window.XMLHttpRequest;
    const self = this;
    function PatchedXHR() {
      const xhr = new OrigXHR();
      const origOpen = xhr.open.bind(xhr);
      let _method = 'GET';
      let _url    = '';
      xhr.open = function(method, url, ...rest) {
        _method = method;
        _url    = String(url).slice(0, 200);
        return origOpen(method, url, ...rest);
      };
      xhr.addEventListener('load', function() {
        if (self._running && xhr.status >= 400 && self._networkErrors.length < MAX_ENTRIES) {
          self._networkErrors.push({ ts: _now(), method: _method.toUpperCase(), url: _url, status: xhr.status });
        }
      });
      return xhr;
    }
    PatchedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = PatchedXHR;

    this._cleanupFns.push(() => {
      window.fetch = origFetch;
      window.XMLHttpRequest = OrigXHR;
    });
  }

  // ─── Action hook ───────────────────────────────────────────────────────────

  _hookActions() {
    const push = (type, e, detail = '') => {
      if (!this._running || this._actions.length >= MAX_ENTRIES) return;
      this._actions.push({ ts: _now(), type, target: _selector(e.target), detail: String(detail).slice(0, 100) });
    };

    const onClick      = (e) => push('click',    e);
    const onScroll     = (e) => push('scroll',   e, `${Math.round(window.scrollY)}px`);
    const onNavigation = ()  => {
      if (!this._running || this._actions.length >= MAX_ENTRIES) return;
      this._actions.push({ ts: _now(), type: 'navigation', target: '(page)', detail: location.pathname.slice(0, 100) });
    };

    // Debounce scroll to at most 1 entry per second
    let _scrollTimer = null;
    const onScrollDebounced = (e) => {
      clearTimeout(_scrollTimer);
      _scrollTimer = setTimeout(() => onScroll(e), 1000);
    };

    // Keyboard: capture key name only (never value/character for privacy)
    const onKeydown = (e) => {
      if (!this._running || this._actions.length >= MAX_ENTRIES) return;
      if (['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        push('keydown', e, e.key);
      }
    };

    document.addEventListener('click',    onClick, { capture: true, passive: true });
    document.addEventListener('scroll',   onScrollDebounced, { capture: true, passive: true });
    document.addEventListener('keydown',  onKeydown, { capture: true, passive: true });
    window.addEventListener('popstate',   onNavigation);
    window.addEventListener('hashchange', onNavigation);

    // Intercept history.pushState / replaceState for SPA navigation
    const origPush    = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState    = (...a) => { origPush(...a);    onNavigation(); };
    history.replaceState = (...a) => { origReplace(...a); onNavigation(); };

    this._cleanupFns.push(() => {
      document.removeEventListener('click',   onClick,           { capture: true });
      document.removeEventListener('scroll',  onScrollDebounced, { capture: true });
      document.removeEventListener('keydown', onKeydown,         { capture: true });
      window.removeEventListener('popstate',   onNavigation);
      window.removeEventListener('hashchange', onNavigation);
      history.pushState    = origPush;
      history.replaceState = origReplace;
      clearTimeout(_scrollTimer);
    });
  }
}
