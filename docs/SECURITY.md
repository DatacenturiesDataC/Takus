# Security

This document describes how Takus protects user data, credentials, and API access.

---

## Architecture Overview

Takus follows a **local-first, zero-knowledge** architecture:

- All user data (recordings, notes, summaries) stays in the browser's IndexedDB.
- No user content is ever sent to Takus servers.
- AI API keys are owned by the user (BYOK — Bring Your Own Key).
- Server-side functions are stateless proxies with no access to raw credentials beyond the per-request scope.

---

## API Key Storage — Identity Vault

Credentials (API keys, integration tokens) are stored using the **Identity Vault** (`src/lib/identity-vault.js`), which provides AES-GCM 256-bit encryption:

| Property | Detail |
|----------|--------|
| **Algorithm** | AES-GCM with 256-bit keys |
| **Key generation** | `crypto.subtle.generateKey()` via the Web Crypto API |
| **Key extractability** | `false` — the `CryptoKey` object cannot be exported as raw bytes |
| **Key storage** | Structured-cloned into IndexedDB (settings store, key `_vaultKey`) |
| **IV** | 12-byte random IV generated per encryption via `crypto.getRandomValues()` |
| **Envelope format** | `{ iv: number[], data: number[] }` — serialisable, stored in IndexedDB |

### Credential Lifecycle

1. User enters a credential (e.g. OpenAI API key) in the UI.
2. `saveCredential(key, value)` encrypts the plaintext and stores the envelope in IndexedDB.
3. `loadCredential(key)` retrieves and decrypts the envelope. Returns `''` on failure.
4. `clearCredential(key)` removes the envelope from IndexedDB.

The raw CryptoKey never leaves IndexedDB. If the browser profile is deleted, all credentials are permanently lost.

### Workspace AI Keys (Server-Side)

When a workspace is created, the admin's AI API key is stored in **Netlify Blobs** (store: `workspaces`). It is:
- Transmitted over HTTPS only.
- Never logged or exposed in API responses.
- Accessible only to authenticated workspace members via the AI proxy.
- Never returned in public workspace lookups (stripped by `publicWorkspace()`).

---

## Security Headers

All responses from `/*` include the following headers (configured in [`netlify.toml`](../netlify.toml)):

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | Restrictive allowlist | Controls which origins can load scripts, styles, fonts, media, and make network requests. See full policy in `netlify.toml`. |
| `X-Frame-Options` | `DENY` | Prevents clickjacking by blocking all iframe embedding. |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing attacks. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer information sent to third parties. |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(self), geolocation=()` | Restricts access to sensitive browser APIs. Geolocation is fully disabled. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforces HTTPS for 2 years with HSTS preload eligibility. |

### CSP Allowlist (Summary)

| Directive | Allowed Origins |
|-----------|----------------|
| `default-src` | `'self'` |
| `script-src` | `'self'`, `'unsafe-inline'`, `'unsafe-eval'`, Google, Microsoft, CDNs |
| `style-src` | `'self'`, `'unsafe-inline'`, Google Fonts |
| `font-src` | `'self'`, Google Fonts |
| `connect-src` | `'self'`, OpenAI, Gemini, Google, Microsoft Graph, Linear, GitHub |
| `frame-src` | Google Accounts, Microsoft login |
| `worker-src` | `'self'`, `blob:` |

---

## Rate Limiting

### AI Proxy (`ai-proxy.mjs`)
- **Limit:** 100 requests per hour per workspace.
- **Storage:** Netlify Blobs (store: `rate-limits`), keyed by workspace ID.
- **Behaviour:** Returns `429 Too Many Requests` with a `retryAfter` value in seconds.
- **Window:** Sliding 1-hour window; resets when the window expires.

### Share Function (`share.mjs`)
- **Limit:** 20 shares per hour per origin.
- **Storage:** In-memory `Map` (best-effort, resets on cold start).
- **Behaviour:** Returns `429` with `Retry-After: 3600` header.

---

## Input Validation

All Netlify Functions enforce strict input validation:

| Check | Functions | Detail |
|-------|-----------|--------|
| **Origin validation** | All | Requests must originate from the site URL or localhost. Blocks cross-origin abuse. |
| **HTTP method** | All | Only the documented methods are accepted (e.g. POST-only for AI proxy). Others return `405`. |
| **JSON parsing** | All POST handlers | Invalid JSON returns `400`. |
| **Required fields** | All POST handlers | Missing fields return `400` with descriptive error messages. |
| **Payload size** | `feedback.mjs` (100 KB), `share.mjs` (500 KB), `ai-proxy.mjs` (100 MB for audio) | Oversized payloads are rejected before processing. |
| **File type** | `ai-proxy.mjs` (transcribe) | Only `audio/*` and `video/*` MIME types are accepted. |
| **Share ID format** | `share.mjs` | Must match `/^[a-z0-9]{4,16}$/`. |
| **String length limits** | `workspace.mjs` | Workspace name (2–100 chars), admin name (1–50 chars), AI key (≤200 chars). |
| **Field sanitisation** | `feedback.mjs` | Device context and error arrays are allowlisted and truncated. |
| **Category validation** | `feedback.mjs` | Must be one of: `bug`, `feature_request`, `ux`, `performance`, `other`. |

---

## Authentication & Authorisation

### Workspace Membership

| Role | Token Header | Capabilities |
|------|-------------|--------------|
| **Admin** | `x-admin-token` | Full workspace management, member removal, invite regeneration, settings updates |
| **Member** | `x-member-token` | AI proxy access, workspace info lookup |

- Tokens are 32-character alphanumeric strings generated server-side.
- Tokens are validated against the workspace's member list on every request.
- Admin tokens are never returned in public workspace lookups.

### Integration Credentials (Jira, Notion)

- Credentials are sent **per-request** from the browser's Identity Vault.
- The proxy functions forward them to the third-party API and discard them.
- **Nothing is stored server-side** for Jira or Notion.

---

## OAuth Flows

### Google Sign-In
- **Protocol:** OAuth 2.0 with Google Identity Services (GIS).
- **Grant type:** Implicit / Authorization Code (handled by Google's JS SDK).
- **Client ID:** Configured in `public/config.js` → `google.clientId`.
- **Scopes:** Profile, email, Drive (file upload), Calendar (read/write).
- **Token storage:** Access tokens are held **in memory only** — never persisted to disk or IndexedDB.
- **Frame source:** CSP allows `frame-src https://accounts.google.com` for the consent popup.

### Microsoft Sign-In
- **Protocol:** OAuth 2.0 / OpenID Connect via MSAL.js.
- **Authority:** Configurable per-tenant or multi-tenant in `public/config.js` → `microsoft.authority`.
- **Client ID:** Configured in `public/config.js` → `microsoft.clientId`.
- **Scopes:** User profile, OneDrive file access, Microsoft Graph.
- **Token storage:** Managed by MSAL's built-in cache (session storage by default).
- **Frame source:** CSP allows `frame-src https://login.microsoftonline.com` for the login popup.

---

## Data Privacy

| Principle | Implementation |
|-----------|---------------|
| **Local-first storage** | All user data (recordings, notes, summaries, settings) is stored exclusively in the browser's IndexedDB. |
| **No telemetry** | Takus does not collect analytics, usage metrics, or telemetry of any kind. |
| **No tracking** | No cookies, fingerprinting, or third-party trackers. |
| **No server-side user data** | Server-side stores contain only workspace metadata, shared summaries (opt-in), and feedback (opt-in). |
| **Data portability** | Users can export their data at any time from the browser. |
| **Expiring shares** | Shared summaries auto-expire after 30 days and are cleaned up on access. |
| **BYOK model** | Users provide their own AI API keys — Takus never provisions or bills for AI usage. |

---

## Reporting Vulnerabilities

If you discover a security vulnerability in Takus, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email **security@takus.app** (or the project maintainer) with:
   - A description of the vulnerability.
   - Steps to reproduce.
   - Expected vs. actual behaviour.
   - Any relevant screenshots or logs.
3. You will receive an acknowledgement within **48 hours**.
4. We aim to release a fix within **7 days** of confirmed vulnerabilities.

We appreciate responsible disclosure and will credit reporters (with permission) in the changelog.
