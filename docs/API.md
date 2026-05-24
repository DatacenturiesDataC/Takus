# Takus API Reference

> All endpoints are deployed as [Netlify Functions](https://docs.netlify.com/functions/overview/)
> and are available under the site's base URL (e.g. `https://takus.netlify.app`).
>
> **Origin policy**: Every mutating endpoint validates the `Origin` header and
> rejects requests that do not originate from the deployment URL or `localhost`.

---

## Table of Contents

- [Share](#share)
- [Feedback](#feedback)
- [Workspace](#workspace)
- [AI Proxy](#ai-proxy)
- [Jira](#jira)
- [Notion](#notion)

---

## Share

Shareable summary links with automatic 30-day expiration. Backed by Netlify Blobs
(store: `shares`).

### `POST /api/share`

Create a shareable summary link.

**Origin check**: ✅ Must match deployment URL or `localhost`.

**Rate limit**: 20 requests per hour per origin (in-memory, best-effort).

#### Request

| Header           | Required | Description            |
| ---------------- | -------- | ---------------------- |
| `Content-Type`   | Yes      | `application/json`     |
| `Content-Length`  | —        | Rejected if > 500 KB   |

```jsonc
// Body
{
  "title":     "string  (required)",
  "aiSummary": "string  (required)",
  "date":      "string  (optional — ISO 8601 or display date)",
  "type":      "string  (optional — content type label)"
}
```

#### Response `201 Created`

```json
{
  "id":  "a1b2c3d4e5f6",
  "url": "/api/share?id=a1b2c3d4e5f6"
}
```

#### Errors

| Status | Condition                              |
| ------ | -------------------------------------- |
| 400    | Invalid JSON body                      |
| 400    | Missing `title` or `aiSummary`         |
| 403    | Origin mismatch                        |
| 405    | Method other than GET/POST             |
| 413    | Payload exceeds 500 KB                 |
| 429    | Rate limit exceeded (Retry-After: 3600)|

---

### `GET /api/share?id=<id>`

Retrieve a previously shared summary.

#### Query Parameters

| Param | Required | Description                                  |
| ----- | -------- | -------------------------------------------- |
| `id`  | Yes      | 4–16 character lowercase hex share ID        |

#### Response `200 OK`

```json
{
  "title":     "Meeting recap",
  "date":      "2025-05-20",
  "type":      "meeting",
  "aiSummary": "Key decisions were …",
  "createdAt": 1716220000000,
  "expiresAt": 1718812000000
}
```

Cache header: `Cache-Control: public, max-age=86400`

#### Errors

| Status | Condition                                |
| ------ | ---------------------------------------- |
| 400    | Missing or malformed `id`                |
| 404    | Share not found                          |
| 410    | Share has expired (30-day TTL elapsed)   |

---

## Feedback

User/system feedback collection. Backed by Netlify Blobs (store: `feedback`).

### `POST /api/feedback`

Submit feedback.

**Origin check**: ✅ Must match deployment URL or `localhost`.

#### Request

| Header           | Required | Description            |
| ---------------- | -------- | ---------------------- |
| `Content-Type`   | Yes      | `application/json`     |
| `Content-Length`  | —        | Rejected if > 100 KB   |

```jsonc
// Body
{
  "category":     "string  (required — one of: bug, feature_request, ux, performance, other)",
  "description":  "string  (required — min 5 chars, truncated to 2000)",
  "timestamp":    "string  (optional — ISO 8601, defaults to server time)",
  "contact_email": "string  (optional — truncated to 100 chars)",
  "device_context": {
    "app_version":        "string",
    "browser":            "string",
    "os":                 "string",
    "screen":             "string",
    "language":           "string",
    "connected_providers": ["string"],
    "ai_provider":        "string",
    "enabled_features":   ["string"],
    "storage_used_mb":    0,
    "online":             true
  },
  "recent_errors": [
    { "message": "string", "timestamp": "string" }
  ]
}
```

All fields inside `device_context` and `recent_errors` are sanitized and
length-capped server-side.

#### Response `201 Created`

```json
{
  "received": true,
  "id": "fb_abcdef_123456"
}
```

#### Errors

| Status | Condition                                        |
| ------ | ------------------------------------------------ |
| 400    | Invalid JSON body                                |
| 400    | Missing or invalid `category`                    |
| 400    | `description` missing or shorter than 5 chars    |
| 403    | Origin mismatch                                  |
| 405    | Method other than POST                           |
| 413    | Payload exceeds 100 KB                           |

---

## Workspace

Multi-tenant workspace management with invite codes and member/admin auth.
Backed by Netlify Blobs (store: `workspaces`).

### `POST /api/workspace`

Create a new workspace.

**Origin check**: ✅

#### Request

```jsonc
{
  "name":       "string  (required — 2–100 chars)",
  "adminName":  "string  (required — 1–50 chars)",
  "aiProvider": "string  (required — e.g. 'openai' or 'gemini')",
  "aiKey":      "string  (required — max 200 chars)"
}
```

#### Response `201 Created`

```json
{
  "id":         "ws_abcd1234",
  "adminToken": "Abc123…  (32-char token)",
  "inviteCode": "WXYZ-1234",
  "name":       "My Team"
}
```

#### Errors

| Status | Condition                                    |
| ------ | -------------------------------------------- |
| 400    | Missing required fields                      |
| 400    | `name` length outside 2–100                  |
| 400    | `adminName` length outside 1–50              |
| 400    | `aiKey` exceeds 200 chars                    |
| 403    | Origin mismatch                              |

---

### `GET /api/workspace?code=<inviteCode>`

Look up a workspace by invite code (public preview — no auth required).

#### Query Parameters

| Param  | Required | Description                     |
| ------ | -------- | ------------------------------- |
| `code` | Yes      | Invite code (e.g. `WXYZ-1234`) |

#### Response `200 OK`

```json
{
  "id":          "ws_abcd1234",
  "name":        "My Team",
  "aiProvider":  "openai",
  "memberCount": 3
}
```

#### Errors

| Status | Condition                  |
| ------ | -------------------------- |
| 400    | Missing `code` parameter   |
| 404    | Workspace not found        |

---

### `POST /api/workspace/join`

Join a workspace via invite code.

**Origin check**: ✅

#### Request

```jsonc
{
  "inviteCode": "string  (required)",
  "memberName": "string  (required)"
}
```

#### Response `200 OK`

```json
{
  "id":          "ws_abcd1234",
  "name":        "My Team",
  "memberToken": "Xyz789…  (32-char token)",
  "aiProvider":  "openai",
  "inviteCode":  "WXYZ-1234"
}
```

#### Errors

| Status | Condition                             |
| ------ | ------------------------------------- |
| 400    | Missing `inviteCode` or `memberName`  |
| 403    | Origin mismatch                       |
| 404    | No workspace found for invite code    |
| 409    | Duplicate member name                 |

---

### `GET /api/workspace/me`

Get workspace info for the authenticated member.

#### Required Headers

| Header           | Description              |
| ---------------- | ------------------------ |
| `x-workspace-id` | Workspace ID             |
| `x-member-token` | Member's auth token      |

#### Response `200 OK`

```json
{
  "id":          "ws_abcd1234",
  "name":        "My Team",
  "aiProvider":  "openai",
  "inviteCode":  "WXYZ-1234",
  "memberCount": 3,
  "memberName":  "Alice",
  "settings":    {}
}
```

#### Errors

| Status | Condition              |
| ------ | ---------------------- |
| 401    | Missing headers        |
| 403    | Invalid member token   |
| 404    | Workspace not found    |

---

### `GET /api/workspace/members`

List all workspace members (admin only).

#### Required Headers

| Header           | Description        |
| ---------------- | ------------------ |
| `x-workspace-id` | Workspace ID       |
| `x-admin-token`  | Admin auth token   |

#### Response `200 OK`

```json
{
  "members": [
    { "name": "Alice", "joinedAt": 1716220000000, "isAdmin": true },
    { "name": "Bob",   "joinedAt": 1716220005000, "isAdmin": false }
  ]
}
```

#### Errors

| Status | Condition              |
| ------ | ---------------------- |
| 401    | Missing headers        |
| 403    | Invalid admin token    |
| 404    | Workspace not found    |

---

### `DELETE /api/workspace/members`

Remove a member from the workspace (admin only).

**Origin check**: ✅

#### Required Headers

| Header           | Description        |
| ---------------- | ------------------ |
| `x-workspace-id` | Workspace ID       |
| `x-admin-token`  | Admin auth token   |

#### Request

```json
{
  "memberName": "Bob"
}
```

#### Response `200 OK`

```json
{
  "removed":     "Bob",
  "memberCount": 2
}
```

#### Errors

| Status | Condition                            |
| ------ | ------------------------------------ |
| 400    | Missing `memberName`                 |
| 400    | Attempting to remove the admin       |
| 401    | Missing headers                      |
| 403    | Invalid admin token / origin         |
| 404    | Workspace or member not found        |

---

### `PATCH /api/workspace`

Update workspace settings (admin only).

**Origin check**: ✅

#### Required Headers

| Header           | Description        |
| ---------------- | ------------------ |
| `x-workspace-id` | Workspace ID       |
| `x-admin-token`  | Admin auth token   |

#### Request

Only the following fields are accepted (allowlist):

```jsonc
{
  "name":       "string  (optional)",
  "aiProvider": "string  (optional)",
  "aiKey":      "string  (optional)"
}
```

#### Response `200 OK`

Returns the public workspace object (sensitive fields stripped):

```json
{
  "id":          "ws_abcd1234",
  "name":        "Renamed Team",
  "createdAt":   1716220000000,
  "inviteCode":  "WXYZ-1234",
  "aiProvider":  "gemini",
  "memberCount": 3,
  "settings":    {}
}
```

#### Errors

| Status | Condition              |
| ------ | ---------------------- |
| 400    | Invalid JSON body      |
| 401    | Missing headers        |
| 403    | Invalid admin token    |
| 404    | Workspace not found    |

---

### `POST /api/workspace/invite`

Regenerate the workspace invite code (admin only).

**Origin check**: ✅

#### Required Headers

| Header           | Description        |
| ---------------- | ------------------ |
| `x-workspace-id` | Workspace ID       |
| `x-admin-token`  | Admin auth token   |

#### Response `200 OK`

```json
{
  "inviteCode": "ABCD-5678"
}
```

#### Errors

| Status | Condition              |
| ------ | ---------------------- |
| 401    | Missing headers        |
| 403    | Invalid admin token    |
| 404    | Workspace not found    |

---

## AI Proxy

Proxies AI requests (transcription, chat, embeddings) to OpenAI or Gemini using
the workspace's stored API key. Members never see the raw key.

**Authentication**: All endpoints require workspace membership via headers.

**Rate limit**: 100 requests per hour per workspace (persisted in Netlify Blobs
store: `rate-limits`).

### Common Required Headers

| Header           | Description        |
| ---------------- | ------------------ |
| `x-workspace-id` | Workspace ID       |
| `x-member-token` | Member auth token  |

### Common Errors (all sub-endpoints)

| Status | Condition                                      |
| ------ | ---------------------------------------------- |
| 400    | Workspace has no AI API key configured         |
| 401    | Missing `x-workspace-id` / `x-member-token`   |
| 403    | Invalid member token / origin mismatch         |
| 404    | Unknown sub-endpoint or workspace not found    |
| 405    | Method other than POST                         |
| 429    | Rate limit exceeded (includes `retryAfter` s)  |
| 502    | Upstream AI request failed                     |

---

### `POST /api/ai-proxy/chat`

Proxy a chat completion request.

#### Request

```jsonc
{
  "messages": [
    { "role": "user", "content": "Summarize this meeting…" }
  ],
  "model": "string  (optional — defaults to provider default)"
}
```

#### Response

Passes through the upstream provider's JSON response verbatim with the
provider's HTTP status code.

- **OpenAI**: Standard chat completions response.
- **Gemini**: `generateContent` response (messages are translated to Gemini
  format automatically).

---

### `POST /api/ai-proxy/transcribe`

Proxy an audio transcription request.

#### Request

`Content-Type: multipart/form-data`

| Field    | Required | Description                                      |
| -------- | -------- | ------------------------------------------------ |
| `file`   | Yes      | Audio/video file (max 100 MB, `audio/*` or `video/*`) |
| `model`  | No       | Model name (Gemini only)                         |
| `prompt` | No       | Transcription prompt (Gemini only, default: "Transcribe this audio accurately.") |

Additional form fields for OpenAI (e.g. `language`, `response_format`) are
forwarded as-is.

#### Response

Passes through the upstream provider's JSON response verbatim.

#### Extra Errors

| Status | Condition                        |
| ------ | -------------------------------- |
| 400    | Invalid form data                |
| 400    | File too large (> 100 MB)        |
| 400    | Invalid file MIME type           |

---

### `POST /api/ai-proxy/embed`

Proxy an embedding request.

#### Request

```jsonc
{
  "input": "string | string[]  (required — text to embed)",
  "model": "string  (optional — e.g. 'text-embedding-004' for Gemini)"
}
```

#### Response

Passes through the upstream provider's JSON response verbatim.

- **OpenAI**: Standard embeddings response.
- **Gemini**: `batchEmbedContents` response.

---

## Jira

CORS proxy for Jira Cloud REST API v3. Credentials are supplied per-request
from the browser's Identity Vault — nothing is stored server-side.

### `POST /api/jira`

**Origin check**: ✅

**CORS preflight**: `OPTIONS /api/jira` returns `204` with appropriate headers.

#### Request

```jsonc
{
  // ── Authentication (always required) ──
  "host":    "string  (required — e.g. 'myteam.atlassian.net')",
  "email":   "string  (required — Jira account email)",
  "token":   "string  (required — Jira API token)",

  // ── Dry-run mode (verify connection) ──
  "dryRun":  true,

  // ── Issue creation (when dryRun is false/absent) ──
  "project":     "string  (required — Jira project key, e.g. 'TAKUS')",
  "summary":     "string  (required — issue title)",
  "description": "string  (optional — falls back to summary)",
  "issueType":   "string  (optional — defaults to 'Task')"
}
```

#### Response — Dry Run `200 OK`

```json
{
  "ok": true,
  "displayName": "Alice Smith"
}
```

#### Response — Issue Created `201 Created`

```json
{
  "ok":  true,
  "key": "TAKUS-42",
  "url": "https://myteam.atlassian.net/browse/TAKUS-42"
}
```

#### Errors

| Status | Condition                                        |
| ------ | ------------------------------------------------ |
| 400    | Invalid JSON body                                |
| 400    | Missing `host`, `email`, or `token`              |
| 400    | Missing `project` or `summary` (issue creation)  |
| 403    | Origin mismatch                                  |
| 405    | Method other than POST/OPTIONS                   |
| 4xx    | Jira auth failure (status forwarded from Jira)   |
| 502    | Network error reaching Jira                      |

---

## Notion

CORS proxy for Notion API (version `2022-06-28`). Credentials supplied
per-request from the browser's Identity Vault.

### `POST /api/notion`

**Origin check**: ✅

**CORS preflight**: `OPTIONS /api/notion` returns `204` with appropriate headers.

#### Common Fields

| Field    | Required | Description                         |
| -------- | -------- | ----------------------------------- |
| `apiKey` | Yes      | Notion integration token            |
| `action` | Yes      | One of: `verify`, `listDatabases`, `createPage` |

---

#### Action: `verify`

Verify the Notion API key by fetching the current user.

**Request**:
```json
{ "apiKey": "secret_…", "action": "verify" }
```

**Response `200 OK`**:
```json
{ "ok": true, "name": "Takus Bot" }
```

---

#### Action: `listDatabases`

List databases accessible to the integration (max 20).

**Request**:
```json
{ "apiKey": "secret_…", "action": "listDatabases" }
```

**Response `200 OK`**:
```json
{
  "ok": true,
  "databases": [
    { "id": "abc123…", "title": "Meeting Notes" }
  ]
}
```

---

#### Action: `createPage`

Create a new page in a Notion database or as a child of an existing page.

**Request**:
```jsonc
{
  "apiKey":     "secret_…",
  "action":     "createPage",
  "databaseId": "string  (required if no parentId)",
  "parentId":   "string  (required if no databaseId)",
  "title":      "string  (optional — used when properties is omitted)",
  "content":    "string  (optional — simple markdown, converted to Notion blocks)",
  "properties": {}       // optional — raw Notion properties object; overrides title
}
```

Markdown conversion supports: `# ## ###` headings, `- *` bullet lists, and
paragraphs. Content is capped at 100 blocks and 2000 chars per block (Notion
API limits).

**Response `201 Created`**:
```json
{
  "ok":  true,
  "url": "https://notion.so/…",
  "id":  "page-id-…"
}
```

#### Errors

| Status | Condition                                   |
| ------ | ------------------------------------------- |
| 400    | Invalid JSON body                           |
| 400    | Missing `apiKey`                            |
| 400    | Unknown `action`                            |
| 400    | Missing `databaseId`/`parentId` for createPage |
| 403    | Origin mismatch                             |
| 405    | Method other than POST/OPTIONS              |
| 4xx    | Notion auth/API error (status forwarded)    |
| 502    | Network error reaching Notion               |
