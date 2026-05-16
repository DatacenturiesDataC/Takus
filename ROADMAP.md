# Takus — Product Roadmap & Developer Guide

## Vision: Agentic Knowledge Operating System

Takus is a **local-first, AI-agent-led platform that captures workplace intent**. It moves beyond the commodity of "screen recording" to provide **Knowledge Transformation** — turning every recording into a structured, searchable, and actionable asset.

> **"Make the video unnecessary for the viewer."**

The platform is built on four pillars:

| Pillar | Role | Time Axis |
|--------|------|-----------|
| **Record** | Ingestion engine — context-aware capture with specialist agents | Present |
| **Ask** | Knowledge base — Video-RAG semantic search across all recordings | Past |
| **Tasks** | Execution layer — AI-extracted tasks with contextual video clips | Future |
| **Connect** | Ecosystem — bi-directional sync with Jira, Slack, Notion, GitHub | World |

---

## Current Architecture

```
index.html                  ← app entry point
netlify.toml                ← Netlify build config + function routes
netlify/functions/
  share.mjs                 ← [Phase 13] short share URLs (Netlify Blobs)
  jira.mjs                  ← [Phase 13] Jira Cloud REST API proxy
  notion.mjs                ← [Phase 13] Notion API proxy
public/
  sw.js                     ← service worker (offline caching)
  _headers                  ← Netlify security headers
src/
  apps/                     ← [Phase 21] built-in app definitions
    registry.js             ← central registration point for all apps
    passport/index.js       ← identity management (core)
    recorder/index.js       ← recording, pipeline, upload (core)
    tasks/index.js          ← task management (core)
    ask/index.js            ← semantic search, RAG (core)
    goals/index.js          ← [Phase 38] goal preservation + lifecycle (core)
    inbox/index.js          ← [Phase 34] unified raw items queue (core)
    people/index.js         ← contacts, closeness
    insights/index.js       ← analytics, blind spots
    calendar/index.js       ← calendar polling, auto-record
    drive/index.js          ← cloud storage sync
    integrations/index.js   ← Slack/GitHub/Linear/Jira/Notion
  components/
    app-shell.js            ← top-level orchestrator; state machine, keyboard shortcuts
    app-manager.js          ← [Phase 21] app management dashboard UI
    header.js               ← logo, cloud provider badge
    recorder-panel.js       ← live recording controls (start/pause/resume/stop, upload)
    preview-canvas.js       ← waveform + camera preview
    review-panel.js         ← post-recording: video preview, trim, GIF, approve/discard
    upload-progress.js      ← upload progress bar (Google Drive / OneDrive)
    history-panel.js        ← recordings list: search, filter, AI summary, tasks, batch ops
    recording-detail.js     ← [Phase 14] 70/30 split recording workspace (code-split)
    tasks-panel.js          ← [Phase 1] Tasks for Takus / Tasks for Me dual pane
    global-tasks-panel.js   ← [Phase 14] aggregate tasks across all recordings
    share-panel.js          ← modal: email summary + transcript to participants
    session-config.js       ← [Phase 14] type chips, camera toggle, mic device selection
    settings-panel.js       ← AI provider + API key, recording quality, watermark
    type-picker.js          ← meeting / screen / presentation / update type cards
    consent-notice.js       ← first-run privacy notice
    toast.js                ← transient notification overlay
    archive-player.js       ← [Phase 11] lightweight replay (audio + frames + transcript)
  lib/
    app-interface.js        ← [Phase 21] TakusApp contract definition
    app-manager.js          ← [Phase 21] app lifecycle manager
    recorder.js             ← Recorder class (MediaRecorder wrapper, mic mixing, timer)
    audio-engine.js         ← Web Audio API: mix system + mic, level meter
    facecam.js              ← FacecamManager: PiP webcam + draggable fallback overlay
    observer.js             ← [Phase 1] Console sniffer, action log, DOM pulse
    ai-engine.js            ← Whisper STT + GPT-4o-mini; Gemini 2.0 Flash; task extraction
    state-machine.js        ← StateMachine class
    storage.js              ← IndexedDB v8: recordings, settings, nodes, edges, recovery, blobs
    config.js               ← runtime config (quality presets, OAuth client IDs)
    cloud-provider.js       ← Google Drive / OneDrive upload abstraction
    google-auth.js / google-drive.js / google-calendar.js / google-docs.js
    microsoft-auth.js / microsoft-onedrive.js / microsoft-calendar.js / microsoft-onenote.js
    ffmpeg-engine.js        ← FFmpeg WASM (GIF export, video trim, watermark)
    icons.js                ← SVG icon helpers
    graph/
      node-registry.js      ← [Phase 21] node type definitions, validation, creation
      task-store.js         ← [Phase 21] unified task API (embedded + standalone nodes)
      vector-utils.js       ← [Phase 21] shared vector operations
    integrations/
      slack.js / github.js / linear.js
      jira.js               ← [Phase 13] Jira client (Identity Vault credentials)
      notion.js             ← [Phase 13] Notion client (Identity Vault credentials)
    migrations/
      v14-to-v15.js         ← [Phase 21] data migration to graph nodes store
    meeting-prep.js         ← [Knowledge OS] Meeting prep engine (calendar × contacts × recordings)
    daily-digest.js         ← [Knowledge OS] Daily digest generator (streak, tasks, stats)
    task-priority.js        ← [Knowledge OS] Task priority scoring (deadline × closeness × age)
```

### State Machine States

```
idle → requesting_access → previewing → recording → paused
     → reviewing → processing → uploading → complete | upload_failed
idle → reviewing  (crash-recovery resume path)
```

### IndexedDB Schema (DB: `takus`, version 8)

**recordings** store (keyPath: `id`, index: `date`):
```js
{
  id, title, date, duration, size,
  type: 'meeting' | 'screen' | 'presentation' | 'update',
  device, aiProvider,
  aiSummary,       // markdown
  aiTranscript,    // plain text
  aiVtt,           // WebVTT (OpenAI path only)
  aiDocLink,       // Google Docs / OneNote URL
  driveLink,       // Google Drive / OneDrive URL
  driveFolderId,   // Phase 9: folder ID in structured drive layout
  calendarEvent,   // Phase 14: { id, summary, start, end, organizer }
  participants,    // [{ name, email }]
  tasks,           // [{ id, type, action, payload, contextTimestamp, done }]  ← Phase 1
  observerLog,     // { consoleErrors, networkErrors, actions }                ← Phase 1
  analytics,       // { fillerWords: {total,perMinute,breakdown,rating}, score: {score,label,color} } ← Phase 4a
  pinned,          // Phase 14e: boolean — pinned recordings sort first
  notes,           // Phase 14e: string — free-text user notes (auto-saved)
  state,           // Phase 20: 'raw' | 'processing' | 'active' (default: 'active')
  archiveStatus,   // Phase 10: 'active' | 'pending' | 'archived' | 'cold'
  archiveLog,      // Phase 10: [{ status, timestamp, reason }] — immutable audit trail
  isDocument,      // Phase 20: boolean — true for document-adapter ingested content
  sourceType,      // Phase 20: 'text' | 'markdown' | 'meeting-notes' | 'pdf-text'
}
```

**settings** store (keyPath: `key`): arbitrary key-value pairs (including `app:{appId}:{key}` namespaced settings)
**recovery** store (keyPath: `id`): crash-recovery chunks + updatedAt timestamp
**embeddings** store v3 (keyPath: `recordingId`): `{ recordingId, chunks: [{text, start, end, chunkIdx, embedding: number[]}] }`  ← Phase 2
**wiki** store v3 (keyPath: `id`, index: `date`): `{ id, date, query, answer, sources: [{recordingId, title}] }`  ← Phase 2
**vaultSync** store v4 (keyPath: `id`): `{ id, driveFolderId, drivePackageUploaded, archiveStatus, pinned, legalHold, lastSyncDate }`  ← Phase 9
**edges** store v6 (keyPath: `id`, indexes: `sourceKey`, `targetKey`, `edgeType`): knowledge graph relationships  ← Phase 16
**step_checkpoints** store v7 (keyPath: `id`): step executor crash recovery checkpoints  ← Phase 19
**nodes** store v8 (keyPath: `id`, indexes: `type`, `state`, `appId`, `createdAt`, compound `type_state`): unified graph nodes for the app platform  ← Phase 21

---

## What's Already Shipped (Phase 0 — Foundation ✅)

### Core Recording
- [x] Screen + audio capture (MediaRecorder, display + mic mixing)
- [x] Facecam PiP with draggable fallback overlay
- [x] Recording type picker (Meeting / Screen / Presentation / Status Update)
- [x] Pre-recording session config (title, camera, mic device, mic level test)
- [x] Live stats bar (duration, file size) with recording favicon
- [x] Pause / resume with elapsed-time tracking
- [x] 60-minute hard limit with 10-minute warning toast
- [x] Keyboard shortcuts (configurable; default: Space, S, R, ,)
- [x] 3-2-1 countdown before recording starts

### Review & Export
- [x] Review panel: video preview, trim (start/end), speed control, loop
- [x] GIF export via FFmpeg WASM
- [x] Watermark overlay (configurable text, FFmpeg drawtext)
- [x] Local blob storage (re-watch without cloud)

### AI Summaries (Structured per Type)
- [x] OpenAI Whisper transcription → GPT-4o-mini summary
- [x] Gemini 2.0 Flash transcription + summary
- [x] Meeting → Summary, Action Items, Key Decisions, Decision Ledger table, Sentiment
- [x] Screen → Overview, Key Steps, Bug Report card, Technical Notes
- [x] Presentation → Summary, Key Points, Chapter List with timestamps, Audience Takeaways
- [x] Status Update → TL;DR bullets, Ticket References, Blockers, Next Steps

### Cloud & Integrations
- [x] Google Drive + OneDrive resumable upload with progress bar
- [x] Google Docs / OneNote export for AI summaries
- [x] Google Calendar + Outlook Calendar (auto-fetch attendees)

### History & Sharing
- [x] Full-text search with yellow highlight
- [x] Type filter chips
- [x] AI summary tab / transcript tab (state preserved across search re-renders)
- [x] Inline VTT transcript viewer with clickable timestamps
- [x] Markdown rendering (bold, italic, headers, lists, inline code, tables)
- [x] Copy transcript, Download VTT, Download .md, Copy link
- [x] Re-watch recordings locally (modal player)
- [x] Inline title rename (double-click)
- [x] Share panel: email/mailto for participants; Select All/None for 2+

### Infrastructure
- [x] PWA: installable, offline-capable service worker
- [x] Crash recovery (IndexedDB chunks every 10 s) + Resume → review panel
- [x] Settings: AI provider/key, recording quality, audio quality, watermark, shortcuts

---

## Phase 1 — The Scribe (Record-to-Task Pipeline) ✅ Shipped

**Goal:** Deliver immediate, tangible value from every recording by extracting actionable tasks automatically — no user effort required after hitting Stop.

### 1a. Observer Module (`src/lib/observer.js`)
Runs silently during any recording session. Captures three data channels:

| Channel | What it captures | Used by |
|---------|-----------------|---------|
| **Console Sniffer** | `console.error`, `console.warn`, uncaught exceptions, 4xx/5xx XHR/fetch responses | Screen agent |
| **Action Log** | `click`, `input`, `scroll`, `keydown` (key only, not value), `navigation` events with timestamps | All agents |
| **Network Sniffer** | Intercepts `fetch` / `XMLHttpRequest` for failed status codes; logs url + status + timestamp | Screen agent |

Privacy: input field _values_ are never logged. Only element selectors and event types.

### 1b. Task Extraction (`src/lib/ai-engine.js`)
New function `extractTasks(transcript, observerLog, type, apiKey, provider)`:

**Output schema:**
```js
{
  takusTasks: [
    { id, action, payload, contextTimestamp, done: false }
    // actions: CREATE_JIRA_TICKET | DRAFT_SLACK_MESSAGE | CREATE_CALENDAR_EVENT | OPEN_PR | LOG_DECISION
  ],
  meTasks: [
    { id, note, contextTimestamp, done: false }
    // extracted from verbal commitments: "I will…", "I'll…", "We need to…"
  ]
}
```

- Meeting → extracts commitments, delegate items, unresolved conflicts
- Screen → extracts bug report tasks with console error context
- Presentation → extracts follow-up actions mentioned by presenter
- Status Update → extracts ticket references and blocker escalations

### 1c. Tasks Panel UI (`src/components/tasks-panel.js`)
Dual-pane component rendered in the history item expansion (alongside AI Summary / Transcript tabs):

- **Tasks for Takus** pane: automated workflow suggestions (draft Jira ticket, post to Slack, create calendar event) — each with a one-click action button and a 5-second context clip timestamp
- **Tasks for Me** pane: personal follow-ups extracted from speech — each with a checkbox, note, and timestamp link
- Task completion state persisted to IndexedDB via `saveRecording()`

### 1d. History Integration
- "Tasks" tab added to AI summary box (alongside Summary / Transcript)
- Task badge on history item row showing count of open tasks
- Completed tasks shown with strikethrough; completion persisted

---

## Phase 2 — Ask (Video-RAG Knowledge Base) ✅ Shipped

**Goal:** Let users ask natural language questions across all their recordings and get timestamped answers, not another search results list.

### Shipped in Phase 2

- [x] **`src/lib/embeddings.js`** — `chunkTranscript()` (400-char overlapping chunks), `embedTranscript()` (batch API calls), `cosineSimilarity()`, `semanticSearch()` (top-k retrieval)
- [x] **Embedding generation** — called after every AI transcription; persisted to `IndexedDB:embeddings` store (DB v3); silently skipped on API error
- [x] **`src/lib/ai-engine.js`** — `generateAnswer()`: RAG prompt → GPT-4o-mini / Gemini 2.0 Flash; cites `[Source N]` in reply
- [x] **`src/components/ask-panel.js`** — Ask bar with placeholder showing embedding availability, loading dots, answer card, source chips, "Save to Wiki" button
- [x] **Living Wiki** — Saved Q&A entries stored in `IndexedDB:wiki`; shown below Ask bar as clickable re-run chips; individually deletable
- [x] **Cmd+K shortcut** — focuses Ask input from anywhere in the idle state
- [x] **Recording delete** — also removes associated embeddings from IndexedDB
- [x] **Clear all** — wipes embeddings + wiki alongside recordings

### Providers
- OpenAI: `text-embedding-3-small` (1536-dim, batch input)
- Gemini: `text-embedding-004` (768-dim, one-per-request)

### Scoping Constraints
- Personal (single-device) RAG: IndexedDB vectors, no backend required
- Team RAG (future): Netlify Blobs + Netlify Functions for shared vector index
- ✅ Timestamp linking to exact video position: shipped in Phase 11 (click-to-seek in transcript + inline timestamps)

---

## Phase 3 — Connect (Ecosystem Integrations) ✅ Shipped

**Goal:** Make Takus a bi-directional hub, not a dead end. Every task can be routed to where work actually happens.

### Shipped in Phase 3

- [x] **`src/lib/identity-vault.js`** — AES-GCM 256-bit encryption via SubtleCrypto; auto-generated `CryptoKey` stored in IndexedDB with `extractable:false`; `saveCredential/loadCredential/clearCredential` API
- [x] **`src/lib/integrations/slack.js`** — `postToSlack(webhookUrl, payload)` via Incoming Webhook (CORS-supported); `buildSlackPayload(task, recording)` with Block Kit formatting
- [x] **`src/lib/integrations/github.js`** — `createGitHubIssue(token, owner, repo, issue)` via GitHub REST API; `verifyGitHubToken()`; `buildGitHubIssuePayload(task, recording)` with bug-report markdown
- [x] **`src/lib/integrations/linear.js`** — `createLinearIssue(apiKey, teamId, issue)` via Linear GraphQL; `verifyLinearKey()`; `fetchLinearTeams()`; `buildLinearIssuePayload()` with priority mapping
- [x] **`src/components/connect-panel.js`** — `openConnectModal()`: integration cards for Slack, GitHub, Linear; per-card status badge, inline config form, Test and Save buttons, Disconnect; accessible from Settings → Connect
- [x] **Tasks panel routing** — "Run" button dispatches to configured integration; falls back to clipboard + "Open Settings → Connect" toast hint; loading spinner on btn during async call
- [x] **Settings modal** — "Connect integrations" section at bottom with arrow button to open Connect modal
- [x] **New icons** — `plug`, `chevronDown`

### Task → Integration routing
| Task action | Primary | Fallback |
|---|---|---|
| `DRAFT_SLACK_MESSAGE` / `DRAFT_SHARE_MESSAGE` | Slack Incoming Webhook | Clipboard copy |
| `CREATE_BUG_REPORT` | Jira (Bug) → GitHub → Linear | Clipboard copy |
| `UPDATE_TICKET` | Jira → Linear | Clipboard copy |
| `LOG_DECISION` | Notion → Clipboard | — |
| `CREATE_CALENDAR_EVENT` | Google Calendar URL | — |

### What's browser-accessible without a proxy
- ✅ Slack Incoming Webhooks (CORS-enabled)
- ✅ GitHub REST API v3 (CORS + PAT)
- ✅ Linear GraphQL API (CORS + API key)
- ✅ Jira Cloud (via Netlify Function proxy — Phase 13)
- ✅ Notion (via Netlify Function proxy — Phase 13)

### Netlify Build Plugin — deferred
- "Inject Takus" toggle for Netlify-deployed sites (niche feature, low priority)
- Feedback recordings routed to site owner's workspace

---

## Phase 4a — Browser-Achievable Specialist Agents ✅ Shipped

Pure browser-side analytics and routing. Zero additional network cost; runs locally after AI processing.

### Shipped in Phase 4a

- ✅ **Filler-word analyser** (`src/lib/analytics.js`) — 12 regex patterns, per-minute rate, `excellent/good/fair/needs_work` rating
- ✅ **Quality score** (0–100) — weighted from AI summary presence, task density, decision count, filler density
- ✅ **TL;DW strip** — up to 3 top-level bullets from AI summary shown inline in history cards
- ✅ **Chapter navigation** — `parseChapters()` reads `[~MM:SS]` markers from presentation summaries; watch modal renders seekable chapter buttons
- ✅ **Urgency auto-route** — `isUrgentUpdate()` detects P0/blocker/critical signals; auto-posts to Slack for `update`-type recordings
- ✅ **Quality + filler badges** in history card meta tags
- ✅ **Analytics wired into `_processAI`** — stored on `historyEntry.analytics` after every transcription

### Phase 4b — Deferred (requires ML models / AI Gateway)

These features require heavy ML inference or external AI services beyond current scope. Netlify Functions infra is now in place (Phase 13).

### Meeting Agent: Semantic Diarization
- Speaker attribution using calendar invite cross-reference
- Face-to-voice mapping (local visual inference via WebLLM)
- Verbal signifier detection: "I will…" → Me Task; "We decided…" → Decision Ledger; "Can you…" → Delegate Task
- Conflict detection: surface when a new decision contradicts a past recording's Decision Ledger

### Screen Agent: Rehydratable Bug Reports
- Full DOM/AOM snapshots (not just event log) serialised to Netlify Blobs
- "Open in DevTools" button in Jira tasks: loads headless browser with exact DOM state at the moment of the error
- WebGPU / WebLLM local PII redaction: blur password/token fields in the video buffer before upload

### Presentation Agent: Ghost Producer
- Gaze correction via lightweight browser-based face model
- Auto-chaptering using OCR on slide transitions (Tesseract.js or Gemini multimodal)
- Smart camera bubble repositioning when content is detected beneath it
- One-click audio polish (silence/filler removal via FFmpeg)

### Updates Agent: AI-Voiced Recap
- 15-second AI audio abstract cloned from the user's voice (Lyria model)
- Automatic Jira routing based on project context detected from screen

---

## Phase 5 — CORTEX (Cross-Recording Intelligence) ✅ Shipped

**Goal:** Surface patterns, trends, and decisions *across* all recordings — transforming the library from a list of sessions into a living knowledge base.

### Shipped in Phase 5

- ✅ **`src/components/insights-panel.js`** — Insights dashboard tab with:
  - Stats strip: total recordings, hours recorded, AI-processed count, recordings with tasks
  - Quality trend sparkline (inline SVG, last 10 scored recordings)
  - Filler word leaderboard (horizontal bar chart, aggregated across all recordings)
  - Decision ledger: all `LOG_DECISION` tasks across all recordings, newest first
- ✅ **Tab bar** in IDLE state — switches between History (Ask + recordings list) and Insights; lazy-renders insights on first click
- ✅ **Insights refresh** — panel re-renders automatically after each AI processing cycle

### Phase 5b — Partially Shipped

- ✅ **Related recordings** — shipped in Phase 6 (`history-panel.js`); semantically similar recordings shown as chips when an AI-processed recording is expanded
- ✅ **Decision conflict detection** — shipped in Insights panel (`insights-panel.js`); word-overlap heuristic flags potentially conflicting LOG_DECISION entries
- **Team RAG** — shared vector index via Netlify Blobs + Functions (deferred — requires shared DB design)

---

## Phase 6 — NEXUS (Related Intelligence + Storage Health) ✅ Shipped

**Goal:** Close the feedback loop across recordings — surface what's similar, make storage self-managing.

### Shipped in Phase 6

- ✅ **Related recordings** (`history-panel.js`) — when a recording with embeddings is expanded, 2-3 semantically similar recordings are computed locally (mean cosine similarity, threshold 0.35) and shown as clickable chips below the summary. Clicking scrolls to and expands the related item. Zero network cost; purely from stored vectors.
- ✅ **Storage health card** (`insights-panel.js`) — new card at the bottom of the Insights tab showing:
  - `navigator.storage.estimate()` usage bar (MB used / GB quota)
  - Count + estimated MB of local video blobs older than 30 days
  - "Free space" button: deletes blobs for old recordings while preserving all metadata, AI summaries, and transcript embeddings
- ✅ **Duplicate handler fix** (`history-panel.js`) — removed stale second copy of `.ai-tab` and `.history-download-md` event listeners that were silently stacking on every `_applyFilters()` call
- ✅ **`.related-chip` CSS** — compact chip style for related recording buttons

### Phase 6b — Partially Shipped

- ✅ Decision conflict detection — shipped in Insights panel (word-overlap heuristic with 30% threshold)
- Team RAG / shared vector index (deferred — requires shared DB design)

---

## Phase 7 — SHARE + EXPORT (Library Portability) ✅ Shipped

**Goal:** Make recordings sharable and the library portable — no backend required for either.

### Shipped in Phase 7

- ✅ **Shareable summary links** (`shared-view.js` + `main.js`) — every AI-processed recording gets a "Share" button that encodes `{ title, date, type, aiSummary }` as base64 in a URL hash (`#share=…`). Opening the link renders a full-screen read-only summary overlay with markdown rendering, type badge, date, and "Download .md" action. No Takus account required. Copying the link flashes a check icon; falls back to a toast with the URL.
- ✅ **Library export** (`history-panel.js`) — "Export" button in history header downloads all recording metadata (AI summaries, transcripts, tasks, analytics) as `takus-backup-YYYY-MM-DD.json`. `observerLog` is excluded (privacy + size).
- ✅ **Library import** (`history-panel.js`) — "Import" button accepts a `.json` export file. Merges by recording ID — new entries added, existing IDs skipped. Shows "X added, Y skipped" toast.

### Phase 7b — Partially Shipped

- ✅ **Full ZIP export** (`src/lib/zip-export.js`) — "Full backup" button in history header bundles all recording metadata + video blobs + AI summaries + transcripts into a `.zip` file. Uses a zero-dependency browser-native ZIP builder (store method, CRC-32). Supports `showSaveFilePicker` with fallback to Blob download.
- ✅ **QR code generation** (`src/lib/qr-code.js`) — QR button on each AI-processed recording generates a scannable QR code for the shareable summary link. Zero-dependency QR encoder (byte mode, ECC level L, Reed-Solomon) renders to SVG. Modal with "Copy Link" button.
- ✅ **Shared summary page hosted at a stable short URL** — shipped in Phase 13b (`#s=<shortId>` via Netlify Blobs)

---

## Phase 8 — PULSE (Productivity Intelligence) ✅ Shipped

**Goal:** Surface work patterns over time and reduce friction before every recording session.

### Shipped in Phase 8

- ✅ **Activity heatmap** (`insights-panel.js`) — GitHub-style 52-week calendar grid (SVG, 53 columns × 7 rows) showing recording frequency per day. Purple intensity scale: 0–4+ recordings. Month labels on top axis; native tooltip on hover shows date and count. Rendered as the first card in the Insights tab.
- ✅ **Type breakdown donut** (`insights-panel.js`) — SVG donut chart showing proportional breakdown of recording types (meeting / screen / presentation / update) with per-type count and percentage legend. Only shown when 2+ distinct types exist.
- ✅ **Recording templates** (`session-config.js`) — Five quick-start chips above the title field: Standup, 1-on-1, Bug Bash, Demo, Sprint Review. Clicking a chip fills the title input and persists it immediately. Zero extra storage.
- ✅ **Desktop notifications** (`settings-panel.js` + `app-shell.js`) — Optional "Desktop notifications when AI finishes" toggle in Settings. Requests `Notification.permission` on first enable; gracefully handles denied state with a toast. Fires a `new Notification()` after every successful AI processing cycle if the tab may be in the background.
- ✅ **New icons** (`icons.js`) — `bell` (notification bell), `pieChart` (donut card header)

### Phase 8b — Partially Shipped

- ✅ **Heatmap cell click → filter history** (`insights-panel.js` + `app-shell.js`) — click a day cell on the activity heatmap to dispatch `takus:datefilter` custom event, which switches to History tab and applies a date filter showing only recordings from that day.

### Phase 8b — Fully Shipped

- ✅ **Busiest week annotation** — shipped in heatmap (`insights-panel.js`); shows "Peak: {date range} (count)" below the heatmap
- ✅ **Streak counter** — shipped in heatmap; shows "🔥 X-day streak" and "Y active days this year"
- ✅ **Notification grouping** — shipped; toast deduplication coalesces rapid-fire identical toasts into one with ×N count badge

---

## Phase 9 — VAULT (Structured Cloud Drive) ✅ Complete

**Goal:** Replace the current flat-file upload (single `.webm` dumped into a "Takus Recordings" folder) with a structured, conflict-resilient drive layout. Each recording becomes a self-contained folder with human-readable artefacts.

### Motivation

The current model uploads a single `{title}.webm` to the root of a "Takus Recordings" folder. This means:
- AI summaries and transcripts only exist in IndexedDB (lost on browser data clear)
- No way to recover metadata without the browser that recorded it
- No structured data for archival (Phase 10) to consume
- Cloud browsing is a flat list of opaque video files

### Drive Structure

```
Takus/                                  ← root, created on first authentication
│
├── recordings/                         ← screen, meeting, presentation captures
│   └── YYYY-MM/                        ← monthly bucket (e.g. 2026-05/)
│       └── {recording_id}/             ← one folder per recording
│           ├── original.webm           ← raw recording (video + audio)
│           ├── transcript.vtt          ← full transcript with timestamps
│           ├── summary.md              ← AI-generated summary (BYOK)
│           ├── metadata.json           ← duration, speakers, type, status, archive state
│           └── frames/                 ← (optional) key preview frames
│               ├── 0001.jpg
│               └── ...
│
├── chats/                              ← [future] AI conversation threads
│   └── {chat_id}/
│       ├── messages.json
│       ├── summary.md
│       └── context.json                ← linked recordings, tasks, etc.
│
├── tasks/                              ← [future] project management / to-do board
│   ├── board.json                      ← lists, columns, view state
│   └── cards/
│       └── {task_id}.json
│
├── integrations/                       ← connected third-party services config
│   └── manifest.json                   ← enabled integrations (non-secret metadata)
│
├── settings/                           ← user preferences
│   └── preferences.json                ← theme, language, defaults (no secrets)
│
└── exports/                            ← [future] user-requested export bundles
```

### Core Principles

- **No shared database file** — local IndexedDB is the fast cache and source of truth. The drive stores independent, human-readable files to avoid sync conflicts and corruption.
- **Monthly recording buckets** — grouping by `YYYY-MM/` keeps cloud directory listings fast and manageable at scale.
- **One entity per folder or file** — each recording, chat thread, and task card is isolated, so partial uploads or sync errors never corrupt unrelated items.
- **Zero secrets in the cloud** — BYOK API keys, OAuth tokens, and integration credentials are stored exclusively in the browser's secure storage (`identity-vault.js`). `settings/` and `integrations/` contain only non-sensitive metadata.

### Implementation Plan

#### 9a. Recording Upload Refactor (`google-drive.js`, `microsoft-onedrive.js`) ✅

Current `uploadResumable(blob, filename)` → new `uploadRecordingPackage(recordingId, blob, historyEntry)`:

1. `ensureFolder('Takus')` → `ensureFolder('Takus/recordings')` → `ensureFolder('Takus/recordings/YYYY-MM')` → `ensureFolder('Takus/recordings/YYYY-MM/{recording_id}')` ✅
2. Upload `original.webm` to the recording folder (resumable, same as today) ✅
3. After AI processing completes, upload `transcript.vtt`, `summary.md`, `metadata.json` as small files ✅
4. Generate and upload key frame thumbnails (Phase 10 prerequisite) — deferred to Phase 10

#### 9b. Settings Sync Refactor (`settings-panel.js`, `cloud-provider.js`) ✅

Current: Fully automatic — no manual Backup / Restore buttons.

- **Auto-backup:** Every syncable setting change triggers a debounced (2 s) cloud write to `Takus/settings/preferences.json`. Legacy `appDataFolder` is also updated for backward compat. ✅
- **Auto-restore:** On cloud connect, `restoreSettingsFromCloud()` merges cloud preferences into local IndexedDB. Cloud wins for syncable keys. ✅
- **Security:** API keys (`openaiKey`, `geminiKey`) are excluded from sync — never leave the device. ✅

#### 9c. App Initialisation Sync ✅

On page load (after auth), scan the drive for existing recordings:
1. List `Takus/recordings/*/*/metadata.json` (lightweight; only reads JSON headers) ✅
2. Merge into local IndexedDB by recording ID — new entries from other devices added, existing entries skip ✅
3. Transcript and summary populated from drive if missing locally ✅

### Migration Strategy

- Existing recordings in the flat "Takus Recordings" folder are left in place (no migration needed)
- New recordings use the structured layout
- A future "Migrate" button in Settings can move old files into the new structure (N/A — Takus hasn't gone to production)

---

## Phase 10 — ARCHIVE (Intelligent Storage Lifecycle) ✅ Complete

**Goal:** Reduce storage cost by replacing full video recordings with compact, information-preserving archives, while protecting against accidental data loss and respecting legal holds and user intent.

**Dependency:** Phase 9 (VAULT) — archival requires the per-recording structured folders to store condensed packages.

### 10a. Preconditions for Archival

A recording is eligible for archival only when **all** of the following are true:

| Condition | Description |
|-----------|-------------|
| **Age** | Created more than 30 days ago (configurable via `settings.archiveAfterDays`) |
| **Not pinned** | The recording is not flagged as pinned by the user |
| **No legal hold** | The recording is not part of any active retention requirement |
| **Not already archived** | Prevents double-processing |

### 10b. Content Classification

Before archiving, the system classifies the visual importance of the recording into one of three categories:

| Class | Typical Examples | Visual Significance | Detection Heuristics |
|-------|-----------------|---------------------|---------------------|
| **Transcript-centric** | Talking-head meetings, voice-only calls, pure narration | Very low | Audio-only duration ratio > 80%; no screen share; low frame variance |
| **Slide / Screen-share** | Presentations, code reviews, report walk-throughs | Medium | Screen share active > 50%; discrete frame changes (slide transitions) |
| **Dynamic-visual** | Live demos, physical whiteboards, animation reviews | High | High frame-difference variance; continuous motion detected |

Detection sources (use any combination):
- Percentage of time screen-sharing vs. camera-on (available from `MediaStream` track metadata)
- Frame-difference variance over time (computed via canvas sampling during recording or post-hoc)
- Presence of user-applied tags (e.g., recording type `presentation` vs `meeting`)
- Audio-only duration ratio

### 10c. Archive Actions per Class

#### A. Transcript-centric & Slide / Screen-share recordings

1. **Extract key frames** — capture frames at moments of significant visual change (slide transitions, screen content modifications). Use scene-cut detection or timestamp deltas.
2. **Retain permanently:**
   - Full audio (original format)
   - Full transcript with word-level timestamps and speaker labels
   - Set of extracted key frames (JPEG) stored alongside their timestamp
   - All original metadata (title, participants, date, duration, analytics)
3. **Delete the full video** from hot storage after grace period (Section 10e)
4. **Optional: Lightweight replay player** — synchronize audio, transcript highlighting, and key-frame display at the correct times to recreate a summarised replay experience without the full video

#### B. Dynamic-visual recordings

1. **Create a low-fidelity video derivative:**
   - Transcode to 360p, 5 fps, while keeping the original audio track
   - Target: ~90-95% file size reduction
2. **Retain permanently:** The low-fidelity video, full audio, full transcript, metadata
3. **Full video:** Moved to cold storage, then deleted after grace period

### 10d. Recording Pinning & Legal Holds

New recording-level flags in `metadata.json` and IndexedDB:

```js
{
  pinned: false,            // user toggle, prevents archival
  pinnedAt: null,           // ISO 8601 timestamp
  legalHold: false,         // admin/compliance toggle
  legalHoldReason: null,    // string: case ID or regulatory ref
  archiveStatus: 'active',  // 'active' | 'pending' | 'archived' | 'cold'
  archivedAt: null,
}
```

- **Pin/unpin** exposed as a toggle on history cards (star icon or thumbtack)
- **Pin audit trail** — all pin/unpin actions logged to an immutable `archiveLog[]` array on the recording entry
- **Legal hold** — not exposed in UI initially (set via JSON import or future admin panel)

### 10e. Safety, Compliance & Grace Period

| Step | Action | Duration |
|------|--------|----------|
| 1 | System identifies eligible recordings and generates condensed package | Automatic |
| 2 | **Pre-archive preview** (optional): notify user, 48-72 hour objection window | Configurable |
| 3 | Condensed package verified; original video moved to cold storage tier | Immediate after approval |
| 4 | **Grace period**: original accessible via "Restore" button with cost/time warning | 90 days (configurable) |
| 5 | Original permanently deleted after grace period expiry | Automatic |

### 10f. Storage Flow Summary

```
Active Storage (hot — Google Drive / OneDrive)
  │
  ├─ 30 days old, not pinned, no hold
  │
  ├─ Classify → Generate condensed package
  │     ├─ Transcript-centric: audio + transcript + key frames
  │     └─ Dynamic-visual: low-fidelity video + transcript
  │
  ├─ Move original full video to Cold Storage (retention 90 days)
  │     └─ After 90 days → Permanently delete
  │
  └─ Condensed package becomes the new primary, accessible record.
```

### 10g. Estimated Storage Savings

| Type | Original Size (1h 1080p) | Condensed Size | Saving |
|------|--------------------------|----------------|--------|
| Transcript-centric (frames) | ~500 MB | ~5–10 MB | >95% |
| Slide / Screen-share (frames) | ~500 MB | ~10–20 MB | >96% |
| Dynamic-visual (low-fidelity) | ~500 MB | ~30 MB | ~94% |

After cold-storage grace period expires, savings are permanent.

### 10h. Implementation Dependencies

| Dependency | Status | Required For |
|------------|--------|-------------|
| Phase 9 VAULT (structured folders) | ✅ | Condensed package storage, metadata.json archive flags |
| FFmpeg WASM (already shipped) | ✅ | Key frame extraction, video transcoding |
| IndexedDB schema v4 | ✅ | `pinned`, `legalHold`, `archiveStatus` fields on recordings |
| Cloud cold storage API | Deferred | S3 Glacier / Azure Archive / GCP Archive integration |
| Archive Engine (`archive-engine.js`) | ✅ | Eligibility, classification, key-frame extraction, condensed package |
| Archive Statistics (Insights panel) | ✅ | Dashboard card with active/archived/pinned counts + savings estimate |

> **Note:** For the initial browser-only implementation, "cold storage" maps to the same cloud drive but in an `archive/` subfolder. True cloud-tiered cold storage (Glacier, etc.) requires server-side functions (Netlify Functions) and is deferred to Phase 10b.

---

### Phase 11 — PLAYBACK (Enhanced Replay Experience) ✅

| Feature | Status | Details |
|---------|--------|---------|
| Synchronized Watch Modal | ✅ | Side-by-side video + transcript panel with live VTT segment highlighting |
| Click-to-seek transcript | ✅ | Click any transcript row → video seeks to that timestamp |
| Search within transcript | ✅ | Filter + highlight matches inside the watch modal transcript panel |
| Clickable inline timestamps | ✅ | VTT timestamps in history panel → open watch modal at that position |
| Archive Replay Player | ✅ | Lightweight modal with audio + key frames + transcript sync |

### Phase 12 — POLISH (Quality of Life) ✅

| Feature | Status | Details |
|---------|--------|---------|
| Batch Operations | ✅ | Select mode toggle, checkboxes, Delete Selected, Export Selected |
| Recording Tags | ✅ | Inline tag editor, autocomplete, tag filter chip row |
| Sort by Size | ✅ | Added "Largest" sort option to recording library |
| Pinned-first sort | ✅ | Pinned recordings always sort above others |

### Phase 13 — BRIDGE (Serverless Integration Layer) ✅

| Feature | Status | Details |
|---------|--------|---------|
| Netlify Functions setup | ✅ | `netlify.toml`, `/api/*` proxy, SPA fallback |
| Short Share URLs | ✅ | `POST /api/share` → Netlify Blobs (free tier, 1 GB) |
| Jira Cloud proxy | ✅ | `POST /api/jira` — issue creation, dry-run verify |
| Notion proxy | ✅ | `POST /api/notion` — page creation, markdown→blocks converter |
| Jira integration client | ✅ | `src/lib/integrations/jira.js` — credentials via Identity Vault |
| Notion integration client | ✅ | `src/lib/integrations/notion.js` — credentials via Identity Vault |
| Connect panel cards | ✅ | Jira Cloud + Notion cards with save/test/disconnect |
| Origin validation | ✅ | All serverless functions validate request origin; 500 KB payload limit on shares |
| Auto settings sync | ✅ | Debounced backup on every change; auto-restore on cloud connect. API keys never synced. |
| Google Drive upsert | ✅ | `upsertSmallFile()` — checks for existing file before upload, PATCHes instead of duplicating |
| OneDrive ID-based upsert | ✅ | `upsertSmallFile()` — uses folder ID (not path) for AI artefact re-uploads |
| AI artefact cloud sync | ✅ | Post-AI processing re-uploads summary.md, transcript.vtt, metadata.json to cloud folder |

> **Infrastructure cost: $0** — all within Netlify's free tier (125K function invocations/mo, 1 GB Blobs storage).

---

### Production Hardening Audit ✅

Full 52-file audit covering data integrity, race conditions, resource management, XSS, token security, error handling, and performance.

| Category | Finding |
|----------|---------|
| **Critical fix** | Upload failure no longer permanently blocks AI processing — `_uploadDone` promise now resolves in `finally` block |
| **Minor fix** | Event listener leak in keyboard shortcuts overlay — all close paths now unregister the `keydown` handler |
| XSS surface | ✅ All user content through `esc()`. `renderMarkdown()` escapes before adding HTML tags |
| Token storage | ✅ No raw tokens in localStorage. Google: memory-only. MS: MSAL cache. Creds: AES-GCM-256 vault |
| eval / open redirect | ✅ Zero instances of `eval()`, `new Function()`, or open redirects |
| Async error handling | ✅ All async event handlers have `try/catch` with toast error reporting |
| Resource cleanup | ✅ MediaStream tracks, timers, event listeners, FFmpeg FS — all properly released |
| CSP coverage | ✅ All API domains covered. `wasm-unsafe-eval` for FFmpeg. No inline scripts |
| Build | ✅ 345 KB bundle (87 KB gzipped), 0 npm vulnerabilities |

---

### Phase 14 — FOCUS (Knowledge Workspace Architecture) ✅

**Goal:** Restructure the IDLE screen from "recorder with history" into a **Knowledge Workspace** — shifting the interaction model from "record and forget" to "record, understand, and act."

#### 14a. Ask Elevation + 5-Tab Navigation ✅

- ✅ **Elevated Ask bar** — moved above the tab bar; always visible regardless of active tab
- ✅ **6-tab navigation** — `History | Tasks | People | Insights | Apps | Settings`
- ✅ **Global Tasks panel** (`global-tasks-panel.js`) — aggregates uncompleted tasks across all recordings
- ✅ **Inline Settings & Connect** — `renderSettingsInline()` and `renderConnectInline()` for tab panels
- ✅ **Lazy rendering** — `data-rendered` pattern defers DOM until first selection

#### 14b. Session Config Simplification + Upload ✅

- ✅ **Title input removed** — titles are AI-generated post-recording
- ✅ **Type selector chips** — Meeting (purple), Screen (blue), Presentation (green), Update (amber) with per-type camera/quality presets
- ✅ **Camera toggle** relocated to session-config
- ✅ **Upload button** — imports `.webm`, `.mp4`, `.m4a`, `.wav`, `.mp3`, `.mov` (2 GB limit)

#### 14c. Recording Detail View (70/30 Split) ✅

- ✅ **`recording-detail.js`** (code-split, 17.77 KB) — 70/30 grid layout
- **Left pane (70%)**: Ask (scoped semantic search), Summary (TL;DW + chapters), Transcript (search + video sync), Tasks
- **Right pane (30%)**: Video player, calendar event, participants, tags, quality score, downloads
- ✅ **Video-transcript sync** — active line highlights and auto-scrolls
- ✅ **Mobile responsive** — stacks vertically at 768px

#### 14d. Calendar Context Persistence ✅

- ✅ **Full calendar event metadata** saved to recording: `{ id, summary, start, end, organizer }`
- ✅ **Organizer field** in both Google Calendar and Microsoft Calendar returns

#### 14e. AI-Generated Titles + Related Recordings ✅

- ✅ **Type-based default titles** — `"Meeting — May 12 08:19 PM"` replaces "Untitled Recording"
- ✅ **AI title extraction** — `_extractTitleFromSummary()` parses first markdown heading from AI summary
- ✅ **Related recordings** — cosine similarity of mean embedding vectors, top-3 above 35% threshold
- ✅ **Clickable related chips** — click dispatches `takus:open-recording` to navigate to related recording
- ✅ **Upload duration extraction** — `_extractDuration()` reads metadata from uploaded video/audio files
- ✅ **Cascade panel refresh** — detail view pin/delete/notes auto-refresh History, Tasks, and Insights

#### 14f. Production Polish ✅

- ✅ **Knowledge OS branding** — onboarding card, noscript fallback, and manifest updated
- ✅ **Header settings** — gear icon in account dropdown now switches to Settings tab (with modal fallback)
- ✅ **Detail-tab conflict** — switching tabs auto-closes the recording detail overlay
- ✅ **Code-split optimization** — `global-tasks-panel.js` fully lazy-loaded (6.13 KB separate chunk)
- ✅ **Service worker** bumped to `v16` for new chunk hashes
- ✅ **Keyboard shortcuts** — Escape closes detail, comma opens Settings tab, shortcuts overlay updated

#### 14g. Cross-Panel Navigation + CSS Hardening ✅

- ✅ **Unified navigation** — every recording reference is clickable → opens detail view:
  - History rows, Tasks body, Insights digest, Decision ledger, Ask source chips, Related chips
- ✅ **Ask source chip UX** — click opens detail; play button (stopPropagation) opens timestamp watch modal
- ✅ **Cloud links** — "Open in Drive" + "View AI Doc" links in recording detail info section
- ✅ **CSS design system** — proper `.main-tab-bar`, `.main-tab`, `.global-task-row`, `.btn-task-done` rules
- ✅ **Accessibility** — `focus-visible` outlines on tabs, task checkboxes, detail tabs
- ✅ **Hover micro-interactions** — task checkbox scale(1.15), source chip border glow, task row backgrounds
- ✅ **Deduplicated CSS** — removed redundant `.global-task-row` block, consolidated to single source
- ✅ **Mobile polish** — tab font/padding reduction at 768px breakpoint

#### 14h. UX Intelligence + Drag-and-Drop ✅

- ✅ **Tab badges** — pending task count pill on Tasks tab (auto-updates on init, completion, detail changes)
- ✅ **Drag-and-drop upload** — drag media files anywhere on the window → full-screen drop zone overlay
  - Glassmorphism backdrop with dashed purple drop zone
  - Validates file type and 2 GB size limit
  - Only active during IDLE state (no recording conflicts)
  - Nested drag event handling via counter pattern
- ✅ **Header tagline** — "KNOWLEDGE OS" subtitle under Takus logo (hidden on mobile)
- ✅ **Enhanced empty states** — Insights shows feature preview text; Tasks shows "All caught up"
- ✅ **Icon-only mobile tabs** — ≤640px: labels hidden, only icons + badges visible
- ✅ **Service worker** bumped to `v17` for asset cache invalidation

### Phase 15 — Advanced Task Engine ✅

#### 15a. Task Status Model + Schema Evolution
- ✅ **Tri-state status** — `pending` → `done` (with output) | `ignored` (with reason, required)
- ✅ **Done output** — captured on completion (freeform or auto-filled from integrations like `Jira: TAK-123`)
- ✅ **Ignored reason** — required field, enforced via prompt (empty rejected)
- ✅ **Reopen** — done/ignored → pending (clears output/reason/timestamps)
- ✅ **Dependencies** — `dependsOn: string[]` links tasks; blocked tasks show shield + disabled actions
- ✅ **Sequences** — `sequence: number` for execution order; rendered as circled step badges ①②③
- ✅ **Integration suggestions** — `integrations: string[]` (slack, github, jira, notion, calendar, email, drive)
- ✅ **Timestamps** — `doneAt`, `ignoredAt` for time-to-done analytics
- ✅ **Backward compat** — `migrateTask()` normalizes legacy `done: boolean` records (idempotent)
- ✅ **AI prompt expansion** — requests dependsOn, sequence, integrations from LLM

#### 15b. Per-Recording Tasks Panel
- ✅ **Status buttons** — ✓ (done) / ✕ (ignore) / ↺ (reopen) replace checkboxes
- ✅ **Integration chips** — per-task icons for suggested integrations (Slack, Jira, GitHub, etc.)
- ✅ **Dependency chips** — "🛡 Task Title" with red (pending) / green (resolved) state
- ✅ **Output display** — green-tinted inline display below completed tasks
- ✅ **Ignored display** — amber-tinted italic display below ignored tasks
- ✅ **Auto-complete** — Run button auto-marks done with integration output string
- ✅ **Blocked state** — dashed border, 40% opacity, disabled actions

#### 15c. Global Tasks Dashboard
- ✅ **Filter bar** — Pending | Done | Ignored | All with count chips
- ✅ **Progress indicator** — "X of Y completed — Z%" with gradient bar
- ✅ **Status transitions** — Done (output prompt) / Ignored (reason prompt) / Reopen
- ✅ **Badge counting** — uses `status` model with legacy `done` fallback

#### 15d. Analytics + Insights
- ✅ **computeTaskMetrics()** — completion rate, avg time-to-done, action breakdown
- ✅ **Task Completion card** — rate %, done/ignored/pending counts, avg resolve time
- ✅ **Action-type breakdown** — progress bars per type (Bug Reports, Decisions, Tickets, etc.)
- ✅ **CSS design system** — 13 new classes (status borders, dep chips, filter bar, progress bar)
- ✅ **Service worker** bumped to `v19`

#### 15e. Built-in Integrations + New Actions
- ✅ **DRAFT_EMAIL** — opens `mailto:` with task title as subject and summary as body
- ✅ **UPLOAD_TO_DRIVE** — copies formatted note to clipboard for cloud upload
- ✅ **Connect panel** — Calendar, Email, Drive shown as "Built-in" pre-active cards
- ✅ **Legacy cleanup** — all boolean `.done` references replaced with status-aware logic

#### 15f. Task Steps + Objectives
- ✅ **Steps schema** — `steps: Array<{text, done}>` (1–4 actionable sub-steps per task)
- ✅ **Objective schema** — `objective: string` (broader goal this task connects to)
- ✅ **Step rendering** — inline checklist with native checkboxes, toggle-persist to IndexedDB
- ✅ **Step counter** — `2/3 steps` badge, green when all complete
- ✅ **Objective badge** — purple connecting banner with left border accent
- ✅ **migrateTask()** — handles legacy tasks missing steps/objective fields
- ✅ **AI prompt** — requests sub-steps (actionable phrases) + objectives (strategic context)

#### 15g. Objective Grouping
- ✅ **Active Objectives** — dashboard groups tasks by objective with per-objective progress bars
- ✅ **Step progress** — displayed in global task row metadata line

#### 15h. Deep Integration Propagation
- ✅ **Google Docs** — tasks section with status emojis, step checklists, objectives
- ✅ **Slack** — objective as italic subtext, steps as ✅/⬜ checklist, action items section
- ✅ **GitHub** — objective field, steps as GitHub task list (`- [x]` / `- [ ]`)
- ✅ **Jira** — objective field, steps as Jira checklist (`(/)` / `(x)`)
- ✅ **Linear** — objective field, steps as markdown task list
- ✅ **Notion** — objective field, steps as markdown checklist

#### 15i. Analytics Expansion
- ✅ **Step metrics** — `totalSteps`, `doneSteps`, `stepRate` in computeTaskMetrics()
- ✅ **Objective metrics** — `objectiveCount`, `objectivesCompleted`
- ✅ **Insights card** — step progress bar + objectives completion count

#### 15j. Export Surfaces
- ✅ **ZIP export** — per-recording `tasks.md` grouped by objective with step checklists
- ✅ **Shared view** — read-only Action Items card with status borders, steps, objectives
- ✅ **Download .md** — shared summary download includes tasks with step checklists
- ✅ **Service worker** bumped to `v20`

---

### Phase 16 — Knowledge OS Foundation ✅

Bridges Takus from a recording tool to a knowledge operating system. Adds the feedback system, step executor, cloud task sync, and lightweight knowledge graph.

#### 16a. Unified Feedback System
- ✅ **Feedback engine** — gathers sanitized device diagnostics (browser, OS, version, storage, connected providers), records runtime errors from the error boundary, builds structured payloads with PII sanitization (paths, URLs, emails)
- ✅ **Feedback modal** — floating FAB button (bottom-right), category selector (Bug/Feature/UX/Other), description textarea with character count, "Include diagnostics" toggle, preview pane showing exact payload, ARIA dialog with focus trap
- ✅ **Netlify function** — `/api/feedback` endpoint with field allowlisting, size guards (100 KB), defense-in-depth sanitization, stored in Netlify Blobs
- ✅ **Local history** — feedback submissions saved to localStorage, viewable in settings, capped at 50 entries
- ✅ **Error boundary wiring** — unhandled errors and rejections automatically recorded for diagnostic reports
- ✅ **15 unit tests** — diagnostics, PII sanitization, payload building, history persistence

#### 16b. Step Executor Engine
- ✅ **Registry pattern** — `registerStep(type, handler, {autoApprove})` maps step types to async handler functions
- ✅ **Built-in auto-approved handlers** — `ai_transcribe`, `ai_summarize`, `ai_extract_tasks`, `ai_analytics`, `notify_user`
- ✅ **Dependency checking** — `areDependenciesMet()` verifies all upstream steps completed before execution
- ✅ **Consent gates** — `requiresApproval()` separates auto-approved from user-confirmed steps
- ✅ **Batch execution** — `runPendingSteps()` iterates all eligible steps, skips human-assigned and blocked ones
- ✅ **Step lifecycle** — pending → queued → executing → completed|failed|waiting_input
- ✅ **21 unit tests** — registry, creation, dependencies, approval, execution, error handling, batch

#### 16c. Cloud Task Sync
- ✅ **Upload** — `tasks.json` written to cloud drive folder alongside `summary.md` and `metadata.json` after AI processing
- ✅ **Download** — tasks.json read during vault sync and merged into local recordings (both Google Drive and OneDrive)
- ✅ **Format** — versioned JSON with `takusTasks` and `meTasks` arrays, exportedAt timestamp

#### 16d. Lightweight Knowledge Graph
- ✅ **IndexedDB v6** — `edges` store with compound indexes (`sourceKey`, `targetKey`, `edgeType`); schema now at v7
- ✅ **Deterministic IDs** — `source:id→EDGE_TYPE→target:id` prevents duplicate edges via upsert
- ✅ **CRUD API** — `addEdge()`, `getEdgesFromNode()`, `getEdgesToNode()`, `getEdgesForNode()`, `removeEdge()`, `removeEdgesForNode()`
- ✅ **Edge metadata** — arbitrary metadata (score, method, context) stored per edge
- ✅ **7 unit tests** — CRUD, bidirectional lookup, upsert, cascade deletion, metadata

---

### Phase 17 — Knowledge OS: Autonomous Intelligence ✅

Transforms Takus from a tool you use into a system that works for you. Three new subsystems give Takus ambient intelligence capabilities.

#### 17a. Autonomy Engine
- ✅ **Background intelligence loop** — `requestIdleCallback`-based tick system (30s intervals) that processes pending knowledge work without blocking UI or recording
- ✅ **Auto-embed** — detects un-embedded transcripts and generates embeddings automatically
- ✅ **Auto-similarity** — computes SIMILAR_TO edges between newly embedded recordings and existing library
- ✅ **Auto-closeness** — recomputes stale contact closeness scores (24h threshold)
- ✅ **Step-executor integration** — autonomy tasks registered as `autonomy_embed` and `autonomy_closeness` step types with lifecycle tracking
- ✅ **Visibility-aware** — pauses when tab is hidden, resumes on visibility
- ✅ **Audit log** — all autonomy actions logged to localStorage (capped at 100 entries)
- ✅ **Event system** — `onAutonomyEvent()` subscriber pattern for UI reactivity
- ✅ **7 unit tests** — lifecycle, stats, events, idempotency

#### 17b. Command Bar
- ✅ **Spotlight-style overlay** — `⌘K` or `/` opens a universal search and command interface
- ✅ **Recording search** — fuzzy search across titles and AI summaries (IDB queries debounced 120ms)
- ✅ **Contact search** — search contacts by name or email
- ✅ **9 built-in commands** — navigation (Home/Library/Tasks/People/Settings), recording start, keyboard shortcuts, feedback, Ask
- ✅ **Extensible registry** — `registerCommand()` API for adding custom commands
- ✅ **Keyboard navigation** — ↑↓ arrow keys, Enter to select, Escape to close
- ✅ **ARIA accessible** — `role="dialog"`, `aria-modal`, `aria-label`
- ✅ **9 unit tests** — open/close, ARIA, idempotency, keyboard, registry, deduplication

#### 17c. Notification Manager
- ✅ **Three-tier system** — ephemeral (auto-dismiss), persistent (user-dismiss), actionable (callbacks)
- ✅ **Priority sorting** — notifications delivered in priority order (`high` > `medium` > `low`)
- ✅ **Deduplication** — same-ID notifications are merged, not stacked
- ✅ **Event system** — `onNotification()` subscriber for toast rendering
- ✅ **Auto-prune** — expired ephemeral notifications cleaned up automatically
- ✅ **14 unit tests** — all three tiers, dedup, priority, events, prune

#### 17d. Right Now Intelligence Cards
- ✅ **Pending Actions** — overdue + due-today tasks with urgency styling
- ✅ **Completion Trend** — week-over-week productivity comparison
- ✅ **Connection Nudges** — contacts you haven't recorded with recently
- ✅ **Weekly Digest** — recording streak, active days, type breakdown
- ✅ **Autonomy Status** — live embed/similarity/closeness counters from the autonomy engine
- ✅ **Knowledge Graph** — edge count and type breakdown from IDB edges store

#### 17e. Production Normalization
- ✅ **Branding audit** — zero "Knowledge Studio" references remaining (verified via grep across all source files)
- ✅ **Meta tags** — title, OpenGraph, Twitter Cards, JSON-LD all updated to "Knowledge OS"
- ✅ **Version** — 0.10.0 → 0.11.0
- ✅ **Service worker** — cache bumped to v30
- ✅ **Documentation** — README, ARCHITECTURE, CHANGELOG all synchronized
- ✅ **416 tests** across 32 files

### Phase 18: Adaptive Intelligence (v0.12.0)

#### 18a. Preference Signal System
- ✅ **Preference Engine** (`preference-engine.js`) — records user behavior signals (TASK_ACCEPTED, TASK_IGNORED, TASK_EDITED, SUMMARY_EDITED, SEARCH_CLICKED, SEARCH_REFINED, PRIORITY_OVERRIDE) to IDB. LRU-capped at 500 signals. **All 8/8 signal types active.**
- ✅ **Prompt Preferences** — aggregates signals into `summaryStyle` (concise/detailed), `taskFocus` (preferred actions), `ignoredActions` (deprioritized actions)
- ✅ **Scoring Adjustments** — computes adaptive weight overrides for deadline/closeness/age/routing dimensions
- ✅ **Signal Producers** — global-tasks-panel wires TASK_ACCEPTED/TASK_IGNORED on accept/ignore

#### 18b. Adaptive AI Prompts
- ✅ **`_buildAdaptiveHint()`** — constructs context hints from preference data, appended to LLM prompts
- ✅ **Dissent & Open Questions** — meeting summary prompts include mandatory contrarian section
- ✅ **Feature flag gated** — `adaptiveAI` and `dissent` flags control behavior via Settings → Labs

#### 18c. Confirmation Bias Countermeasures
- ✅ **Blind Spot Detector** (`blind-spot-detector.js`) — 4 detection types: ignored categories, tunnel vision, stale contacts, recency bias
- ✅ **Blind Spots Card** — Insights panel surfaces detected patterns (gated by `blindSpots` flag)

#### 18d. Task Priority Weight Blending
- ✅ **Adaptive weights** — `computeTaskPriority()` blends 70% defaults + 30% user preferences when ≥10 signals accumulated
- ✅ **Cached 60s** — avoids IDB thrashing on batch priority computation

#### 18e. Feature Flags & Labs UI
- ✅ **Feature Flags** (`feature-flags.js`) — 5 flags: `adaptiveAI`, `blindSpots`, `dissent` (stable, on), `autoRecord`, `archiveEngine` (experimental, off)
- ✅ **Settings → Labs** — toggle switches with tier badges (stable/beta/experimental)

#### 18f. IDB Store Activation
- ✅ **Interactions store** — recording pipeline writes PARTICIPATED_IN interactions for each participant
- ✅ **Removed `@planned`** — saveInteraction now actively consumed

#### 18g. Production Normalization
- ✅ **Version** — 0.11.0 → 0.12.0
- ✅ **Service worker** — cache bumped to v33
- ✅ **482 tests** across 38 files
- ✅ **Bundle** — 448 KB / 116 KB gzip

---

### Phase 19: Production Hardening & Realistic Delivery ✅
*Audit-driven hardening: activate dormant data pipelines, consolidate settings, wire orphan components.*

#### 19a. Knowledge Level Pipeline Activation
- ✅ **Content item write-path** — recording-pipeline now writes `content_items` to IDB (id, ownerId, participants, knowledgeLevel)
- ✅ **Engagement event write-path** — recording-detail writes VIEW and PLAY events to `engagement_events` store
- ✅ **Autonomy knowledge levels step** — `autonomy_knowledge_levels` runs `resolveAllLevels()` every tick
- ✅ **L0–L4 fully functional** — closed-loop: pipeline → content_items → closeness-worker → UI

#### 19b. Archive Engine Activation
- ✅ **Autonomy archive scan** — `autonomy_archive_scan` calls `scanEligibleRecordings()` gated by `archiveEngine` feature flag
- ✅ **Autonomous trigger** — runs during idle ticks, logs eligible counts

#### 19c. Settings Architecture Consolidation
- ✅ **`getSettingCached(key)`** — in settings-store.js, reads from hot cache for known keys, falls back to IDB
- ✅ **JSDoc documentation** — storage.js `getSetting()` clarifies when to use raw IDB vs cache

#### 19d. Auto-Record Notification Wiring
- ✅ **`AUTO_RECORD_PENDING` event** — new DOM event in events.js
- ✅ **`emitAutoRecordPending()`** — lib→component bridge via DOM event (no import violation)
- ✅ **App-shell listener** — shows notification modal on event, gated by `autoRecord` flag
- ✅ **Zero orphan components** — `auto-record-notification.js` now has 1 importer

#### 19e. Knowledge Management Framework
- ✅ **`knowledge-framework.js`** — classifies insights into fact/decision/assumption/open_question/reasoning
- ✅ **Assumption risk scoring** — `computeAssumptionRisk()` computes risk from assumption/fact ratios
- ✅ **Reasoning chains** — `buildReasoningChain()` links decisions to supporting evidence
- ✅ **17 tests** in knowledge-framework.test.js

#### 19f. Modularization & Architecture Clarity
- ✅ **Step executor architecture documented** — dual-path design clarified (step executor vs pipeline)
- ✅ **Stale annotations removed** — no @planned or 'not wired yet' in active code

#### 19g. Production Normalization
- ✅ **Version** — 0.12.0 → 0.13.2
- ✅ **Service worker** — cache bumped to v38
- ✅ **658 tests** across 48 files
- ✅ **Bundle** — 481 KB / 125 KB gzip

#### 19h. Remaining Completeness Fixes
- ✅ **Knowledge level → recording sync** — autonomy engine now writes computed L0–L4 back to the recording object (via new `getRecording(id)`), so history-panel badge is visible
- ✅ **Archive UI action** — recording-detail now has Archive / View Archive button (flag-gated)
- ✅ **Decision reasoning chains** — collapsible decision chains wired into summary tab via `buildReasoningChain()`
- ✅ **TASK_EDITED signals** — tasks-panel records done/ignored/reopened signals (8 signal sites total, 5 of 7 defined types wired)
- ✅ **Zero unused exports** — all 15 audited exports have active callers
- ✅ **Zero orphan components**

#### 19i. Hardening Pass (v0.13.1–v0.13.2)
- ✅ **Apps dashboard** — replaced "Connect" tab with centralized "Apps" dashboard; visual status tiles for all integrations, "Connect New App" entry point, built-in features summary
- ✅ **6-tab navigation** — `History | Tasks | People | Insights | Apps | Settings`
- ✅ **SEARCH_REFINED signal** — wired in ask-panel.js (tracks refined queries)
- ✅ **PRIORITY_OVERRIDE signal** — clickable priority badges on pending tasks with manual tier override (persisted to IDB)
- ✅ **All 8/8 RL signals active** — closed-loop preference learning
- ✅ **Critical fix: `chunkTranscript` infinite loop** — embeddings.js chunking loop froze the browser for any transcript > 400 chars
- ✅ **Fix: `_cache` ReferenceError** — settings-panel.js accessed an unexported module variable
- ✅ **Fix: falsy numeric defaults** — `||` → `??` for bufferBeforeMin/bufferAfterMin/maxConcurrent in auto-record-engine.js
- ✅ **Settings deduplication** — settings-panel.js reduced by 212 lines (−22.7%)
- ✅ **Test coverage expansion** — recording-pipeline (20), auto-record-engine (26), embeddings (11), calendar-poller (15), qr-code (10)
- ✅ **JSON.parse safety audit** — all 12 calls verified with try-catch
- ✅ **`.toLowerCase()` safety audit** — all 20 calls use fallback strings

## Known Limitations

- **Gemini transcript tags:** If Gemini omits `<transcript>` XML tags, stored transcript is empty; summary is unaffected.
- **Blob quota:** IndexedDB video blobs may fill available disk on devices with many recordings. Use the Storage Health card in Insights to free space.
- **Watermark font:** Requires network fetch of Roboto.ttf on first use; skipped with toast if CDN unreachable.
- **FFmpeg cold start:** First WASM operation takes 2–5 s. Subsequent operations reuse the loaded instance.
- **FFmpeg CSP requirement:** The `_headers` file must include `'wasm-unsafe-eval'` in `script-src` for WebAssembly to work. Without it, MP4/GIF conversion silently fails.
- **Observer scope (Phase 1):** The Observer only captures events from the recording tab's own JS context. Cross-origin iframes and browser extensions are not observable.
- **Cross-device sync:** Recordings and settings appear on other devices after cloud login via background vault sync. The history panel re-renders automatically when sync completes. Sync is non-blocking and rate-limited to one concurrent operation.
- **Settings sync scope:** API keys (`openaiKey`, `geminiKey`) are never synced to the cloud — they are stored on-device only. All other preferences auto-sync.
- **Dormant modules:** `calendar-poller.js` exists in the codebase with test coverage but is activatable via Settings → Labs. Auto-recording is fully wired but dormant (requires calendar-poller integration to trigger).
- **Priority override prompt:** Uses `prompt()` for manual priority tier entry. Future iteration should replace with an inline dropdown for better UX.
- **Inbox mode:** Recordings can be held as `raw` in the inbox until explicitly processed. Auto-Read rules can bypass this for matching recordings. Currently code-level — no global toggle in Settings UI yet.
- **Document ingestion limitations:** Only plain text files (.txt, .md, .json) are supported. PDF extraction requires a third-party library (not included). Maximum document size is 100,000 characters before truncation.

---

## Code Conventions

- Vite build tool with native ES modules (`<script type="module">`)
- No TypeScript — JSDoc `@param` / `@returns` where non-obvious
- No framework — `innerHTML` for full re-renders, direct event listeners for interactions
- CSS variables in `src/styles/index.css`; component styles in `src/styles/components.css`
- Security: all user content through `esc()` before `innerHTML`; no `eval()`, no external scripts beyond OAuth SDKs
- Prefer single-file changes per feature

## Naming Conventions
- `render*` — rebuild a container's `innerHTML` from scratch
- `update*` — mutate specific DOM nodes without a full re-render
- `_private` — internal helpers not exported from the module
- Event delegation via `container.querySelector()` after `innerHTML` assignment

---

### Phase 20: Read-to-Ingest & Production Readiness (v0.14.0) ✅

*Finalizes the recording lifecycle with inbox-first processing, Auto-Read automation, and document ingestion.*

#### 20a. State Lifecycle & Inbox
- ✅ **Tri-state recording lifecycle** — `raw` → `processing` → `active` via `processRawRecording()` in recording-pipeline.js
- ✅ **Inbox UI** — raw recordings render with reduced opacity and amber border; inbox banner with count; "Process" button triggers AI pipeline
- ✅ **State badges** — visual indicators for raw/processing/active/archived states in history cards

#### 20b. Auto-Read Rules Engine
- ✅ **`auto-read-rules.js`** — `shouldAutoProcess()` evaluates rules against recording metadata
- ✅ **Rule schema** — `{ id, field, operator, value, enabled, label }` with four fields (type, source, title, participant) and three operators (equals, contains, startsWith)
- ✅ **CRUD API** — `addAutoReadRule()`, `removeAutoReadRule()`, `toggleAutoReadRule()`, `getAutoReadRules()`, `saveAutoReadRules()`
- ✅ **Presets** — `getAutoReadPresets()` provides one-click rules for meetings, standups, updates, calendar events
- ✅ **Pipeline integration** — `evaluateAutoRead()` in recording-pipeline.js auto-processes matching recordings

#### 20c. Auto-Read Settings UI
- ✅ **Settings panel** — rule list with toggle checkboxes and delete buttons
- ✅ **Preset suggestions** — available presets auto-hide once added
- ✅ **Live rendering** — `_renderAutoReadRules()` lazy-loads auto-read-rules.js

#### 20d. Document Ingestion
- ✅ **`document-adapter.js`** — `ingestDocument()` creates recording-like entries with `isDocument: true`
- ✅ **File extraction** — `extractTextFromFile()` supports .txt, .md, .json
- ✅ **AI processing** — optional summarization and embedding generation
- ✅ **Similarity edges** — auto-links documents to related content via cosine similarity
- ✅ **Import UI** — file picker button and drag-and-drop on history list

#### 20e. Archive Audit Trail UI
- ✅ **Recording detail** — `archiveLog` timeline with color-coded status dots
- ✅ **Status colors** — active (green), pending (amber), archived (purple), cold (indigo), restored (cyan)
- ✅ **Archive restore** — `restoreRecording()` transitions archived→active with full audit trail

#### 20f. Production Normalization
- ✅ **Version** — 0.13.2 → 0.14.0
- ✅ **Service worker** — cache bumped to v43
- ✅ **IDB schema** — v7 (step_checkpoints store)
- ✅ **658 tests** across 48 files
- ✅ **Bundle** — 481 KB / 125 KB gzip
- ✅ **0 TODOs/FIXMEs** in source

---

### Phase 21: App Platform Architecture (v0.15.0)

*Transforms Takus from a monolithic PWA into a WordPress-style extensible app ecosystem. Every feature becomes a self-contained app with lifecycle management, namespaced settings, and graph-based data.*

#### 21a. App Interface & Manager
- ✅ **`app-interface.js`** — TakusApp contract definition: `activate()`, `deactivate()`, `renderPanel()`, `getNavItem()`, `getSettingsSchema()`, `getNodeTypes()`, `getEdgeTypes()`, `getStepTypes()`, plus `validateAppManifest()` and `createAppStub()`
- ✅ **`app-manager.js`** — WordPress-style lifecycle manager: `registerApp()`, `activateApp()`, `deactivateApp()`, dependency resolution (recursive), namespaced settings (`app:{id}:{key}`), event system (`onAppEvent()`), nav item aggregation
- ✅ **`initAppManager()`** — auto-activates all core apps (category: `core`, cannot be deactivated)
- ✅ **33 tests** — registration, activation, dependencies, settings, events, nav items, initialization

#### 21b. Graph Store (IDB v8)
- ✅ **`nodes` object store** — 5 indexes (`type`, `state`, `appId`, `createdAt`, compound `type_state`)
- ✅ **CRUD API** — `saveNode()`, `getNode()`, `getNodesByType()`, `getNodesByTypeAndState()`, `getNodesByApp()`, `deleteNode()`, `countNodesByType()`, `getAllNodes()`
- ✅ **Non-destructive** — `nodes` store runs alongside existing `recordings`, `contacts`, `edges` stores

#### 21c. Node Registry
- ✅ **`node-registry.js`** — `registerNodeType()`, `getNodeType()`, `getAllNodeTypes()`, `createNode()`, `validateNode()`
- ✅ **Custom validators** — apps can register per-type validation functions
- ✅ **20 tests** — type registration, validation, creation, defaults, overwrite protection

#### 21d. Extended Edge Types
- ✅ **9 edge types** — SIMILAR_TO, PARTICIPATED_IN, FOLLOWS_UP, REFERENCES, ASSIGNED_TO, DERIVED_FROM, NEXT_STEP, BLOCKS, MENTIONS
- ✅ **Runtime extension** — `addEdgeType()` for apps to register custom relationship types
- ✅ **Vector utils** — deduplicated `_meanVector()` into `graph/vector-utils.js`

#### 21e. Built-in Apps (9 total)
- ✅ **Core (always active)**:
  - 🪪 **Passport** — identity management (name, bio, AI tone, avatar, cloud sync)
  - 🎬 **Recorder** — recording, pipeline, upload; registers `recording` node type
  - ⚡ **Tasks** — task management; registers `task` node type with validator
  - 🔍 **Ask** — semantic search, RAG, wiki
- ✅ **Built-in (toggleable)**:
  - 👥 **People** — contacts, closeness, knowledge levels; registers `person` node type
  - 📊 **Insights** — analytics, blind spots, meeting prep
  - 📅 **Calendar** — calendar polling, auto-record triggers
  - ☁️ **Drive** — cloud storage sync (Google Drive, OneDrive)
  - 🔗 **Integrations** — Slack, GitHub, Linear, Jira, Notion management
- ✅ **`registry.js`** — central registration point, imports all apps, exports `registerBuiltInApps()`

#### 21f. App Manager UI
- ✅ **`app-manager.js` (component)** — category-grouped tile dashboard with:
  - Activation status indicators (green/grey dot)
  - Toggle buttons (activate/deactivate) with toast feedback
  - Per-app settings modal generated from `getSettingsSchema()`
  - Hover micro-animations, core badge, security notice
  - Graceful fallback to legacy connect panel if loading fails

#### 21g. Unified Task Store
- ✅ **`task-store.js`** — single API for all task operations, abstracts over:
  - Legacy embedded tasks (stored inside `recording.tasks`)
  - New standalone task nodes (stored in graph `nodes` store)
- ✅ **Read API** — `getAllTasks()`, `getTasksByRecording()`, `getTask()`, `getTaskCounts()`
- ✅ **Write API** — `createTask()` (with DERIVED_FROM edge), `updateTask()`, `deleteTaskNode()`, `promoteToNode()`
- ✅ **Deduplication** — standalone nodes win over embedded tasks with same ID
- ✅ **18 tests** — CRUD, deduplication, edge creation, embedded fallback

#### 21h. Task Store Integration
- ✅ **`global-tasks-panel.js`** — fully rewired to use `getAllTasks()` and `updateTask()` from the task store:
  - Data loading via `getAllTasks()` replaces inline recording scanning
  - All 5 action handlers (done, ignore, reopen, priority override, step run) use `updateTask()`
  - Panel size reduced from 18.17 KB → 17.24 KB (−5%)
- ✅ **`app-shell.js`** — `_updateTaskBadge()` uses `getTaskCounts()` instead of scanning recordings
- ✅ **`recording-pipeline.js`** — `_promoteTasksToNodes()` auto-promotes AI-extracted tasks to standalone graph nodes after extraction; backward-compatible (embedded tasks remain)
- ✅ **Dead code removed** — `isTaskPending` (app-shell), `migrateTask` (global-tasks-panel), `saveRecording` (global-tasks-panel)

#### 21i. Data Migration (v14 → v15)
- ✅ **`v14-to-v15.js`** — one-time migration: mirrors recordings and contacts into `nodes` store
- ✅ **Default Passport** — creates identity node with cloud sync
- ✅ **Non-destructive** — original stores remain untouched (safe rollback)
- ✅ **Idempotent** — safe to call multiple times

#### 21j. Platform Bootstrap
- ✅ **`main.js`** — async bootstrap: `registerBuiltInApps()` → `initAppManager()` → `runMigrationV15()`
- ✅ **Non-blocking** — app platform init is async; if it fails, the app continues to function normally
- ✅ **Code splitting** — registry (17 KB), app-manager lib (10 KB), app-manager UI (5 KB), migration (3 KB) all lazy-loaded

#### 21k. Production Normalization
- ✅ **Version** — 0.14.0 → 0.15.0
- ✅ **IDB schema** — v7 → v8 (nodes store)
- ✅ **Service worker** — cache bumped to v44
- ✅ **729 tests** across 51 files
- ✅ **Bundle** — 487 KB / 127 KB gzip
- ✅ **32 files** created or modified

---

### Phase 22: Dynamic Navigation & Task Creation UX ✅

*Takus becomes fully data-driven — navigation is generated from apps, and users can create tasks independently of recordings.*

#### 22a. Standalone Task Creation
- ✅ **"+ New" button** in global tasks panel header (populated state)
- ✅ **"+ New Task" button** in empty state (guides first interaction)
- ✅ **Inline creation form** — title input, Me/Takus assignee radio, Add/Cancel
- ✅ **Keyboard UX** — Enter to submit, Escape to cancel
- ✅ **Graph-native** — tasks created via `createTask()` as standalone graph nodes
- ✅ **Auto-refresh** — panel re-renders immediately after creation
- ✅ **`btn-outline` CSS** — new button variant in the design system

#### 22b. Dynamic Tab Bar
- ✅ **`_buildTabBarHTML()`** — generates tab buttons and panel slots from `getNavItems()` + system tabs (Apps, Settings)
- ✅ **Backward-compatible** — falls back to hardcoded defaults before platform bootstrap
- ✅ **Dynamic labels** — icon + label resolved from `TAB_ICONS` map and `_resolvedTabs` cache
- ✅ **`_lazyRenderTab()`** — delegates to each app's `renderPanel(container)` method with staleness detection
- ✅ **System tab handlers** — Apps tab → `renderAppManager()`, Settings tab → `renderSettingsInline()`
- ✅ **Hardcoded fallbacks** — Insights/Tasks/People render via direct imports if app manager unavailable

#### 22c. Production Metrics
- ✅ **729 tests** — zero regressions
- ✅ **Bundle** — 490 KB / 128 KB gzip (app-manager now eagerly imported for synchronous `getNavItems()`)
- ✅ **Zero console errors** — all 6 tabs verified in browser

---

### Phase 23: Quick Actions Bar ✅

*The hardcoded Record/Upload area becomes a dynamic Quick Actions surface where apps contribute their hero interactions.*

#### 23a. App Interface Extension
- ✅ **`QuickAction` typedef** added to `app-interface.js`:
  - `{ id, label, icon, primary?, order?, handler }`
  - Primary actions rendered as hero CTA (record-btn style)
  - Each app limited to 2 quick actions max
- ✅ **`getQuickActions()`** added to `TakusApp` interface and `createAppStub()` default
- ✅ **`getQuickActions()`** added to `AppManager` — aggregates from all active apps, primary-first sort

#### 23b. Recorder App Quick Actions
- ✅ **Record** (primary) — dispatches `takus:quick-action` → `_handleStart()`
- ✅ **Upload** (secondary) — dispatches `takus:quick-action` → `_handleUpload()`
- ✅ Record button retains iconic red circle design (hero treatment)
- ✅ Upload button retains ghost-button style (compact secondary)

#### 23c. Quick Actions Component
- ✅ **`quick-actions.js`** — new component renders actions dynamically:
  - Primary actions: record-btn or gradient CTA
  - Secondary actions: ghost buttons with icon + label
  - Keyboard hint preserved (R to record, , for settings)
  - ICON_MAP for extensible icon resolution
- ✅ **Event routing** — `takus:quick-action` CustomEvent pattern
- ✅ **`_setupQuickActionListener()`** in AppShell constructor

#### 23d. AppShell Integration
- ✅ **IDLE state** — `recorder-slot` now renders via `_renderQuickActions()` (dynamic)
- ✅ **Non-IDLE states** — recorder panel controls unchanged (pause/resume/stop)
- ✅ **Fallback** — if app manager unavailable, hardcoded Record/Upload still works
- ✅ **Session config preserved** — type picker, camera, mic remain below Quick Actions

#### 23e. Production Metrics
- ✅ **729 tests** — zero regressions
- ✅ **Bundle** — 492 KB / 129 KB gzip
- ✅ **Zero console errors** — verified in browser
- ✅ **Visual parity** — Quick Actions bar looks identical to the previous hardcoded layout

---

### Phase 24: Per-App Settings UI ✅

*Every app's configuration is now accessible from the Settings tab. Schema-driven forms auto-render and auto-save.*

#### 24a. Schema-Driven Settings Renderer
- ✅ **`_renderAppSettings()`** — renders settings forms for all active apps with non-empty schemas
- ✅ **All field types supported**: text, password, toggle, select, number, textarea
- ✅ **Collapsible `<details>` cards** — each app gets an expandable section with icon + name + version
- ✅ **Auto-save on change** — uses `AppManager.setAppSetting()` for namespaced persistence
- ✅ **Success/error toasts** — immediate feedback on save

#### 24b. Settings Panel Integration
- ✅ **`#app-settings-slot`** added after Labs section in inline settings
- ✅ **Header** — 📊 "App Settings" with "Configure individual app preferences" subtitle
- ✅ **3 apps rendered** — Passport (takusName field), Recorder (3 fields), Tasks (1 field)
- ✅ **Graceful fallback** — "App settings unavailable" if app manager not ready

#### 24c. Production Normalization
- ✅ **Version** — 0.15.0 → 0.16.0
- ✅ **Service worker** — cache bumped to v45
- ✅ **729 tests** — zero regressions
- ✅ **Bundle** — 497 KB / 130 KB gzip

---

### Phase 25: Auto-Runs Engine ✅

*"Auto-Read Rules" becomes "Auto-Runs" — platform-agnostic automation rules that any app can contribute.*

#### 25a. File Rename + API Rename
- ✅ **`auto-read-rules.js` → `auto-runs.js`**
- ✅ **Exported functions renamed**: `getAutoReadRules` → `getAutoRuns`, `addAutoReadRule` → `addAutoRun`, `removeAutoReadRule` → `removeAutoRun`, `toggleAutoReadRule` → `toggleAutoRun`, `shouldAutoProcess` → `evaluateAutoRuns`, `getAutoReadPresets` → `getAutoRunPresets`
- ✅ **`AutoReadRule` typedef → `AutoRunRule`** — added `appId` field for traceability
- ✅ **Legacy backward-compat aliases** exported for any consumers not yet migrated

#### 25b. Settings Store Migration
- ✅ **Settings key**: `autoReadRules` → `autoRuns`
- ✅ **Backward migration**: `initSettings()` reads legacy `autoReadRules` key and copies to `autoRuns`
- ✅ **`getSettings()`** returns both `autoRuns` (primary) and `autoReadRules` (legacy alias)
- ✅ **Sync whitelist** updated to `autoRuns`

#### 25c. UI + Pipeline Updates
- ✅ **Settings panel**: "Auto-Read Rules" → "⚡ Auto-Runs"
- ✅ **Subtitle**: "Automation rules that trigger processing without manual action"
- ✅ **Slot IDs**: `#auto-read-rules-slot` → `#auto-runs-slot`, `#auto-read-presets-slot` → `#auto-runs-presets-slot`
- ✅ **`_renderAutoReadRules()` → `_renderAutoRuns()`**
- ✅ **`recording-pipeline.js`**: `evaluateAutoRead()` → `evaluateAutoRun()`, import updated
- ✅ **Console log**: "Auto-Read match" → "Auto-Run match"

#### 25d. Test Migration
- ✅ **`auto-read-rules.test.js` → `auto-runs.test.js`**
- ✅ **4 new tests**: appId field, presets appId, backward-compat alias tests
- ✅ **Old files deleted**: `auto-read-rules.js`, `auto-read-rules.test.js`

#### 25e. Production Metrics
- ✅ **733 tests** — 4 new (was 729)
- ✅ **Bundle** — 497 KB / 130 KB gzip
- ✅ **Zero remaining "Auto-Read" references** (except intentional migration comments)

---

### Phase 26: Quick Action Ownership Refactor ✅

*Each app owns its quick actions. Upload belongs to Drive, Record to Recorder. Domain events replace generic routing.*

#### 26a. Ownership Transfer
- ✅ **Upload** moved from Recorder app → **Drive app** (`src/apps/drive/index.js`)
- ✅ **Record** stays in Recorder app — it's a recording operation
- ✅ Drive app's `getQuickActions()` returns Upload with `appId: 'drive'`, `order: 10`

#### 26b. Domain Events (replace generic routing)
- ✅ **Record**: `takus:quick-action` → `takus:start-recording` (domain event)
- ✅ **Upload**: `takus:quick-action` → `takus:upload` (domain event)
- ✅ **Generic `takus:quick-action` event eliminated** — zero references remain
- ✅ **AppShell**: `_setupQuickActionListener()` now listens for specific domain events, no routing logic

#### 26c. Quick Actions Renderer
- ✅ **Sorting by `order` field** — actions from different apps render in correct priority
- ✅ **Email icon added** to icon map for future Gmail app
- ✅ **Header comment** updated: "Each app owns its actions: Recorder → Record, Drive → Upload, etc."

#### 26d. Production Metrics
- ✅ **733 tests** — zero regressions
- ✅ **Bundle** — 497 KB / 130 KB gzip
- ✅ **Visual parity** — Upload and Record buttons look identical to before
- ✅ **Upload handler verified** — file picker triggers correctly

---

### Phase 27: App-Extensible Auto-Runs ✅

*Auto-Run presets are now contributed by apps. No more hardcoded presets — apps own their automation rules.*

#### 27a. Interface + AppManager
- ✅ **`AutoRunPreset` typedef** added to `app-interface.js`
- ✅ **`getAutoRunPresets()` on TakusApp interface** — optional method for apps to contribute presets
- ✅ **`getAutoRunPresets()` aggregator** added to `app-manager.js` — collects from all active apps, tags with `appId`, `appIcon`, `appName`
- ✅ **`createAppStub` default** — `getAutoRunPresets: () => []`

#### 27b. Recorder App Presets
- ✅ **4 presets moved** from `auto-runs.js` → `RecorderApp.getAutoRunPresets()`
  - Auto-run: process meetings (type=meeting)
  - Auto-run: process updates (type=update)
  - Auto-run: process standups (title contains "standup")
  - Auto-run: calendar recordings (source=auto-record)

#### 27c. Settings Panel
- ✅ **Parallel import**: `Promise.all([auto-runs.js, app-manager.js])` — presets from AppManager, rules from auto-runs
- ✅ **App icon** shown next to each preset suggestion (e.g., 🎬 for Recorder)
- ✅ **Tooltip** on hover shows app name

#### 27d. auto-runs.js Deprecation
- ✅ **`getAutoRunPresets()`** in `auto-runs.js` now returns `[]` (deprecated)
- ✅ **Canonical source**: `AppManager.getAutoRunPresets()`

#### 27e. Tests
- ✅ **4 new AppManager tests**: aggregation, empty presets, inactive exclusion, legacy handling
- ✅ **auto-runs.test.js** updated for deprecated `getAutoRunPresets()`
- ✅ **736 tests** — 3 net new (was 733)

#### 27f. Production Metrics
- ✅ **736 tests** — zero regressions
- ✅ **Bundle** — 497 KB / 130 KB gzip
- ✅ **Browser verified** — 4 Recorder presets with 🎬 icon visible in Settings

---

### Phase 28: Session Config Extraction ✅

*Session config (type picker + camera/mic) moved from hardcoded AppShell to Recorder app's `renderConfigPanel()`. The home screen is now fully dynamic — apps contribute their own config panels.*

#### 28a. Interface + AppManager
- ✅ **`renderConfigPanel(container, callbacks)` on TakusApp interface** — optional method for home-screen config panels
- ✅ **`getConfigPanelApps()` aggregator** added to `app-manager.js`
- ✅ **`createAppStub` default** — `renderConfigPanel: null`

#### 28b. Recorder App
- ✅ **`renderConfigPanel()`** implemented — delegates to `session-config.js` via dynamic import
- ✅ The Recorder app now owns: Quick Actions (Record), Auto-Run presets, and Config Panel

#### 28c. AppShell Decoupling
- ✅ **`renderSessionConfig` import removed** from top-level AppShell imports
- ✅ **`session-config-slot`** → **`config-panel-slot`** (generic platform slot)
- ✅ **`_renderAppConfigPanels()`** method — dynamically renders config panels from active apps
- ✅ **Dual fallback**: if no app platform or config panel apps, falls back to direct `session-config.js` import

#### 28d. Production Metrics
- ✅ **736 tests** — zero regressions
- ✅ **Bundle** — 499 KB / 130 KB gzip
- ✅ **Visual parity** — type chips, camera/mic selectors render identically
- ✅ **Zero console errors**

---

### Phase 29: App Shell Thinning — Upload Flow ✅

*File selection + validation moved from AppShell to Drive app. The upload pipeline is now a proper domain event flow: Drive validates → dispatches `takus:file-selected` → AppShell manages state transition.*

#### 29a. Drive App Ownership
- ✅ **`_pickAndValidateFile()`** — Drive app now owns file picker, 2 GB limit, extension validation
- ✅ **`takus:file-selected`** domain event — dispatched with validated `{ file }` detail
- ✅ **`takus:upload`** event eliminated — zero remaining references

#### 29b. AppShell Simplification
- ✅ **`_handleFileSelected(file)`** — single entry point for all file-to-review transitions
- ✅ **`_handleUpload()`** — simplified to inline fallback for no-app-platform scenario
- ✅ **Drag-drop** now delegates to `_handleFileSelected()` (was duplicating state management)
- ✅ **Single code path** — drag-drop, Drive app, and fallback all converge to `_handleFileSelected`

#### 29c. Domain Event Architecture (Updated)
| Event | Owner | Handler |
|---|---|---|
| `takus:start-recording` | Recorder app | AppShell → `_handleStart()` |
| `takus:file-selected` | Drive app / drag-drop | AppShell → `_handleFileSelected()` |

#### 29d. Production Metrics
- ✅ **736 tests** — zero regressions
- ✅ **Bundle** — 499 KB / 130 KB gzip
- ✅ **Upload flow verified** — file picker → review screen → discard all working
- ✅ **Zero console errors**

---

### Phase 30: Test Coverage + AppShell DRY-up ✅

*First-ever built-in app tests + AppShell callback deduplication. Test count grew from 736 → 754.*

#### 30a. Built-in App Tests (NEW)
- ✅ **`built-in-apps.test.js`** — 15 tests covering RecorderApp and DriveApp contracts:
  - Manifest validation (passes `validateAppManifest`)
  - Quick actions (Record=primary/order:1, Upload=secondary/order:10)
  - Auto-run presets (4 Recorder presets, field/operator/value validated)
  - Config panel presence (Recorder has it, Drive doesn't)
  - Inbox capability (Recorder=true, Drive=false)
  - Settings schema (Drive has provider selector)

#### 30b. AppManager Config Panel Tests
- ✅ **3 new tests** for `getConfigPanelApps()` aggregator:
  - Returns apps with `renderConfigPanel` function
  - Excludes inactive apps
  - Returns empty when no apps have config panels

#### 30c. AppShell DRY-up
- ✅ **`_getConfigCallbacks()`** — extracted shared callbacks (was duplicated 3×)
- ✅ **`_renderFallbackConfig()`** — extracted fallback session-config rendering
- ✅ **Net reduction**: −0.57 KB bundle, −3 LOC

#### 30d. Production Metrics
- ✅ **754 tests** (+18) — 52 test files
- ✅ **Bundle** — 498 KB / 130 KB gzip
- ✅ **Zero regressions**

---

### Phase 31: Inbox Platform Service ✅

*Unified intake queue for the Knowledge OS. All incoming knowledge items flow through the Inbox Service before being processed by the intelligence pipeline. Auto-Run rules evaluate items to determine auto-processing or inbox hold.*

#### 31a. Inbox Service (`src/lib/inbox.js`) [NEW]
- ✅ **`submitToInbox(item)`** — submit item, evaluate Auto-Runs, return `{ action: 'auto-process'|'hold', item, matchedRule }`
- ✅ **`processInboxItem(item)`** — manually approve for processing
- ✅ **`completeInboxItem(item)`** — mark as processed
- ✅ **`failInboxItem(item, error)`** — mark as error with message
- ✅ **`onInboxEvent(fn)`** — event bus for inbox lifecycle events
- ✅ **`getInboxProducers()`** — get active apps that produce inbox items

#### 31b. Event Bus
| Event | Trigger |
|---|---|
| `inbox:received` | Item held in inbox (no Auto-Run match) |
| `inbox:auto-processed` | Item auto-processed (Auto-Run match) |
| `inbox:processing` | Item manually approved |
| `inbox:completed` | Processing finished |
| `inbox:error` | Processing failed |

#### 31c. Pipeline Integration
- ✅ **`recording-pipeline.js`** → `evaluateAutoRun()` now routes through Inbox Service
- ✅ **Fallback**: direct `auto-runs.js` evaluation if Inbox Service unavailable
- ✅ Item lifecycle: `App → Inbox → Auto-Run → Process or Hold`

#### 31d. Item Shape (InboxItem)
```
{ id, appId, type, title, state, createdAt, metadata, matchedRuleId }
```

#### 31e. Production Metrics
- ✅ **768 tests** (+14) — 53 test files
- ✅ **Bundle** — 499 KB / 130 KB gzip (inbox lazy-loaded)
- ✅ **Zero regressions**

---

### Phase 32: Inbox UI + Lifecycle Wiring ✅

*Connected the Inbox Service to the History panel's Process button. Manual processing now routes through the full inbox lifecycle: `processInboxItem → completeInboxItem/failInboxItem`, emitting events at each stage.*

#### 32a. History Panel Integration
- ✅ **Process button** now creates an InboxItem and tracks lifecycle through Inbox Service
- ✅ **Success path**: `processInboxItem() → processRawRecording() → completeInboxItem()`
- ✅ **Error path**: `processInboxItem() → error → failInboxItem(error.message)`
- ✅ **Graceful fallback**: if Inbox Service unavailable, processing continues without lifecycle tracking

#### 32b. Recording Pipeline Integration  
- ✅ **`evaluateAutoRun()`** routes through `submitToInbox()` for auto-run decisions
- ✅ Items auto-processed by Auto-Run rules emit `inbox:auto-processed` event
- ✅ Items held in inbox emit `inbox:received` event

#### 32c. Complete Item Lifecycle
```
Recording completes → evaluateAutoRun()
  ├── submitToInbox() evaluates Auto-Run rules
  │     ├── Match → inbox:auto-processed → processAI()
  │     └── No match → inbox:received → held as state: 'raw'
  │
  └── User clicks "Process" in History
        ├── processInboxItem() → inbox:processing
        ├── processRawRecording() → AI pipeline
        │     ├── Success → completeInboxItem() → inbox:completed
        │     └── Failure → failInboxItem() → inbox:error
        └── Re-render History panel
```

#### 32d. Production Metrics
- ✅ **768 tests** — zero regressions
- ✅ **Bundle** — 499 KB / 130 KB gzip
- ✅ **Full lifecycle wired** — Inbox Service events fire on every state transition

---

### Phase 33: History Entry Factory Extraction ✅

*Extracted inline history entry construction from AppShell into a reusable `createHistoryEntry()` factory in the recording pipeline. Any app can now produce standardized history entries.*

#### 33a. `createHistoryEntry()` Factory [NEW]
- ✅ **Params**: `{ title, type, duration, size, observerLog }`
- ✅ **Auto-generates** default title using `typeLabel + shortDate + shortTime`
- ✅ **Sets** `id` via `generateId('rec')`, `device` via `deviceName()`, `date` to `Date.now()`
- ✅ **Initializes** all AI fields to `null` (driveLink, aiSummary, aiTranscript, aiVtt, tasks)

#### 33b. AppShell Simplification
- ✅ **`_onRecordingApproved()`** now delegates to `createHistoryEntry()` (was 17 lines of inline construction)
- ✅ **Removed unused imports**: `typeLabel`, `shortDate`, `shortTime`, `deviceName`, `generateId`
- ✅ **Net reduction**: 1,513 lines (down from 1,529 at session start)

#### 33c. Test Coverage
- ✅ **5 new tests** for `createHistoryEntry()`:
  - Defaults (id, title, type, device, null fields)
  - Custom title preservation
  - Type-based title generation (Meeting, Screen Recording)
  - Metadata passthrough (duration, size, observerLog)
  - Timestamp accuracy

#### 33d. Production Metrics
- ✅ **773 tests** (+5) — 53 test files
- ✅ **Bundle** — 500 KB / 130 KB gzip
- ✅ **AppShell** — 1,513 lines (−16 from session start)
- ✅ **Zero regressions**

---

### Phase 34: Inbox App + Platform Improvements ✅

*Dedicated Inbox App with nav tab, badge count, and panel rendering. Platform improvements: dynamic badge support for all apps, new app auto-activation on existing installs.*

#### 34a. Inbox App (`src/apps/inbox/index.js`) [NEW]
- ✅ **Nav item** — `📥 Inbox` tab with order `5` (appears before History)
- ✅ **Badge count** — live count of `state: 'raw'` recordings, updated via Inbox Service events
- ✅ **Panel** — empty state ("All caught up!"), item list with Process buttons, Process All
- ✅ **Live updates** — subscribes to `inbox:received`, `inbox:completed`, `inbox:auto-processed`
- ✅ Registered in `src/apps/registry.js` as core app

#### 34b. Platform Improvements
- ✅ **Dynamic tab badges** — any app with `getBadgeCount()` gets a live badge (was hardcoded to tasks only)
- ✅ **New app auto-activation** — `initAppManager()` now auto-activates newly registered apps on existing installs
- ✅ **Inbox icon** — added `icons.inbox` (Lucide tray SVG) to the icon library
- ✅ **Tab icon fallback** — apps without a TAB_ICONS entry use their emoji icon

#### 34c. Test Coverage
- ✅ **7 InboxApp tests**: manifest, identity, nav item, badge, no quick actions, no inbox production, renderPanel

#### 34d. Production Metrics
- ✅ **780 tests** (+7) — 53 test files
- ✅ **Bundle** — 501 KB / 131 KB gzip
- ✅ **10 registered apps** (up from 9)
- ✅ **Zero regressions**

---

### Phase 35: Recording Finalization Pipeline ✅

*Extracted the post-approval recording pipeline from AppShell into a single `finalizeRecording()` function. Consolidates watermarking, local blob save, history persistence, and AI kickoff.*

#### 35a. `finalizeRecording()` Function [NEW]
- ✅ **Params**: `(blob, historyEntry, { watermarkText, onPhase, processOptions })`
- ✅ **Watermark**: applies via dynamic `addWatermark` import with progress callback
- ✅ **Local save**: persists blob to IndexedDB via `saveRecordingBlob`
- ✅ **History**: calls `saveRecording()` immediately for crash resilience
- ✅ **AI kickoff**: delegates to `processAI()` when `processOptions` provided
- ✅ **Returns**: `{ processedBlob, historyEntry }` for upload pipeline

#### 35b. AppShell Simplification
- ✅ **`_onRecordingApproved()`** reduced from ~60 lines to ~35 lines
- ✅ **`_processAI()` removed** — dead code after finalizeRecording handles it
- ✅ **Removed unused imports**: `addWatermark`, `saveRecordingBlob`, `processAI`
- ✅ **Net reduction**: 1,497 lines (−32 from session start)

#### 35c. Test Coverage
- ✅ **4 new tests** for `finalizeRecording()`:
  - Returns processedBlob and historyEntry
  - Persists history entry to storage
  - Calls processAI when processOptions provided
  - Skips processAI without processOptions

#### 35d. Production Metrics
- ✅ **784 tests** (+4) — 53 test files
- ✅ **Bundle** — 501 KB / 131 KB gzip
- ✅ **AppShell** — 1,497 lines (−32 from session start)
- ✅ **Zero regressions**

---

### Phase 36: Upload Handler Delegation ✅

*Replaced the 30-line inline file picker in `_handleUpload()` with a 14-line delegate to `DriveApp._pickAndValidateFile()`. Eliminates the last file validation duplication between AppShell and Drive app.*

#### 36a. Changes
- ✅ **`_handleUpload()`** — now delegates to `DriveApp._pickAndValidateFile()` (single source of truth)
- ✅ **Fallback** — shows "Upload unavailable" toast if Drive app isn't active
- ✅ **AppShell** — 1,484 lines (−45 from session start, −13 from Phase 35)

#### 36b. Production Metrics
- ✅ **784 tests** — 53 test files, zero regressions
- ✅ **Bundle** — 501 KB / 131 KB gzip
- ✅ **AppShell** — **1,484 lines** (−45 from session start)

---

### Phase 37: Cloud Upload Pipeline Extraction ✅

*Extracted the 120-line `_doUpload` method from AppShell into a standalone `uploadToCloud()` function in `upload-manager.js`. The function handles the full upload lifecycle: provider selection, vault sync, calendar integration, and clipboard copy — all UI-free.*

#### 37a. `uploadToCloud()` Function [NEW]
- ✅ **Params**: `{ blob, filename, historyEntry, provider, context }` + `{ onProgress, onCalendarLinked }`
- ✅ **15-min timeout** — deadline guard against stalled uploads
- ✅ **Vault sync** — auto-detects `uploadRecordingPackage` vs legacy `uploadResumable`
- ✅ **Calendar integration** — finds matching meeting event and links recording
- ✅ **Auto-copy** — copies drive link to clipboard if `autoCopyLink` setting is on
- ✅ **Returns**: `{ link, folderId?, calendarEvent?, participants? }`

#### 37b. AppShell Simplification
- ✅ **`_doUpload()`** reduced from 120 lines to 55 lines (thin delegate)
- ✅ **Removed imports**: `saveVaultSync`
- ✅ **Removed dead code**: `watermarkText` local variable, `recordId` variable
- ✅ **Net reduction**: **1,415 lines** (−114 from session start!)

#### 37c. Test Coverage
- ✅ **4 new tests** for `uploadToCloud()`:
  - Uploads and returns drive link
  - Throws on missing blob
  - Throws on missing provider
  - Calls onProgress callback

#### 37d. Production Metrics
- ✅ **788 tests** (+4) — 53 test files
- ✅ **Bundle** — 502 KB / 131 KB gzip
- ✅ **AppShell** — **1,415 lines** (−114 from session start)
- ✅ **Zero regressions**

---

### Phase 38: Goal Engine + Goals App ✅

*The mission-critical feature: first-class goal preservation. Goals are platform-agnostic graph nodes with lifecycle states. The autonomy engine detects goals from any content and monitors their health. This transforms Takus from "smart screen recorder" to "Knowledge OS for Goal Preservation in accordance with Human Well-being."*

#### 38a. GoalApp [NEW] — `src/apps/goals/index.js`
- ✅ **11th registered app** (core — cannot be deactivated)
- ✅ **Goal node type** — `{ title, description, state, targetDate, lastMentionedAt, mentionCount, progressNotes, source }`
- ✅ **5 lifecycle states** — `aspiration → active → at-risk → achieved → abandoned`
- ✅ **Edge types** — `CONTRIBUTES_TO` (any → goal), `SUPPORTS` (task → goal), `INVOLVES` (contact → goal)
- ✅ **Nav item** — "🎯 Goals" (order 4) with at-risk badge count
- ✅ **Quick Action** — "🎯 Add Goal"
- ✅ **Panel** — goal cards grouped by state with inline Activate/Achieve/Abandon actions
- ✅ **Auto-Run preset** — "Auto-detect goals from meetings"
- ✅ **Platform-agnostic** — `source` field tracks origin (recording, document, manual, etc.)

#### 38b. AI Goal Extraction [NEW] — `extractGoals()` in `ai-engine.js`
- ✅ **Platform-agnostic** — works on any text (transcripts, documents, meeting notes)
- ✅ **Matches existing goals** — returns `matchedGoalId` when intent matches an existing goal
- ✅ **Evidence-based** — extracts exact quotes supporting each detected goal
- ✅ **Provider-agnostic** — works with both OpenAI and Gemini

#### 38c. Autonomy Integration
- ✅ **`autonomy_goal_health`** step registered in step-executor
- ✅ **`_autoGoalHealth()`** added to autonomy tick loop
- ✅ **Stagnation detection** — active goals with no mention in 14+ days → at-risk
- ✅ **Auditable** — all health checks logged to autonomy action log
- ✅ **Goal stats** added to `_stats` tracking

#### 38d. Infrastructure
- ✅ **`target` icon** added to icon library (Lucide-style concentric circles)
- ✅ **11 new tests** — manifest validation, node type registration, goal state validation, extractGoals edge cases

#### 38e. Production Metrics
- ✅ **799 tests** (+11) — 54 test files
- ✅ **11 apps** (was 10)
- ✅ **Bundle** — 505 KB / 132 KB gzip (+3 KB for entire Goal Engine)
- ✅ **Zero regressions**

---

### Phase 39: Well-being Service ✅

*"In accordance with Human Well-being" — monitors work patterns and provides gentle, non-intrusive nudges. No urgency theater, no nagging, no manipulation. One-and-done reminders that respect user sovereignty.*

#### 39a. Well-being Service [NEW] — `src/lib/wellbeing.js`
- ✅ **Session tracking** — `startSession()`, `getSessionDuration()`, `acknowledgeBreak()`
- ✅ **Break suggestions** — after 2+ hours, gentle toast "Consider a short break 🌿"
- ✅ **One-and-done** — 1-hour cooldown between suggestions (no nagging)
- ✅ **Goal overload** — >7 active goals → "Consider focusing on 3–5"
- ✅ **Stagnation awareness** — all goals unchanged for 7+ days → "Want to review?"
- ✅ **Event system** — `onWellbeingEvent()` for apps to subscribe to well-being signals
- ✅ **Composite check** — `runWellbeingCheck()` aggregates break + goal health

#### 39b. Autonomy Integration
- ✅ **`_autoWellbeing()`** — added as step 7 in the autonomy tick loop
- ✅ **Goal-aware** — loads goal nodes and passes to well-being check
- ✅ **Toast notifications** — surfaces suggestions via `notifyEphemeral()` with calm `info` styling
- ✅ **Auditable** — all well-being events logged to autonomy action log

#### 39c. Shell Integration
- ✅ **`startSession()`** called in AppShell init (alongside `startAutonomy()`)
- ✅ **Lazy-loaded** — dynamic import, never blocks shell startup

#### 39d. Production Metrics
- ✅ **811 tests** (+12) — 55 test files
- ✅ **Bundle** — 509 KB / 133 KB gzip (+4 KB for entire Well-being Service)
- ✅ **Zero regressions**

---

### Phase 40: Goal-Aware Intelligence ✅

*Goals woven into every intelligence surface. Meeting prep shows relevant goals for each attendee. Daily digest includes goal progress and at-risk warnings. All goal-aware features are platform-agnostic — goals from any source (recordings, documents, manual) are included.*

#### 40a. Meeting Prep Enhancement — `src/lib/meeting-prep.js`
- ✅ **`goalContext`** added to prep package
- ✅ **INVOLVES edges** — loads goals linked to attendee contacts
- ✅ **Per-contact edge queries** — uses `getEdgesFromNode()` (no bulk edge dump)
- ✅ **Filters terminal goals** — excludes achieved/abandoned goals
- ✅ **linkedContacts** — shows which attendees relate to each goal

#### 40b. Daily Digest Enhancement — `src/lib/daily-digest.js`
- ✅ **`goalProgress`** section added to digest
- ✅ **Recently mentioned** — goals with activity in the last 24 hours
- ✅ **At-risk summary** — stagnating goals flagged by autonomy engine
- ✅ **Total open count** — active + at-risk + aspiration goals

#### 40c. Production Metrics
- ✅ **811 tests** — zero regressions
- ✅ **Bundle** — 510 KB / 134 KB gzip (+1 KB for goal-aware intelligence)
- ✅ **Zero regressions**

---

### Phase 41: Pipeline Goal Detection + Ask Goal Context ✅

*Goal detection integrated into the recording pipeline — every AI-processed recording now automatically detects and links goals. The Ask panel shows related goals alongside search results.*

#### 41a. Recording Pipeline Enhancement — `src/lib/recording-pipeline.js`
- ✅ **`_detectGoalsFromTranscript()`** — new step in processAI (between task extraction and edge creation)
- ✅ **New goals** — created as `aspiration` nodes with `source: 'recording'`
- ✅ **Existing matches** — bumps `lastMentionedAt`, `mentionCount`, appends evidence to `progressNotes`
- ✅ **CONTRIBUTES_TO edges** — recording → goal for every detection
- ✅ **Toast notification** — "Goals detected: N goal(s) identified"

#### 41b. Ask Panel Enhancement — `src/components/ask-panel.js`
- ✅ **🎯 Related Goals** section in answer card
- ✅ **Pure local matching** — keyword overlap with goal titles/descriptions, no API call
- ✅ **State-aware icons** — 🔴 at-risk, 🟢 active, 💭 aspiration
- ✅ **Filters terminal goals** — excludes achieved/abandoned

#### 41c. Production Metrics
- ✅ **811 tests** — zero regressions
- ✅ **Bundle** — 513 KB / 134 KB gzip (+3 KB)
- ✅ **Zero regressions**

---

### Phase 42: Goal Graph Integrity + DRY Hardening ✅

*Full codebase audit → discovered and fixed 5 architectural gaps.*

#### 42a. Edge Type Registry — `src/lib/edge-types.js`
- ✅ **Registered 3 missing edge types**: `CONTRIBUTES_TO`, `SUPPORTS`, `INVOLVES`
- ✅ **Now visible** in insights panel, recording detail, and graph UI
- ✅ **Test updated** — `getEdgeTypeKeys()` now asserts 12 types (was 9)

#### 42b. DRY: Duplicate Helper Consolidation
- ✅ **`timeAgo()`** — added to `utils.js` as canonical export
- ✅ **`_timeAgo()` eliminated** — 3 duplicates → 0 (settings-panel, inbox, goals all use shared import)
- ✅ **`_esc()` reduced** — 4 duplicates → 2 (goals + inbox now use shared `esc()` from utils)
- ✅ **Remaining 2 `_esc()`** in qr-code.js and notification-manager.js are self-contained (no external imports), acceptable

#### 42c. Codebase Inventory (audited)
| Category | Count |
|----------|-------|
| Source files | 114 |
| Test files | 55 |
| Source lines | ~30,000 |
| Test lines | ~8,100 |
| Apps | 11 |
| Edge types | 12 |
| Autonomy steps | 7 |

#### 42d. Production Metrics
- ✅ **811 tests** — zero regressions (fixed 1 test for new edge type count)
- ✅ **Bundle** — 514 KB / 135 KB gzip
- ✅ **Zero regressions**

---

### Phase 43: Goal Surfaces + Task→Goal Linking ✅

*Goals are now visible in the recording detail view, and tasks are automatically linked to goals via SUPPORTS edges.*

#### 43a. Recording Detail — `src/components/recording-detail.js`
- ✅ **"🎯 Linked Goals"** dedicated section in right pane (populated async)
- ✅ **`_populateGoals()`** — queries CONTRIBUTES_TO edges, resolves goal nodes, renders with state icons
- ✅ **State-aware**: 🔴 at-risk, 🟢 active, 💭 aspiration, ✅ achieved, 🚫 abandoned

#### 43b. Task→Goal SUPPORTS Linking — `src/lib/recording-pipeline.js`
- ✅ **`_linkTasksToGoals()`** — keyword matching between task objective/title and goal titles
- ✅ **Minimum 2 keyword overlap** to avoid false positives
- ✅ **Platform-agnostic** — pure local text matching, zero API calls
- ✅ **Goal detection now awaited** before task→goal linking for correct ordering

#### 43c. Production Metrics
- ✅ **811 tests** — zero regressions
- ✅ **Bundle** — 515 KB / 135 KB gzip (+1 KB)
- ✅ **Zero regressions**

---

### Phase 44: Pipeline-as-Steps ✅

*Every AI processing run is now a structured, observable manifest with 7 ordered steps.*

#### 44a. Pipeline Run Model — `src/lib/recording-pipeline.js`
- ✅ **`createPipelineRun()`** — creates manifest with 7 ordered steps, each with `pending → running → done | failed` status
- ✅ **`_markStep()`** — transitions step status with timestamps
- ✅ **`getPipelineStepLabel()`** — exported utility for UI labeling
- ✅ **Step IDs**: `extract_audio`, `transcribe`, `extract_tasks`, `analytics`, `goal_detection`, `graph_enrich`, `embeddings`

#### 44b. processAI Integration
- ✅ **Pipeline run persisted** on `historyEntry.pipelineRun` — survives page refresh
- ✅ **`onStepUpdate` callback** — fires on every step status change for real-time UI
- ✅ **Error isolation** — failed step is marked with error message, remaining steps left as pending
- ✅ **Backward compatible** — existing `onPhase(label, pct, sub)` signature preserved

#### 44c. Recording Detail UI — `src/components/recording-detail.js`
- ✅ **"⚡ Pipeline Steps"** collapsible section in right pane
- ✅ **Step status icons**: ✓ done, ✗ failed, ⏳ running, ○ pending
- ✅ **Per-step duration** and error tooltips
- ✅ **Overall status + total duration** in summary header

#### 44d. Tests — `src/lib/__tests__/recording-pipeline.test.js`
- ✅ **+8 new tests**: manifest shape, step IDs, step labels, pipeline tracking, onStepUpdate, failure marking
- ✅ **Fixed mock** — `extractTasks` now returns Promise (was plain object)

#### 44e. Production Metrics
- ✅ **819 tests** — zero regressions (+8)
- ✅ **Bundle** — 516 KB / 135 KB gzip (+1 KB)
- ✅ **Zero regressions**

---

### Phase 45: Goal Analytics ✅

*Goals panel now shows a visual progress bar and key metrics.*

#### 45a. Goal Analytics Engine — `src/apps/goals/index.js`
- ✅ **`_computeGoalAnalytics()`** — pure function: achievement %, state distribution, average age, total mentions, most active
- ✅ **`computeGoalAnalytics()`** — exported platform utility for any intelligence surface
- ✅ **Visual progress bar** — color-coded segments (green=achieved, blue=active, red=at-risk, gray=aspiration)
- ✅ **Key metrics row**: total mentions, average goal age, most active goal

#### 45b. Tests — `src/apps/__tests__/goals.test.js`
- ✅ **+2 tests**: analytics with varied goal states, empty state handling

---

### Phase 46: Pipeline Retry ✅

*Failed pipeline steps can now be retried from the recording detail UI.*

#### 46a. Retry Engine — `src/lib/recording-pipeline.js`
- ✅ **`retryFailedStep(recordingId, options)`** — re-runs full AI pipeline
- ✅ **Run archiving** — previous pipelineRun archived to `pipelineRunHistory[]` for audit trail
- ✅ **Blob safety** — graceful handling when recording media not available locally
- ✅ **Platform-agnostic** — works for any recording type

#### 46b. Recording Detail UI — `src/components/recording-detail.js`
- ✅ **"↻ Retry Pipeline" button** — appears when `pipelineRun.status === 'failed'`
- ✅ **Spinner state** — button shows "⏳ Retrying…" during processing
- ✅ **Auto re-render** — detail panel refreshes when retry completes

#### 46c. Inbox Service Completion — `src/lib/inbox.js`
- ✅ **`getInboxItems()`** — canonical query, sorted by date descending
- ✅ **`getInboxCount()`** — lightweight count for badge
- ✅ **`dismissInboxItem()`** — state: raw → dismissed, emits `inbox:dismissed`
- ✅ **InboxApp migrated** — now uses inbox service instead of querying storage directly
- ✅ **Dismiss buttons** — added ✕ dismiss button to each inbox item

#### 46d. Tests
- ✅ **+1 test**: retryFailedStep archives previous run and re-processes

#### 46e. Production Metrics
- ✅ **822 tests** — zero regressions (+3)
- ✅ **Bundle** — 517 KB / 136 KB gzip (+1 KB)
- ✅ **Zero regressions**

---

### Phase 28: App-Extensible Auto-Runs ✅

*Every app can now contribute automation presets to the platform.*

#### 28a. App Contributions
- ✅ **RecorderApp** — 4 presets (meetings, updates, standups, calendar)
- ✅ **GoalApp** — 1 preset (auto-detect goals)
- ✅ **CalendarApp** — 2 presets (calendar recordings, 1:1 meetings)
- ✅ **DriveApp** — 1 preset (uploaded files)
- ✅ **IntegrationsApp** — 1 preset (post updates to Slack)
- ✅ **Total**: 9 presets across 5 apps (was 5 presets across 2 apps)

#### 28b. Tests — `src/apps/__tests__/built-in-apps.test.js`
- ✅ **+4 tests**: DriveApp presets, CalendarApp presets, IntegrationsApp presets, total platform presets ≥ 8

#### 28c. Production Metrics
- ✅ **826 tests** — zero regressions (+4)
- ✅ **Bundle** — 517 KB / 136 KB gzip (no change)

---

### Phase 29a: AppShell Thinning — RecordingController ✅

*First extraction: recording lifecycle methods moved to dedicated module.*

#### 29a. `src/components/recording-controller.js` — [NEW]
- ✅ **RecordingController class** — owns recording lifecycle (start, pause, resume, stop, approve, upload, screenshot, share, facecam, countdown, reset)
- ✅ **Dependency injection** — receives sm, recorder, facecam, cpm from AppShell
- ✅ **Clean ESM imports** — no require(), no circular dependencies
- ✅ **~350 lines** of recording-specific logic isolated from AppShell
- ✅ **Accessors** — lastBlob, uploadState, lastHistoryEntry etc. for AppShell render

#### 29b. AppShell Wiring ✅ — `src/components/app-shell.js`
- ✅ **All 14 recording methods** delegated: handleStart, handlePause, handleResume, handleStop, onRecordingApproved, doUpload, downloadLocal/MP4/GIF, handleScreenshot, handleShare, toggleFacecam, showCountdown, reset
- ✅ **13 property proxies** (get/set) for backward-compat: _lastBlob, _lastFilename, _uploadState, _lastHistoryEntry, _pendingTitle, _recordingStartTime, _recordingType, _startLock, _observer, _observerLog, _recoveryId, _recoveryInterval, _fiftyMinWarned
- ✅ **Constructor slimmed** — removed 13 recording state fields, replaced with `this._rc = new RecordingController({...})`
- ✅ **AppShell reduced**: 1418 → **1061 lines** (−357 lines, −25%)
- ✅ **Zero functional regression** — all 826 tests pass

#### 29. Production Metrics
- ✅ **826 tests** — zero regressions
- ✅ **Bundle** — 520 KB / 136 KB gzip (+3 KB from controller inclusion)
- ✅ **AppShell**: 1061 lines (was 1418)
- ✅ **RecordingController**: 440 lines (new)

---

### Phase 47: Task Analytics & Platform Health ✅

*Production-grade observability and task intelligence.*

#### 47a. Task Analytics — `src/lib/graph/task-store.js`
- ✅ **`computeTaskAnalytics()`** — platform utility (pure computation)
  - Completion rate (done / non-ignored)
  - Average resolution time (hours)
  - Velocity (tasks completed in last 7 days)
  - Overdue count (pending > 7 days)
  - Oldest pending task age
  - Top action types
- ✅ **Task Analytics UI** — stats bar in global tasks panel showing velocity, avg resolution, overdue warnings

#### 47b. Platform Health Check — `src/lib/health-check.js` [NEW]
- ✅ **`runHealthCheck()`** — validates all platform services
  - Storage: recording count, orphaned recordings, failed pipelines
  - Graph: node counts (goals, tasks, people)
  - Tasks: counts, velocity, overdue
  - Goals: analytics
  - Inbox: item count
- ✅ **`formatHealthReport()`** — human-readable output
- ✅ **Warnings**: orphaned recordings, failed pipelines, overdue tasks

#### 47c. TasksApp Auto-Run Presets
- ✅ **2 presets**: extract from standups, create bug tickets
- ✅ **Total platform presets**: 11 across 6 apps

#### 47d. Tests
- ✅ **+10 tests**: computeTaskAnalytics (4), health check (5), TasksApp presets (1)

#### 47. Production Metrics
- ✅ **836 tests** — zero regressions (+10)
- ✅ **Bundle** — 520 KB / 136 KB gzip (unchanged)
- ✅ **Auto-Run Presets**: 11 across 6 apps

---

### Phase 48: Recovery Extraction & Health UI ✅

*Continue AppShell thinning — below 1,000 lines.*

#### 48a. Recovery Manager — `src/components/recovery-manager.js` [NEW]
- ✅ **`checkRecovery(deps)`** — checks IndexedDB for crash-recovery data
- ✅ **`_renderRecoveryBanner()`** — Resume / Download / Discard UI
- ✅ **Dependency injection** — `{ sm, States, onResumeBlob }` for clean decoupling
- ✅ **−85 lines** from AppShell

#### 48b. Health Check UI — `src/components/insights-panel.js`
- ✅ **`_healthCard()`** — wired to Insights panel
- ✅ Displays all 5 service checks with ✓/✗ indicators
- ✅ Shows warnings with amber badges
- ✅ Status: healthy / healthy_with_warnings / degraded

#### 48c. Dead Import Cleanup
- ✅ Removed **6 unused import groups** from AppShell
  - storage.js (4 functions)
  - recorder.js (4 functions, kept only `Recorder`)
  - ffmpeg-engine.js, upload-manager.js, recording-pipeline.js, observer.js, share-panel.js, upload-progress.js (partial)

#### 48. Production Metrics
- ✅ **836 tests** — zero regressions
- ✅ **Bundle** — 546 KB / 143 KB gzip (health check wired into Insights)
- ✅ **AppShell**: **975 lines** (was 1,418 → −31%)
- ✅ **RecordingController**: 440 lines
- ✅ **RecoveryManager**: 118 lines

---

### Phase 49: Batch Task Operations ✅

*Productivity feature — select multiple tasks and apply bulk actions.*

#### 49a. Batch Mode UI — `src/components/global-tasks-panel.js`
- ✅ **"☐ Select" toggle** — appears when ≥2 pending tasks
- ✅ **Per-row checkboxes** — replace done buttons in batch mode
- ✅ **Select All** checkbox — toggles entire pending set
- ✅ **Batch toolbar** — selected count + ✓ Done + ✗ Ignore buttons
- ✅ **Batch Mark Done** — parallel updateTask with batch output marker
- ✅ **Batch Ignore** — with required reason prompt

#### 49. Production Metrics
- ✅ **847 tests** — zero regressions
- ✅ **Bundle** — 546 KB / 143 KB gzip (unchanged)

---

### Phase 50: Recording Search Engine ✅

*Full-text search across the knowledge base — transcripts, summaries, tasks, decisions.*

#### 50a. Search Engine — `src/lib/search-engine.js` [NEW]
- ✅ **`searchRecordings(query, options)`** — full-text search
  - Fields: title (10×), decisions (5×), tasks (4×), summary (3×), transcript (1×)
  - Weighted scoring with multi-field ranking
  - Snippet extraction with context
  - Stop-word filtering
  - Type filtering and result limiting
- ✅ **`getSearchSuggestions()`** — frequent terms from titles

#### 50b. Command Bar Integration — `src/components/command-bar.js`
- ✅ **Upgraded ⌘K search** — uses search engine instead of basic substring matching
- ✅ **Snippet previews** in search results
- ✅ **Matched field indicators** (transcript, tasks, decisions, summary)

#### 50c. Tests — `src/lib/__tests__/search-engine.test.js` [NEW]
- ✅ **11 tests**: title/transcript/task/decision search, snippets, ranking, filtering

#### 50. Production Metrics
- ✅ **847 tests** — zero regressions (+11)
- ✅ **Bundle** — 546 KB / 143 KB gzip

---

### Phase 51: Data Export Engine ✅

*Data portability — export everything in JSON or Markdown. Production must-have.*

#### 51a. Export Engine — `src/lib/export-engine.js` [NEW]
- ✅ **`exportData(options)`** — structured JSON bundle
  - Recordings (metadata, no blobs), tasks, goals, decisions
  - Analytics snapshot included
  - Options: includeTranscripts, includeTasks, includeGoals
  - Strips internal state (_blob, _priority, _source)
- ✅ **`downloadExportJSON()`** — triggers browser download
- ✅ **`exportMarkdown()`** — human-readable Markdown report
  - Summary table, goals, decisions, tasks (pending/done/ignored), recordings
- ✅ **`downloadExportMarkdown()`** — triggers .md download

#### 51b. Settings Integration — `src/components/settings-panel.js`
- ✅ **Data & Export section** with options checkboxes
- ✅ **Export JSON** + **Export Markdown** buttons
- ✅ Status feedback with ✓/✗ indicators

#### 51c. Command Bar — `src/components/command-bar.js`
- ✅ **"Export Data (JSON)"** command
- ✅ **"Export Data (Markdown)"** command

#### 51d. Tests — `src/lib/__tests__/export-engine.test.js` [NEW]
- ✅ **14 tests**: bundle structure, counts, decisions, cleanup, filtering, analytics, markdown

#### 51. Production Metrics
- ✅ **874 tests** — zero regressions (+27)
- ✅ **Bundle** — 550 KB / 144 KB gzip

---

### Phase 52: Recording Templates ✅

*Standardized processing profiles per recording type.*

#### 52a. Template Engine — `src/lib/recording-templates.js` [NEW]
- ✅ **`registerTemplate(tmpl)`** — extensible template registry
- ✅ **`getTemplates()`** — list all registered templates
- ✅ **`getTemplatesForType(type)`** — filter by recording type
- ✅ **`applyTemplate(id)`** — returns steps, extraction, processing, defaults
- ✅ **8 built-in templates**:
  1. 🌅 Daily Standup — blockers + decisions + action items
  2. 📋 Sprint Planning — full extraction with analytics + goal linking
  3. 🤝 1:1 Meeting — feedback + action items + personal notes
  4. 🖥️ Product Demo — transcription + quality score
  5. 🐛 Bug Report — steps + issues extraction
  6. 🎙️ Voice Memo — quick transcription + tasks
  7. 💡 Brainstorm Session — idea clustering + full extraction
  8. 🎯 Interview — speaker notes + decisions

#### 52b. Tests — `src/lib/__tests__/recording-templates.test.js` [NEW]
- ✅ **13 tests**: built-in count, fields, uniqueness, type filtering, apply, mutation safety

#### 52. Production Metrics
- ✅ **874 tests** — zero regressions
- ✅ **Bundle** — 550 KB / 144 KB gzip
- ✅ **Recording Templates**: 8 built-in

---

### Phase 53: Approval Center ✅

*Governance layer — tasks requiring user approval before autonomous execution.*

#### 53a. Approval Engine — `src/lib/approval-center.js` [NEW]
- ✅ **`getApprovalQueue()`** — scans tasks for pending steps needing consent
  - Step execution approvals (from `requiresApproval()`)
  - Integration action approvals (JIRA, email, etc.)
  - Filters out completed tasks, sorts newest first
- ✅ **`getApprovalCount()`** — badge count for UI
- ✅ **`approveItem(item)`** — execute step or approve integration
- ✅ **`rejectItem(item, reason)`** — skip step or reject integration

#### 53b. Insights Integration — `src/components/insights-panel.js`
- ✅ **Approval Queue card** — shows pending count with badge
- ✅ Only visible when approvals are pending

#### 53c. Tests — `src/lib/__tests__/approval-center.test.js` [NEW]
- ✅ **8 tests**: queue building, step/integration filtering, sorting, approve, reject

#### 53. Production Metrics
- ✅ **894 tests** — zero regressions (+20)
- ✅ **Bundle** — 557 KB / 146 KB gzip

---

### Phase 54: Activity Timeline ✅

*Unified chronological view of all platform events.*

#### 54a. Timeline Engine — `src/lib/activity-timeline.js` [NEW]
- ✅ **`getTimeline(options)`** — aggregates recordings + tasks + decisions
  - Event types: recording, task_created, task_done, task_ignored, decision
  - Filtering by type and timestamp
  - Limit and sort by timestamp descending
- ✅ **`getTimelineGrouped(options)`** — groups events by day
- ✅ **`getActivitySummary(daysBack)`** — 7-day stats

#### 54b. Insights Integration — `src/components/insights-panel.js`
- ✅ **Activity card** — 7-day stats + 5 most recent events
- ✅ Shows event icons, titles, and relative timestamps

#### 54c. Tests — `src/lib/__tests__/activity-timeline.test.js` [NEW]
- ✅ **12 tests**: event ordering, type inclusion, filtering, limit, grouping, summary

#### 54. Production Metrics
- ✅ **894 tests** — zero regressions
- ✅ **Bundle** — 557 KB / 146 KB gzip

---

### Phase 55: Tab System Extraction ✅

*Final AppShell thinning — tab bar management moved to standalone module.*

#### 55a. TabManager — `src/components/tab-manager.js` [NEW]
- ✅ **`buildTabBarHTML(getNavItems)`** — generates tab buttons + panel slots
- ✅ **`initMainTabs(deps)`** — labels, badges, click/keyboard handlers
- ✅ **`lazyRenderTab(tabId, deps)`** — app delegation + system tab fallbacks
- ✅ Uses dependency injection for AppShell callbacks
- ✅ ARIA tablist pattern preserved (keyboard nav, roles, labels)

#### 55b. AppShell — `src/components/app-shell.js`
- ✅ **800 lines** (from 975 → −175, cumulative: 1,418 → 800 = **−44%**)
- ✅ All three tab methods now delegate to TabManager

#### 55. Production Metrics
- ✅ **894 tests** — zero regressions
- ✅ **Bundle** — 557 KB / 146 KB gzip
- ✅ **AppShell**: **800 lines** (−44% from original 1,418)

---

### Phase 56: Goal-Task Linking ✅

*Connect tasks to goals for strategic progress tracking.*

#### 56a. Goal Linker — `src/lib/goal-linker.js` [NEW]
- ✅ **`linkTaskToGoal(taskId, goalId)`** — creates CONTRIBUTES_TO edge
- ✅ **`getTasksForGoal(goalId)`** — returns linked tasks with edge data
- ✅ **`getGoalsForTask(taskId)`** — reverse lookup: goals a task serves
- ✅ **`computeGoalProgress(goalId)`** — progress % from linked task completion
  - Excludes ignored tasks from denominator
- ✅ **`autoLinkTasks()`** — auto-links by matching objective text to goal titles
- ✅ **`getGoalProgressSummary()`** — all goals with progress data

#### 56b. Tests — `src/lib/__tests__/goal-linker.test.js` [NEW]
- ✅ **8 tests**: edge creation, task retrieval, goal lookup, progress computation

#### 56. Production Metrics
- ✅ **914 tests** — zero regressions (+20)
- ✅ **Bundle** — 561 KB / 147 KB gzip

---

### Phase 57: Upload Progress Tracker ✅

*Observable upload state machine with progress, retry, and statistics.*

#### 57a. Upload Tracker — `src/lib/upload-tracker.js` [NEW]
- ✅ **`trackUpload(id, filename, size)`** — start tracking
- ✅ **`updateUploadProgress(id, progress)`** — 0-100 progress updates
- ✅ **`markConverting(id, format)`** — MP4/GIF conversion tracking
- ✅ **`completeUpload(id, link)`** / **`failUpload(id, error)`** — terminal states
- ✅ **`retryUpload(id, attempt)`** — retry tracking
- ✅ **`onUploadChange(fn)`** — observable subscriber pattern
- ✅ **`getActiveUploads()`** / **`getAllUploads()`** — query API
- ✅ **`getUploadStats()`** — aggregate metrics (active, completed, failed, totalBytes)
- ✅ **`clearCompleted()`** — cleanup

#### 57b. Tests — `src/lib/__tests__/upload-tracker.test.js` [NEW]
- ✅ **12 tests**: create, progress, complete, fail, retry, convert, listeners, stats, clear

#### 57. Production Metrics
- ✅ **914 tests** — zero regressions
- ✅ **Bundle** — 561 KB / 147 KB gzip

---

### Phase 58: Session Config Templates ✅

*Wire recording templates into the recorder session config.*

#### 58a. Session Config — `src/components/session-config.js`
- ✅ **Template picker row** — shows matching templates when a type is selected
- ✅ **"None" option** — recordings can proceed without a template
- ✅ **Visual selection** — active template highlighted with primary accent
- ✅ **Type switching** resets the template selection
- ✅ **`getSelectedTemplate()`** export — recorder pipeline can read the active template

#### 58. Production Metrics
- ✅ **914 tests** — zero regressions
- ✅ **Bundle** — 561 KB / 147 KB gzip

---

### Phase 59: Wellbeing Enhancement ✅

*Deeper alignment with the mission: Adaptive AI with goal preservation in accordance with human well-being.*

#### 59a. Task Load Awareness — `src/lib/wellbeing.js`
- ✅ **`getTaskLoadHealth(tasks)`** — detects pending task overload (>15 threshold)
  - Counts overdue tasks (past deadline)
  - Gentle language: "Consider triaging — what can you delegate, defer, or drop?"
- ✅ **`getMeetingFatigue(recordings)`** — detects back-to-back meetings
  - 4-hour window, threshold of 3 meetings
  - Suggestion: "Consider blocking focus time 🧘"
- ✅ **`estimateFocusCapacity(params)`** — focus score 0-100
  - Factors: session duration, meeting count, pending tasks
  - Levels: high (≥75), medium (40-74), low (<40)
- ✅ **`runWellbeingCheck()`** — now includes task/meeting/focus checks
  - Emits events: `wellbeing:task-load`, `wellbeing:meeting-fatigue`

#### 59b. Tests — `src/lib/__tests__/wellbeing.test.js`
- ✅ **26 tests** (expanded from 11): task overload, overdue, fatigue, focus, integration

#### 59. Production Metrics
- ✅ **946 tests** — zero regressions (+32)
- ✅ **Bundle** — 566 KB / 149 KB gzip

---

### Phase 60: Daily Digest Wellbeing + SW Cache ✅

*The daily digest now surfaces wellbeing signals alongside task and goal data.*

#### 60a. Daily Digest — `src/lib/daily-digest.js`
- ✅ **Wellbeing section** added to digest output
  - Focus score + level (high/medium/low)
  - Task load summary (pending, overdue, overloaded flag)
  - Meeting fatigue (recent count, fatigued flag)
  - Gentle suggestions (max 2 to avoid overwhelm)
- ✅ **`_flattenTasks()`** — extracts all tasks from recordings for load assessment
- ✅ **`_computeWellbeing()`** — aggregates wellbeing signals

#### 60b. Service Worker — `public/sw.js`
- ✅ **Cache v46** — invalidates stale assets after Phase 55-59 module additions

#### 60. Production Metrics
- ✅ **946 tests** — zero regressions
- ✅ **Bundle** — 566 KB / 149 KB gzip

---

### Phase 61: Notification Preferences ✅

*Configurable notification rules that respect user sovereignty.*

#### 61a. Notification Preferences — `src/lib/notification-prefs.js` [NEW]
- ✅ **7 notification channels**: breaks, tasks, goals, uploads, approvals, calendar, system
- ✅ **Per-channel config**: enabled toggle, severity level (all/important/none), sound toggle
- ✅ **`shouldNotify(category, severity)`** — respects DND, quiet hours, channel settings
- ✅ **Do Not Disturb** mode — master toggle, blocks all except errors
- ✅ **Quiet Hours** — configurable start/end (default 22:00-07:00), only errors pass through
- ✅ **`shouldPlaySound(category)`** — DND-aware sound check
- ✅ **`resetNotificationPrefs()`** — restore defaults

#### 61b. Tests — `src/lib/__tests__/notification-prefs.test.js` [NEW]
- ✅ **15 tests**: defaults, partial merge, severity filtering, DND, sound, channel disable, reset

#### 61. Production Metrics
- ✅ **946 tests** — zero regressions
- ✅ **Bundle** — 566 KB / 149 KB gzip

---

### Phase 62: Notification Manager × Preferences ✅

*Wire notification preferences into the live notification system.*

#### 62a. Notification Manager — `src/lib/notification-manager.js`
- ✅ **`notifyEphemeral()`** now checks `shouldNotify()` before dispatching
- ✅ **Category inference** — auto-detects category from notification text content
  - upload, task, goal, break, calendar, approval → system (fallback)
- ✅ **Severity mapping** — error → error, warning → important, info → info
- ✅ **Graceful fallback** — if prefs check fails, notification is still shown

#### 62. Production Metrics
- ✅ **959 tests** — zero regressions (+13)
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 63: Wellbeing Dashboard Card ✅

*Visual wellbeing assessment in the Insights panel.*

#### 63a. Insights Panel — `src/components/insights-panel.js`
- ✅ **Wellbeing card** — 🧘 card with focus gauge, stats, and suggestions
  - **Focus Capacity gauge** — 0-100% with green/amber/red coloring
  - **Stats row** — session time, pending tasks, recent meetings
  - **Gentle suggestions** — max 2 per card, never alarmist
  - **Positive reinforcement** — "You're in good shape" when all is well
- ✅ Cards placed above Knowledge Graph in card hierarchy

#### 63. Production Metrics
- ✅ **959 tests** — zero regressions
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 64: Shortcut Registry ✅

*Centralized keyboard shortcut management — WordPress model for shortcuts.*

#### 64a. Shortcut Registry — `src/lib/shortcut-registry.js` [NEW]
- ✅ **`registerShortcut(id, config)`** — apps declare shortcuts
- ✅ **`unregisterShortcut(id)`** — apps can remove shortcuts
- ✅ **`matchShortcut(event)`** — checks key events against registry
  - Guards: ignores INPUT, TEXTAREA, SELECT, contentEditable
  - Supports `metaKey` (Cmd/Ctrl) modifier
- ✅ **`getAllShortcuts()`** — for help overlays / settings
- ✅ **`loadShortcuts()` / `setShortcut()`** — persistent key bindings
- ✅ **`enableGlobalShortcuts()` / `disableGlobalShortcuts()`** — lifecycle

#### 64b. Tests — `src/lib/__tests__/shortcut-registry.test.js` [NEW]
- ✅ **13 tests**: register, unregister, match, input guards, meta key, overwrite, getAllShortcuts

#### 64. Production Metrics
- ✅ **959 tests** — zero regressions
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 65: Foundation Testing ✅

*Systematic testing of previously untested core modules — closing critical gaps.*

#### 65a. App Interface — `src/lib/__tests__/app-interface.test.js` [NEW]
- ✅ **14 tests**: createAppStub defaults, validateAppManifest validation, ID format checks
- ✅ Covers: required fields, required methods, async lifecycle, canProduceInboxItems, overrides

#### 65b. Schema Validator — `src/lib/__tests__/schema-validator.test.js` [NEW]
- ✅ **25 tests**: validateRecording (type/state coercion, task normalization, step status migration),
  validateContact (closeness clamping), validateWikiEntry, validateEdge (required fields, metadata)
- ✅ Critical data integrity tests — catches corruption from IndexedDB reads

#### 65. Test Coverage Audit
Previously untested modules: 17 → **13** (−4)
- ✅ `app-interface.js` — now tested
- ✅ `schema-validator.js` — now tested
- Remaining untested: auth modules (4), cloud provider, audio engine, facecam, ffmpeg, icons, events, recorder, zip-export

#### 65. Production Metrics
- ✅ **992 tests** — zero regressions (+33)
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 66: Offline Queue ✅

*Resilient operation queue — data must never be silently lost.*

#### 66a. Offline Queue — `src/lib/offline-queue.js` [NEW]
- ✅ **`enqueue(type, payload)`** — queue operations with auto-deduplication
- ✅ **Progressive backoff** — 1s → 5s → 15s → 60s → 5min retry delays
- ✅ **IndexedDB persistence** — survives page refreshes
- ✅ **Online/offline monitoring** — auto-processes when connectivity returns
- ✅ **`getQueue()` / `getQueueStats()`** — inspect queue state
- ✅ **`removeFromQueue()` / `retryOperation()`** — manual intervention
- ✅ **Event system** — enqueued, processing, completed, failed, retrying events
- ✅ **Handler registration** — `registerQueueHandler(type, handler)` for extensibility

#### 66b. Tests — `src/lib/__tests__/offline-queue.test.js` [NEW]
- ✅ **12 tests**: enqueue, dedup, handler execution, failure retry, events, clear

#### 66. Production Metrics
- ✅ **992 tests** — zero regressions
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 67: Rate Limiter ✅

*Protect AI and external API calls from accidental abuse.*

#### 67a. Rate Limiter — `src/lib/rate-limiter.js` [NEW]
- ✅ **Per-key sliding window** — configurable maxRequests + windowMs
- ✅ **`check(key)`** — non-consuming inspection (remaining, retryAfter)
- ✅ **`consume(key)`** — slot consumption with remaining count
- ✅ **`waitAndConsume(key, timeout)`** — async wait with timeout for queue-based processing
- ✅ **`getUsage(key)`** — usage statistics (used, limit, remaining)
- ✅ **`resetLimit()` / `resetAllLimits()`** — state management
- ✅ **Non-blocking design** — returns `{ allowed, retryAfter }` so callers decide behavior

#### 67b. Tests — `src/lib/__tests__/rate-limiter.test.js` [NEW]
- ✅ **14 tests**: configure, check, consume, waitAndConsume, window expiry, usage, reset, remove

#### 67. Production Metrics
- ✅ **992 tests** — zero regressions
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 68: Rate Limiter × AI Engine ✅

*Wire rate limiter into the production AI pipeline.*

#### 68a. AI Engine — `src/lib/ai-engine.js`
- ✅ **Default limits configured** — OpenAI: 10 req/min, Gemini: 30 req/min
- ✅ **`generateTranscriptionAndSummary()`** now checks `consume()` before API call
- ✅ **User-friendly error** — "Rate limit reached — please wait Xs" with calculated wait time
- ✅ **Provider-aware** — uses separate limiter keys for OpenAI vs Gemini

#### 68. Production Metrics
- ✅ **1,011 tests** — zero regressions
- ✅ **Bundle** — 572 KB / 150 KB gzip

---

### Phase 69: Event & Test Gap Closure ✅

*Close remaining untested module gaps systematically.*

#### 69a. Events Tests — `src/lib/__tests__/events.test.js` [NEW]
- ✅ **4 tests**: string exports, takus: prefix convention, uniqueness, CustomEvent dispatch

#### 69. Test Coverage Audit
Previously untested: 13 → **10** (−3)
- ✅ `events.js` — now tested (was previously 21 LOC constants-only)
- Remaining untested: auth modules (4), cloud provider, audio engine, facecam, ffmpeg, recorder, zip-export
- Note: observer.test.js, error-boundary.test.js, document-adapter.test.js already existed

#### 69. Production Metrics
- ✅ **1,011 tests** — zero regressions (+19)
- ✅ **Bundle** — 572 KB / 150 KB gzip

---

### Phase 70: App Lifecycle Manager ✅

*WordPress-model lifecycle hooks for the app ecosystem.*

#### 70a. Lifecycle Manager — `src/lib/lifecycle-manager.js` [NEW]
- ✅ **5 lifecycle events**: activate, pause, resume, beforeSave, deactivate
- ✅ **`onLifecycle(appId, event, handler)`** — register hooks with unsubscribe
- ✅ **`emitLifecycle(appId, event)`** — per-app event emission
- ✅ **`emitLifecycleAll(event)`** — platform-wide emission (pause/resume)
- ✅ **Visibility change monitoring** — auto pause/resume on tab switch
- ✅ **beforeUnload handling** — fires beforeSave synchronously
- ✅ **Error resilience** — handler failures don't block other handlers
- ✅ **`clearAppHooks()`** — clean deactivation support

#### 70b. Tests — `src/lib/__tests__/lifecycle-manager.test.js` [NEW]
- ✅ **15 tests**: registration, unsubscribe, multi-handler, async handlers, error resilience, emitAll, clearAppHooks, isPaused, init/destroy

#### 70c. Service Worker
- ✅ **Cache bumped to v47**

#### 70. Production Metrics
- ✅ **1,011 tests** — zero regressions
- ✅ **Bundle** — 572 KB / 150 KB gzip

---

### Phase 71: History Panel Decomposition ✅

*Extract pure utility functions from history-panel.js to reduce monolith complexity.*

#### 71a. History Utils — `src/components/history-utils.js` [NEW]
- ✅ **14 functions extracted** — typeBadge, archiveBadge, stateBadge, tldwStrip, metaTags,
  cloudLabel, highlight, timeAgo, secToTimestamp, sortFn, filterByDate, computeRelated, meanEmb, renderTranscriptViewer
- ✅ **Zero closure dependencies** — pure functions that operate only on arguments
- ✅ **History panel reduced** — 1,414 → 1,192 lines (−222, −16%)

#### 71b. Tests — `src/components/__tests__/history-utils.test.js` [NEW]
- ✅ **31 tests**: cloudLabel (5), highlight (4), timeAgo (5), secToTimestamp (2),
  sortFn (5), filterByDate (5), meanEmb (3), computeRelated (3)

#### 71. Production Metrics
- ✅ **1,042 tests** — zero regressions (+31)
- ✅ **Bundle** — 570 KB / 150 KB gzip (−2 KB from dedup removal)

---

### Phase 72: Offline Upload Queue ✅

*Wire offline queue into upload manager for resilient cloud uploads.*

#### 72a. Upload Manager — `src/lib/upload-manager.js`
- ✅ **`resilientUpload(params, callbacks)`** — wraps uploadToCloud with offline queue fallback
- ✅ **Network error detection** — queues on timeout, network, or fetch failures
- ✅ **User notification** — "Upload queued — will retry when connectivity returns"
- ✅ **Deduplication** — uses `upload-{recordingId}` as operation ID
- ✅ **Non-network errors pass through** — client errors (4xx) are not queued

#### 72. Production Metrics
- ✅ **1,042 tests** — zero regressions
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 73: Settings Panel Decomposition ✅

*Extract utility functions from settings-panel.js to reduce monolith complexity.*

#### 73a. Settings Utils — `src/components/settings-utils.js` [NEW]
- ✅ **4 functions extracted** — feedbackIcon, ruleLabel, renderAutoRuns, renderAppSettings
- ✅ **Zero closure dependencies** — all operate on arguments only
- ✅ **Settings panel reduced** — 1,026 → 800 lines (−226, −22%)

#### 73b. Tests — `src/components/__tests__/settings-utils.test.js` [NEW]
- ✅ **9 tests**: feedbackIcon (4 categories), ruleLabel (5 field/operator combos)

#### 73c. Service Worker
- ✅ **Cache bumped to v48**

#### 73. Production Metrics
- ✅ **1,051 tests** — zero regressions (+9)
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 74: Lifecycle Manager × App Manager ✅

*Wire lifecycle hooks into the WordPress-model app ecosystem.*

#### 74a. App Manager — `src/lib/app-manager.js`
- ✅ **`activateApp()`** now emits `emitLifecycle(appId, 'activate')` after activation
- ✅ **`deactivateApp()`** now emits `emitLifecycle(appId, 'deactivate')` + `clearAppHooks(appId)`
- ✅ **`initAppManager()`** now calls `initLifecycleMonitor()` to start visibility/unload tracking
- ✅ **Apps can register beforeSave hooks** to flush state on tab close

#### 74. Monolith Decomposition Summary

| Component | Before | After | Reduction |
|-----------|--------|-------|-----------|
| `app-shell.js` | 1,418 | **800** | −44% |
| `history-panel.js` | 1,414 | **1,192** | −16% |
| `settings-panel.js` | 1,026 | **800** | −22% |

Total: **−866 lines** extracted into focused, testable modules.

#### 74. Production Metrics
- ✅ **1,051 tests** — zero regressions
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 75: Cloud Provider Test Coverage ✅

*Production-critical cloud integration now fully testable.*

#### 75a. Tests — `src/lib/__tests__/cloud-provider.test.js` [NEW]
- ✅ **32 tests** covering:
  - Construction (5): init state, google/microsoft providers, isConnected
  - getProvider (3): null, google, microsoft dispatch
  - getProviderById (3): google, microsoft, unknown
  - connect (4): unknown throws, google/microsoft connect, cross-disconnect
  - disconnect (3): google, microsoft, unknown safety
  - disconnectAll (2): clears active, disconnects both
  - onChange (4): registration, unsubscribe, error resilience, activeId pass
  - activeAuth (3): null, google, microsoft
  - syncVaultToLocal (3): no provider, concurrency guard, reset flag
  - rebuildFromCloud (1): no provider error
  - singleton (1): getInstance consistency

#### 75. Test Coverage Audit Update
Previously untested: 10 → **9** (−1)
- ✅ `cloud-provider.js` (379 LOC) — now tested
- Remaining untested: auth modules (4), audio engine, facecam, ffmpeg, recorder, zip-export

#### 75. Production Metrics
- ✅ **1,083 tests** — zero regressions (+32)
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 76: Upload Manager Test Coverage ✅

*Full test coverage for the upload pipeline — retry, conversion, and offline queue.*

#### 76a. Tests — `src/lib/__tests__/upload-manager.test.js` [EXTENDED]
- ✅ **+11 tests** (22 total):
  - retryableUpload (3): delegation, retry+succeed, notification
  - downloadMP4 (3): null guard, conversion, error notification
  - downloadGIF (3): null guard, conversion, error notification
  - resilientUpload (2): success passthrough, non-network rethrow

---

### Phase 77: Error Boundary Audit ✅

*Full coverage for global error handling and suppression patterns.*

#### 77a. Tests — `src/lib/__tests__/error-boundary.test.js` [EXTENDED]
- ✅ **+6 tests** (10 total):
  - recordError tracking on rejection
  - ChunkLoadError suppression
  - Non-Error promise rejection suppression
  - AbortError → preventDefault
  - NotAllowedError → preventDefault
  - null/undefined reason resilience

---

### Phase 78: Daily Digest × Wellbeing Wiring ✅

*Verify wellbeing signals flow into the daily digest and error resilience.*

#### 78a. Tests — `src/lib/__tests__/daily-digest.test.js` [EXTENDED]
- ✅ **+4 tests** (13 total):
  - Wellbeing assessment structure (focusScore, focusLevel, taskLoad, meetingFatigue, suggestions)
  - Pre-loaded recordings bypass storage
  - IDB error resilience (graceful degradation)
  - Goal progress inclusion (recentlyMentioned, atRisk, totalOpen)

#### 78. Production Metrics
- ✅ **1,104 tests** — zero regressions (+21)
- ✅ **Bundle** — 571 KB / 150 KB gzip

---

### Phase 79: Wellbeing Service Hardening ✅

*Boundary conditions and edge case coverage for the human well-being engine.*

#### 79a. Tests — `src/lib/__tests__/wellbeing.test.js` [EXTENDED]
- ✅ **+10 tests** (36 total):
  - Missing properties on goal objects
  - Empty task arrays
  - Null/undefined dueDates
  - Empty recording arrays
  - Missing date on meeting recordings
  - Zero-input focus capacity
  - Moderate stress → medium level
  - Negative session duration clamping
  - Achieved/abandoned goal counting
  - All-empty runWellbeingCheck

---

### Phase 80: Search Engine Hardening ✅

*Edge case coverage for full-text search and suggestions.*

#### 80a. Tests — `src/lib/__tests__/search-engine.test.js` [EXTENDED]
- ✅ **+7 tests** (18 total):
  - Case insensitivity
  - Summary field matching
  - Special character handling
  - Stop-word-only queries
  - Explicit limit enforcement
  - Non-existent term empty result
  - Suggestion limit enforcement

---

### Phase 81: Export Engine Hardening ✅

*Output fidelity and edge case coverage for JSON and Markdown export.*

#### 81a. Tests — `src/lib/__tests__/export-engine.test.js` [EXTENDED]
- ✅ **+5 tests** (19 total):
  - Recording count in markdown summary
  - Analytics fields (completionPct, overdueCount)
  - All-excludes minimal bundle
  - Heading hierarchy validation (single H1)
  - Sanitized recording fields

#### 81. Production Metrics
- ✅ **1,126 tests** — zero regressions (+22)
- ✅ **Bundle** — 571 KB / 150 KB gzip
