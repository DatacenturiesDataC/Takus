# Environment Variables

All server-side environment variables are used by Netlify Functions in `netlify/functions/`.
Takus is a local-first app — there is no backend database or server-side secrets beyond what Netlify provides automatically.

---

## Required

| Variable | Used By | Description |
|----------|---------|-------------|
| `URL` | `ai-proxy.mjs`, `feedback.mjs`, `jira.mjs`, `notion.mjs`, `share.mjs`, `workspace.mjs` | The site's canonical URL, used for origin validation on all API endpoints. **Automatically set by Netlify** at deploy time (e.g. `https://takus.netlify.app`). Falls back to `https://takus.netlify.app` if unset. |

> **Note:** `URL` is the _only_ environment variable used across the entire codebase. Netlify populates it automatically — you do not need to configure it manually.

---

## Optional

_There are no optional environment variables at this time._

All AI API keys (OpenAI, Gemini) are stored per-workspace in Netlify Blobs via the workspace management API — they are **never** set as environment variables. Integration credentials (Jira, Notion) are sent per-request from the browser's Identity Vault and are never stored server-side.

---

## Build-Time Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` (at build) | Standard Node environment flag. Used in `src/apps/registry.js` to gate test-only helpers. Set automatically by Vite / Vitest. |

---

## Client-Side Config

These values are set in [`public/config.js`](../public/config.js) and loaded at runtime via `window.__TAKUS_CONFIG__`:

| Key | Description |
|-----|-------------|
| `google.clientId` | Google OAuth 2.0 Client ID for Google Sign-In, Drive, and Calendar integration. |
| `drive.folderName` | Name of the Google Drive folder where recordings are stored (default: `Takus Recordings`). |
| `drive.makePublic` | Whether uploaded Drive files are shared publicly (default: `false`). |
| `calendar.enabled` | Enable/disable Google Calendar integration (default: `true`). |
| `microsoft.clientId` | Microsoft Entra (Azure AD) Application Client ID for Microsoft Sign-In and OneDrive. |
| `microsoft.authority` | Microsoft identity platform authority URL. Set to a tenant-specific URL to restrict sign-in to one directory, or use `/common` for any account. |

### Updating Client-Side Config

Edit `public/config.js` directly — it is a plain JavaScript file served as a static asset. Changes take effect on the next page load (no rebuild required).

```js
window.__TAKUS_CONFIG__ = {
  google: {
    clientId: 'YOUR_GOOGLE_CLIENT_ID',
  },
  drive: {
    folderName: 'Takus Recordings',
    makePublic: false,
  },
  calendar: {
    enabled: true,
  },
  microsoft: {
    clientId: 'YOUR_MICROSOFT_CLIENT_ID',
    authority: 'https://login.microsoftonline.com/YOUR_TENANT_ID',
  },
};
```
