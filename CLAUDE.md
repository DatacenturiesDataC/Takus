# Takus 2.0 — Agent Context & Architecture Guide

## What is Takus?

Takus is an **Agentic Knowledge OS** — a browser-based screen recorder that captures video, audio, DOM snapshots, and console logs, then routes them through specialist AI agents to produce structured knowledge artifacts: bug reports, meeting notes, presentation chapters, and Slack recaps.

**Takus 1.0** (vanilla JS PWA, in `src/` and `public/`) is **production on `main`** and must not be broken.  
**Takus 2.0** (React/Vite, in `v2/`) is being built fresh alongside it. The v2 app will eventually replace the root `index.html` deployment once it reaches feature parity.

---

## Repository Layout

```
/                        ← Takus 1.0 (vanilla JS PWA, keep untouched)
  src/                   ← 1.0 source (components, lib, styles)
  public/                ← 1.0 static assets, SW, _headers
  index.html             ← 1.0 entry point

v2/                      ← Takus 2.0 (React/Vite — BUILD HERE)
  src/
    components/
      layout/            ← Shell, Sidebar, WorkspacePane, AgentConsole
      pillars/           ← Ask, Record, Tasks, Connect
      agents/            ← ScreenAgent, MeetingAgent, PresentationAgent, UpdatesAgent
      shared/            ← Button, Badge, Spinner, Toast, Modal, VideoPlayer
    store/               ← Zustand slices (ui, recording, tasks, integrations)
    lib/
      recorder/          ← MediaRecorder wrapper (ported from 1.0)
      ai/                ← Gemini client, Whisper client, PII masker
      storage/           ← IndexedDB (local-first), Netlify Blobs sync
      integrations/      ← GitHub, Jira, Slack, Notion API clients
    hooks/               ← useRecorder, useAgent, useVectorSearch, useIntegration
    pages/               ← (if routing needed later)
  netlify/
    functions/           ← Edge functions: process-recording, ask, integrations/*
  package.json
  vite.config.js
  tailwind.config.js
  netlify.toml
  index.html
```

---

## Tech Stack Decisions (DO NOT DEVIATE)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | React 18 + Vite | Fast HMR, broad ecosystem, easy to hire for |
| Styling | Tailwind CSS v3 | Utility-first, dark-mode built-in, consistent with design tokens |
| Icons | Lucide React | Consistent stroke-based icons, tree-shakeable |
| Animation | Framer Motion | Declarative, GPU-accelerated, great for panel transitions |
| State | Zustand | No boilerplate, composable slices, works with React DevTools |
| Backend | Netlify Functions (Node 20) | Zero server management, free tier, co-located with hosting |
| Blob storage | Netlify Blobs | Managed KV/blob store, no extra service to configure |
| AI — primary | Gemini 2.0 Flash via Netlify AI Gateway | Multimodal (video+audio+text), 1M context, cost-effective |
| AI — STT | OpenAI Whisper API | Best accuracy for transcription, timestamp granularity |
| Vector DB | Supabase (pgvector) | Managed Postgres + vector search, free tier, one service for auth too |
| Auth | Supabase Auth | Replaces manual OAuth flows from 1.0; handles Google + MS |
| PII masking | Transformers.js (WASM) | Browser-side inference, no server round-trip for sensitive data |
| Realtime | Supabase Realtime | Cross-tab sync for recording state and task updates |

**Why NOT WebGPU/WebLLM for PII masking:** Browser support is ~65% (Chrome only, no Firefox/Safari). Transformers.js runs on WASM with a CPU backend and works everywhere. Upgrade to WebGPU progressively once support reaches ~85%.

**Why NOT Pinecone:** Supabase pgvector covers the RAG use case without a second paid service. Migrate to Pinecone only if query latency exceeds 200ms at scale.

---

## Design System

### Colors (extend Tailwind in `tailwind.config.js`)
```js
takus: {
  bg:      '#06060f',
  surface: 'rgba(255,255,255,0.04)',
  border:  'rgba(255,255,255,0.08)',
  primary: '#7c3aed',
  'primary-light': '#a78bfa',
  success: '#10b981',
  danger:  '#f43f5e',
  warning: '#f59e0b',
  info:    '#06b6d4',
  recording: '#ef4444',
}
```

### Typography
- Font: Inter (Google Fonts)
- Scale: xs(12), sm(14), base(16), lg(18), xl(20), 2xl(24)
- Weights: normal(400), medium(500), semibold(600), bold(700)

### Spacing
Use Tailwind's default spacing scale. Design baseline is 4px (space-1).

### Glass panels
```css
bg-white/[0.03] border border-white/[0.05] backdrop-blur-xl rounded-2xl
```

### Shadows
```css
shadow: '0 8px 32px 0 rgba(0,0,0,0.3)'
shadow-lg: '0 16px 50px rgba(0,0,0,0.6)'
```

---

## The 4-Pillar Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Header: Logo · Recording badge · Account widget                  │
├────────────┬─────────────────────────────┬────────────────────────┤
│  Sidebar   │  Source Pane (70%)          │  Agent Console (30%)   │
│  (240px)   │                             │                        │
│            │  VideoPlayer                │  Tabs:                 │
│  [Ask]     │  ├── Seekbar with events    │  · Chat                │
│  [Record]  │  ├── Transcript overlay     │  · Auto-Docs           │
│  [Tasks]   │  └── Chapter markers        │  · Task Triage         │
│  [Connect] │                             │                        │
│            │  (Collapses to full-width   │  (Collapses to drawer  │
│            │   when no recording open)   │   on mobile)           │
└────────────┴─────────────────────────────┴────────────────────────┘
```

**Sidebar** is always visible on desktop (≥768px), slides in as a drawer on mobile.  
**Source + Agent Console** share a resizable 70/30 split (min 50% / max 85% for source).  
**Agent Console tabs** are: Chat, Auto-Docs, Task Triage.

---

## Zustand Store Schema

```ts
// ui slice
{
  activePillar: 'ask' | 'record' | 'tasks' | 'connect',
  agentConsoleTab: 'chat' | 'docs' | 'tasks',
  sidebarOpen: boolean,          // mobile
  sourcePanelWidth: number,      // 0.7 default, user-resizable
}

// recording slice
{
  state: 'idle' | 'requesting' | 'previewing' | 'recording' | 'paused'
       | 'reviewing' | 'processing' | 'uploading' | 'complete' | 'failed',
  type: 'meeting' | 'screen' | 'presentation' | 'update' | null,
  blob: Blob | null,
  duration: number,              // ms
  size: number,                  // bytes
  title: string,
  startTime: number | null,      // Date.now()
  artifacts: {
    transcript: string | null,
    vtt: string | null,
    summary: string | null,
    chapters: Chapter[] | null,  // [{title, startMs, endMs}]
    domSnapshots: DOMSnapshot[], // [{timestampMs, html, css}]
    consoleLog: LogEntry[],
    networkHar: HAREntry[],
  },
  uploadProgress: { loaded: number, total: number },
  driveLink: string | null,
}

// tasks slice
{
  agentTasks: AgentTask[],   // tasks Takus will act on (API calls)
  myTasks: MyTask[],         // commitments extracted from recordings
}

// integrations slice
{
  github: { connected: boolean, user: string | null, repos: string[] },
  jira:   { connected: boolean, domain: string | null },
  slack:  { connected: boolean, workspace: string | null },
  notion: { connected: boolean, workspace: string | null },
}
```

---

## Specialist Agent Specifications

### A. Screen Agent (The Debugger)
**Trigger:** Recording type = `screen`  
**Ingestion extras:** MutationObserver snapshots every 2s + console.error intercept + XHR/fetch error intercept  
**Processing (Netlify Function):**
1. Send video + console log + DOM snapshots to Gemini 2.0 Flash
2. Ask it to correlate visual mouse-click positions with console errors
3. Identify the exact DOM element (CSS selector + computed styles) at the error timestamp

**Output schema:**
```json
{
  "bugReports": [{
    "timestampMs": 42000,
    "element": "button#submit-order",
    "selector": "#checkout-form > button[type=submit]",
    "computedStyles": { "opacity": "0.4", "pointer-events": "none" },
    "errorMessage": "Cannot read property 'id' of undefined",
    "stackTrace": "...",
    "screenshotUrl": "blob://...",
    "reproSteps": ["Navigate to /checkout", "Fill form", "Click Submit"]
  }]
}
```

### B. Meeting Agent (The Scribe)
**Trigger:** Recording type = `meeting`  
**Ingestion extras:** Calendar event from Google/Outlook API (attendees, title, time)

**Processing pipeline:**
1. Whisper → full transcript with speaker segments
2. Diarization: group segments by speaker using embedding similarity (via Gemini)
3. Gemini: extract Decision Ledger (structured commitments table)
4. Gemini: draft follow-up email per attendee + calendar invite ICS

**Output schema:**
```json
{
  "speakers": [{"id": "A", "name": "Jane", "totalMs": 180000}],
  "transcript": [{"speakerId": "A", "startMs": 0, "endMs": 4200, "text": "..."}],
  "decisionLedger": [{
    "timestampMs": 91000,
    "speaker": "Jane",
    "commitment": "I'll send the revised quote by Friday",
    "clipStartMs": 88000,
    "clipEndMs": 96000,
    "assignee": "jane@example.com",
    "dueDate": "2026-05-15"
  }],
  "followUpEmail": "Hi team,\n\nThank you for joining...",
  "calendarInvite": "BEGIN:VCALENDAR\n..."
}
```

### C. Presentation Agent (The Producer)
**Trigger:** Recording type = `presentation`

**Processing pipeline:**
1. Whisper → transcript with word-level timestamps
2. OCR slide transitions: detect scene changes (pixel diff > 15%) → extract slide title via Gemini Vision
3. Filler word removal list: ["um", "uh", "like", "you know", "so", "basically"]
4. Generate chapter markers from slide transitions
5. Gaze correction: apply via CSS `filter:` + JS canvas transform (tilt head toward center)

**Output schema:**
```json
{
  "chapters": [{"title": "Q1 Revenue", "startMs": 0, "endMs": 120000, "slideImage": "..."}],
  "fillerWordCount": {"um": 12, "uh": 7},
  "fillerWordTimestamps": [{"word": "um", "startMs": 4200, "endMs": 4350}],
  "polishedVideoUrl": "...",
  "tableOfContents": "1. Introduction (0:00)\n2. Q1 Revenue (2:00)\n..."
}
```

### D. Updates Agent (The Synthesizer)
**Trigger:** Recording type = `update`  
**Ingestion extras:** Current browser tab URL (to extract Jira/GitHub ticket ID)

**Processing pipeline:**
1. Gemini: generate a 3-bullet TL;DW summary (max 150 words)
2. Extract ticket ID: regex `[A-Z]+-\d+` from URL or title (Jira) or `#\d+` (GitHub)
3. Draft Slack message with ticket link + summary
4. Generate 15s highlight clip: identify the highest-energy 15s using audio RMS analysis

**Output schema:**
```json
{
  "ticketId": "PROJ-1234",
  "ticketUrl": "https://company.atlassian.net/browse/PROJ-1234",
  "tldr": "Fixed the checkout button state bug. Root cause was...",
  "slackMessage": ":movie_camera: *Update: PROJ-1234* ...",
  "highlightClipBlob": null
}
```

---

## Netlify Functions API Contracts

### POST `/api/process-recording`
**Purpose:** Main AI processing pipeline  
**Called by:** App after recording approved and uploaded to Netlify Blobs

Request:
```json
{
  "blobKey": "recordings/rec_1234567890.webm",
  "type": "meeting",
  "title": "Q2 Planning",
  "durationMs": 3600000,
  "artifacts": {
    "domSnapshots": [...],
    "consoleLog": [...],
    "networkHar": [...]
  },
  "integrations": {
    "calendarEventId": "abc123"
  }
}
```

Response: streams NDJSON progress events, final event contains full artifact JSON.

### POST `/api/ask`
**Purpose:** RAG query over recording history  
**Called by:** Ask pillar chat input

Request:
```json
{ "query": "What did Jane commit to in last week's standup?", "limit": 5 }
```

Response:
```json
{
  "answer": "Jane committed to sending the revised quote by Friday...",
  "sources": [{"recordingId": "rec_123", "title": "Standup 2026-05-06", "timestampMs": 91000}]
}
```

### POST `/api/integrations/jira`
**Purpose:** Create/update Jira ticket from bug report  
Request: `{ "action": "create" | "comment", "ticketId": "...", "bugReport": {...} }`

### POST `/api/integrations/slack`
**Purpose:** Post update recap to Slack channel  
Request: `{ "channelId": "...", "message": "...", "clipUrl": "..." }`

---

## PII Masking Strategy

Run in the browser **before** any data leaves the device:

```js
// v2/src/lib/ai/pii-masker.js
import { pipeline } from '@xenova/transformers';

const PATTERNS = [
  { re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, label: '[EMAIL]' },
  { re: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, label: '[PHONE]' },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, label: '[SSN]' },
  { re: /\b(?:\d[ -]?){13,16}\b/g, label: '[CC]' },
];

// Named entity recognition for person names
let _ner = null;
async function getNER() {
  if (!_ner) _ner = await pipeline('token-classification', 'Xenova/bert-base-NER');
  return _ner;
}

export async function maskPII(text) {
  let masked = text;
  for (const { re, label } of PATTERNS) masked = masked.replace(re, label);
  // NER pass for person names (async, runs on WASM)
  try {
    const ner = await getNER();
    const entities = await ner(masked);
    for (const e of entities.filter(e => e.entity_group === 'PER')) {
      masked = masked.replace(e.word, '[PERSON]');
    }
  } catch { /* NER is best-effort; regex pass is guaranteed */ }
  return masked;
}
```

---

## Local-First Data Flow

```
Browser                           Netlify Edge            Supabase
──────────────────────────────    ─────────────────────   ─────────────────
1. Record → chunks in memory
2. Stop → assemble Blob
3. PII mask transcript (WASM)  →  4. Upload to Netlify Blobs
                                  5. process-recording fn
                                     · Gemini 2.0 Flash
                                     · Whisper STT
                                     · Build artifacts JSON
                                  6. Save artifacts        → 7. pgvector embed
                                  8. Stream results back ←
9. Display in Agent Console
10. Save to IndexedDB (offline)
```

---

## Phase Implementation Order

### Phase 1 — Shell & State (START HERE)
1. `v2/` Vite project scaffold (already done — see `v2/package.json`)
2. Global Zustand store with all slices (ui, recording, tasks, integrations)
3. App layout: Sidebar (240px) + WorkspacePane (resizable 70/30)
4. Sidebar navigation: 4 pillar icons + labels, active state
5. Record pillar: type selection cards (Meeting, Screen, Presentation, Update)
6. Empty state for Source pane + Agent Console tabs shell

### Phase 2 — Recording Engine
1. Port recorder from 1.0 (`src/lib/recorder.js`) → React hook `useRecorder`
2. Port facecam PiP from 1.0 (`src/lib/facecam.js`)
3. DOM snapshot collector (MutationObserver, throttled to 2s)
4. Console log interceptor (`console.error` + `console.warn` override)
5. Network HAR collector (PerformanceObserver on resource/navigation entries)
6. Preview canvas with audio waveform meter
7. 3-2-1 countdown overlay

### Phase 3 — Upload & Netlify Functions
1. Upload recording blob to Netlify Blobs after review approval
2. `process-recording` function: Gemini 2.0 Flash + Whisper integration
3. NDJSON progress streaming back to client
4. Store artifacts in Supabase + IndexedDB

### Phase 4 — Agent Outputs
1. Meeting Agent: transcript viewer, decision ledger table, email draft
2. Screen Agent: bug report card with DOM element highlight
3. Presentation Agent: chapter navigation on seekbar, filler word list
4. Updates Agent: Slack message preview, ticket linkage

### Phase 5 — Ask Pillar (RAG)
1. Embed transcripts via Supabase Edge Function (pgvector)
2. Similarity search in `ask` Netlify function
3. Chat UI with source citations linking to recording timestamps

### Phase 6 — Tasks & Connect
1. Task extraction from agent outputs (commitment phrases)
2. Context clip thumbnails for "Task for Me" items
3. GitHub OAuth + issue creation
4. Jira OAuth + ticket creation/comment
5. Slack OAuth + channel posting
6. Notion OAuth + page creation

---

## Code Conventions

- **No `any` in TypeScript** — use JSDoc types for now (project starts in JS, migrate to TS in Phase 3)
- **No inline styles** — Tailwind classes only; extract to CSS modules if truly dynamic
- **No `useEffect` for derived state** — compute from store selectors
- **Error boundaries** on every pillar component
- **No prop drilling past 2 levels** — use Zustand store or React context
- **All async operations** must show a loading state and handle errors visibly
- **All external URLs** validated with `new URL()` before use
- **All user-generated content** escaped before innerHTML (use DOMPurify or React's JSX auto-escaping)
- **Tests:** Vitest for unit, Playwright for E2E — add tests for every Netlify function

## Security Checklist (audit before each PR)
- [ ] PII masking runs before any data leaves the browser
- [ ] AI processing is async — UI never blocks on AI responses
- [ ] Every Task links back to a `recordingId` + `timestampMs`
- [ ] No API keys committed — use Netlify environment variables
- [ ] CSP header updated in `v2/netlify.toml` when adding new script/connect origins
- [ ] Supabase RLS enabled on all tables — users only see their own recordings
