# 🧠 Takus — Knowledge OS

**Autonomous Adaptive AI Knowledge OS with goal preservation in accordance with human well-being.**

Takus is a free, privacy-first Knowledge OS that captures meetings, screens, and documents, processes them with AI, and builds a knowledge graph connecting goals, tasks, people, and decisions. An autonomy engine runs in the background — embedding content, computing similarities, monitoring goal health, and providing gentle intelligence. No accounts, no subscriptions, no meeting bots.

🌐 **[Try it live →](https://takus.netlify.app)**

![Status](https://img.shields.io/badge/Status-Pre--Release%20v0.17.0-blue)
![Browser](https://img.shields.io/badge/Browser-Chrome%20%7C%20Firefox%20%7C%20Edge-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Cost](https://img.shields.io/badge/Cost-%240%2Fyear-success)


## Why Takus?

| Tool | Cost | The Catch |
|------|------|-----------|
| Google Workspace (for recording) | $14/user/month | Only org admin can record |
| Loom Business | $15–18/user/month | 5-min limit on free tier |
| tl;dv / Otter.ai | $16–25/user/month | Bot joins your call |
| OBS Studio | Free | Desktop app, steep learning curve |
| **Takus** | **Free** | **None. Open source.** |

A 20-person team saves **$1,680/year** by using Takus instead of upgrading Google Workspace.

## ✨ Features

### 🧠 Knowledge Capture
- **Screen + Audio Recording** — capture any screen, window, or tab with system audio and microphone
- **Loom-Style Facecam** — floating Picture-in-Picture webcam overlay
- **Document Ingestion** — import .txt, .md, .json files with AI summarization
- **Data Import/Restore** — restore from JSON or ZIP backups with deduplication
- **Recording Templates** — one-click presets (Standup, 1-on-1, Bug Bash, Demo, Sprint Review)
- **Multi-Cloud Upload** — auto-upload to Google Drive or Microsoft OneDrive

### 🤖 AI Intelligence
- **BYOK AI** — transcribe and summarize via OpenAI or Google Gemini (bring your own key)
- **Auto Meeting Notes** — creates Google Docs or OneNote pages with summaries
- **AI Task Extraction** — auto-extract action items, tickets, and decisions
- **Ask (RAG)** — semantic search across all content with source attribution
- **Knowledge Classification** — automatic fact/decision/assumption/open-question classification
- **Adaptive Prompts** — AI learns your summary style and task preferences over time

### 🧬 Knowledge Graph
- **13 Edge Types** — SIMILAR_TO, PARTICIPATED_IN, DERIVED_FROM, CONTRIBUTES_TO, and more
- **Related Entries** — automatic discovery via shared participants, cosine similarity, and graph edges
- **Knowledge Levels (L0–L4)** — content classification based on ownership and engagement
- **People & Closeness Scoring** — contact relationships with weighted interaction signals

### ⚡ Autonomy Engine
- **Auto-Embed** — background transcription embedding without user action
- **Auto-Similarity** — cosine similarity edge creation between entries
- **Auto-Goal Health** — flag stagnating goals as "at-risk"
- **Auto-Task Linking** — keyword matching to connect tasks to goals
- **Storage Quota Monitoring** — proactive warning at 80% usage

### 🎯 Goal Preservation
- **Goal Tracking** — aspiration → active → at-risk → achieved state machine
- **AI Goal Detection** — automatic goal extraction from any content type
- **Task-Goal Linking** — CONTRIBUTES_TO edges with progress computation
- **Task Priority Scoring** — deadline urgency, requester closeness, task age, and routing

### 💚 Wellbeing
- **Break Suggestions** — gentle nudges after 2+ hour sessions
- **Goal Overload Detection** — warning when >7 active goals
- **Task Load Monitoring** — overload and overdue alerts
- **Meeting Fatigue** — detection of >3 meetings in 4-hour windows
- **Blind Spot Detection** — ignored categories, single source, stale contacts, recency bias

### 👥 Collaboration
- **Workspaces** — shared AI configuration for teams with admin/member roles
- **Share & Export** — shareable summary links with QR codes
- **Meeting Prep** — proactive context cards with attendee closeness and open tasks
- **Daily Digest** — streak, overdue tasks, upcoming meetings, and weekly stats
- **Connect** — route tasks to Slack, GitHub Issues, Jira, Notion, and Linear

### 🛡️ Infrastructure
- **Identity Vault** — AES-GCM 256-bit encrypted credential storage
- **Command Bar** — Spotlight-style overlay (⌘K) for unified search
- **Progressive Disclosure** — simplified UI for new users, expanding as they add content
- **PWA** — installable with offline support and service worker caching
- **Web Vitals** — Core Web Vitals monitoring (LCP, FID, INP, CLS, FCP, TTFB)
- **Global Error Boundary** — crash resilience with user-friendly messaging
- **$0/year to operate** — no servers, no API costs, hosted free on Netlify


## 🚀 Quick Start

### 1. Configure Cloud Provider(s)

#### Google (Drive + Calendar + Docs)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable **Google Drive API**, **Google Calendar API**, and **Google Docs API**
3. Create OAuth 2.0 credentials (Web application)
4. Add your domain to "Authorized JavaScript origins"
5. Copy your Client ID

#### Microsoft (OneDrive + Outlook Calendar + OneNote)

1. Go to [Microsoft Entra admin center](https://entra.microsoft.com/)
2. Register a new app → Platform: **Single-page application (SPA)**
3. Set Redirect URI to your domain
4. Add delegated permissions: `User.Read`, `Files.ReadWrite`, `Calendars.ReadWrite`, `Notes.Create`, `Notes.ReadWrite`
5. Copy your Application (client) ID

### 2. Set Your Client IDs

Edit `public/config.js` and add your credentials:

```javascript
window.__TAKUS_CONFIG__ = {
  google: {
    clientId: 'your-google-id.apps.googleusercontent.com',
  },
  microsoft: {
    clientId: 'your-microsoft-app-id',
  },
};
```

### 3. Run

```bash
npm install
npm test           # 1,791 tests across 107 files
npm run dev        # Dev server on localhost:5173
npm run build      # Production build to dist/
```

### 4. Deploy

Deploy the `dist/` folder to Netlify, Vercel, GitHub Pages, or any static host.

## 📁 Architecture

```
src/
├── main.js                     # App bootstrap
├── styles/
│   ├── index.css               # Design system (dark theme tokens)
│   ├── components.css          # Component styles
│   └── animations.css          # Keyframes & transitions
├── lib/
│   ├── state-machine.js        # 10-state recording FSM
│   ├── recorder.js             # MediaRecorder wrapper
│   ├── facecam.js              # Picture-in-Picture webcam manager
│   ├── ai-engine.js            # OpenAI Whisper + GPT / Gemini integration
│   ├── ffmpeg-engine.js        # WebAssembly WebM -> MP4/GIF conversion
│   ├── audio-engine.js         # Audio mixing + 32-bar visualizer analyzer
│   ├── archive-engine.js       # Intelligent archival (eligibility, classification, key frames)
│   ├── cloud-provider.js       # Multi-provider abstraction + vault sync
│   ├── google-auth.js          # Google OAuth with token lifecycle
│   ├── google-drive.js         # Google Drive VAULT uploads
│   ├── google-calendar.js      # Google Calendar smart event matching
│   ├── google-docs.js          # Google Docs meeting notes
│   ├── microsoft-auth.js       # MSAL.js Auth Code Flow + PKCE
│   ├── microsoft-onedrive.js   # OneDrive VAULT uploads
│   ├── microsoft-calendar.js   # Outlook Calendar event matching
│   ├── microsoft-onenote.js    # OneNote meeting notes
│   ├── observer.js             # Session telemetry (console, network, actions)
│   ├── embeddings.js           # Transcript chunking & semantic search
│   ├── analytics.js            # Filler-word analysis, quality scoring, urgency detection
│   ├── identity-vault.js       # AES-GCM encrypted credential storage
│   ├── storage.js              # IndexedDB persistence (14 stores, v8)
│   ├── schema-validator.js     # Runtime record validation + auto-repair
│   ├── feedback-engine.js      # Device diagnostics, PII sanitization, feedback payloads
│   ├── step-executor.js        # Registry-based autonomous step execution engine
│   ├── closeness-score.js      # Weighted interaction-based contact scoring
│   ├── closeness-worker.js     # Background 24h closeness recomputation
│   ├── knowledge-level.js      # L0–L4 content classification
│   ├── meeting-prep.js         # Calendar × contacts × recordings cross-reference
│   ├── daily-digest.js         # Streak, overdue tasks, weekly stats aggregation
│   ├── task-priority.js        # Deterministic priority scoring engine
│   ├── zip-export.js           # Browser-native ZIP builder (lazy-loaded)
│   ├── qr-code.js              # QR code SVG generator (lazy-loaded)
│   ├── config.js               # Runtime configuration
│   ├── utils.js                # Centralized utilities (esc, renderMarkdown, parseVTT)
│   ├── icons.js                # Inline SVG icons (Lucide-style)
│   ├── knowledge-framework.js  # Fact/decision/assumption classification
│   ├── auto-read-rules.js      # Auto-Read rules engine (inbox automation)
│   ├── document-adapter.js     # Document ingestion (text/md/json → knowledge graph)
│   ├── recording-pipeline.js   # Recording capture → AI processing pipeline
│   ├── upload-manager.js       # Cloud upload orchestration
│   ├── library-io.js           # Library import/export
│   ├── drag-drop-handler.js    # File drag-and-drop handler
│   ├── error-boundary.js       # Global error handling
│   ├── keyboard-manager.js     # Configurable keyboard shortcuts
│   ├── autonomy-engine.js      # Background intelligence loop
│   ├── notification-manager.js # Three-tier notification system
│   ├── edge-types.js           # Knowledge graph edge type config
│   ├── events.js               # Custom DOM event constants
│   ├── task-helpers.js         # Canonical task/step status utilities
│   ├── preference-engine.js    # Behavioral signal aggregation for AI adaptation
│   ├── wellbeing.js            # Session health monitoring + break nudges
│   ├── blind-spot-detector.js  # Knowledge coverage gap analysis
│   ├── export-engine.js        # Versioned data export (JSON + Markdown)
│   ├── search-engine.js        # Full-text recording search
│   ├── offline-queue.js        # Resilient offline operation queue
│   ├── rate-limiter.js         # API rate limiting with backoff
│   ├── approval-center.js      # Step approval workflow
│   ├── inbox.js                # Inbox lifecycle management
│   ├── app-manager.js          # App registration + lifecycle orchestrator
│   ├── app-interface.js        # Base interface for pluggable apps
│   ├── goal-linker.js          # AI-powered goal ↔ task linking
│   ├── calendar-poller.js      # Background calendar event polling
│   ├── auto-record-engine.js   # Calendar-triggered auto-recording
│   ├── health-check.js         # System health diagnostics
│   ├── feature-flags.js        # Feature flag management (Labs)
│   ├── id.js                   # Unique ID generation
│   ├── settings-store.js       # Reactive settings persistence
│   └── integrations/
│       ├── slack.js            # Slack Incoming Webhook
│       ├── github.js           # GitHub Issues REST API
│       ├── linear.js           # Linear GraphQL API
│       ├── jira.js             # Jira Cloud REST API
│       └── notion.js           # Notion Database API
└── components/
    ├── app-shell.js            # State router & orchestrator
    ├── header.js               # Brand + multi-provider account hub
    ├── hero-section.js         # Browser compatibility check
    ├── session-config.js       # Pre-recording title, device, templates
    ├── type-picker.js          # Recording type selection modal
    ├── recorder-panel.js       # Record/pause/stop controls
    ├── preview-canvas.js       # Video preview + audio meter
    ├── review-panel.js         # Post-recording review (trim, GIF, approve)
    ├── settings-panel.js       # Quality, AI provider, shortcuts config
    ├── upload-progress.js      # Upload states (progress/complete/failed)
    ├── history-panel.js        # Recording history + search + filters + archive badges
    ├── tasks-panel.js          # AI-extracted tasks (Takus tasks / Me tasks)
    ├── ask-panel.js            # Video-RAG semantic Q&A + living wiki
    ├── insights-panel.js       # Activity heatmap, quality trends, knowledge graph stats
    ├── connect-panel.js        # Integration config (Slack, GitHub, Linear)
    ├── share-panel.js          # Email summary to participants
    ├── shared-view.js          # Public shareable summary viewer
    ├── global-tasks-panel.js   # Aggregate tasks with priority scoring + filters
    ├── contacts-panel.js       # People management + closeness scores
    ├── watch-modal.js          # Full-screen video player with synced transcript
    ├── archive-player.js       # Key-frame-based archive replay
    ├── auto-record-panel.js    # Calendar-driven auto-record rules
    ├── auto-record-notification.js # Auto-record start notification
    ├── feedback-modal.js       # Floating feedback FAB + submission dialog
    ├── consent-notice.js       # Legal recording notice + footer
    ├── command-bar.js          # Spotlight-style unified search (⌘K)
    ├── recording-detail.js     # Full recording detail + meeting prep
    ├── recording-controller.js # Recording state controller + upload
    ├── recovery-manager.js     # Crash recovery UI
    ├── setup-wizard.js         # First-run onboarding wizard
    ├── tab-manager.js          # Tab bar orchestration
    ├── quick-actions.js        # Quick action shortcuts
    ├── history-utils.js        # History panel extracted utilities
    ├── settings-utils.js       # Settings panel extracted utilities
    └── toast.js                # Notification system
├── apps/                       # Pluggable app modules (WordPress-model)
│   ├── registry.js             # App registry + built-in app definitions
│   ├── recorder/index.js       # Recording app
│   ├── inbox/index.js          # Inbox lifecycle app
│   ├── tasks/index.js          # Task management app
│   ├── goals/index.js          # Goal tracking + analytics app
│   ├── ask/index.js            # Video-RAG Q&A app
│   ├── insights/index.js       # Analytics dashboard app
│   ├── people/index.js         # Contact management app
│   ├── calendar/index.js       # Calendar integration app
│   ├── drive/index.js          # Cloud storage app
│   ├── integrations/index.js   # Integration routing app
│   └── passport/index.js       # Identity + credential management app
└── lib/graph/                  # Knowledge graph subsystem
    ├── task-store.js            # Unified task store (embedded + standalone)
    ├── node-registry.js         # Graph node CRUD + type registry
    └── vector-utils.js          # Embedding vector operations
```

## ⚙️ Configuration

All configuration is set via `window.__TAKUS_CONFIG__` in `public/config.js`:

```javascript
window.__TAKUS_CONFIG__ = {
  google: {
    clientId: 'your-id.apps.googleusercontent.com',
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/calendar',
      'openid', 'email', 'profile',
    ],
  },
  microsoft: {
    clientId: 'your-microsoft-app-id',
    authority: 'https://login.microsoftonline.com/common',
  },
  recording: {
    defaultVideoQuality: '720p',   // 480p, 720p, 1080p
    defaultAudioQuality: 'medium', // low, medium, high
  },
  drive: {
    folderName: 'Takus Recordings',
    makePublic: false,
    fileNamePattern: '{title} — {date} {time}',
  },
  calendar: {
    enabled: true,
  },
};
```

## 🔧 Technical Details

### Recording State Machine

```
IDLE → REQUESTING_ACCESS → PREVIEWING → RECORDING ⇄ PAUSED → PROCESSING → UPLOADING → COMPLETE
                                                                              ↓
                                                                        UPLOAD_FAILED → retry
```

### Multi-Cloud Upload Architecture

| Feature | Google | Microsoft |
|---------|--------|-----------|
| **Auth** | GIS `initTokenClient` | MSAL.js `PublicClientApplication` |
| **Storage** | Drive (resumable uploads) | OneDrive (Graph upload sessions) |
| **Chunk Size** | 5 MB | 1.6 MB (320 KiB aligned) |
| **Calendar** | Calendar API `events.list` | Graph `calendarView` |
| **Meeting Notes** | Google Docs (batch update) | OneNote (HTML page creation) |
| **Settings Sync** | Dual-write: `Takus/settings/` + legacy `appDataFolder` | Dual-write: `Takus/settings/` + legacy `approot` |
| **Vault Structure** | `Takus/recordings/YYYY-MM/{id}/` | `Takus/recordings/YYYY-MM/{id}/` |

Only one provider can be active at a time. Connecting one auto-disconnects the other.

### Audio Engine

- Mixes system audio + microphone via Web Audio API
- Independent gain control per source
- `AnalyserNode` for real-time level metering
- Handles Chrome AudioContext suspension policy

### Calendar Matching

Takus scores calendar events by:
- Time proximity to recording start (±2 hour window)
- Presence of video meeting link (Google Meet / Teams) (+30 pts)
- Keywords in event title ("meet", "call", "sync", etc.)
- Selects highest-scoring match

## 🛡️ Privacy & Security

- **Local processing** — all recording and encoding happens in your browser
- **Your cloud storage** — files go to your personal Drive or OneDrive, not our servers
- **Minimal permissions** — only the scopes needed for upload, calendar, and meeting notes
- **No telemetry** — zero tracking, analytics, or data collection
- **Private by default** — recordings are not shared unless you choose to
- **Open source** — audit every line of code

### Bundle Performance

| Chunk | Size | Gzip | Loading |
|-------|------|------|---------|
| UI shell | 65 KB | 17.8 KB | Always |
| Shared lib (icons, utils, events) | 34 KB | 10.4 KB | Always |
| Core (storage, graph, config) | 65 KB | 19.0 KB | Lazy |
| Settings | 57 KB | 14.3 KB | Lazy (on open) |
| Capture (recording pipeline) | 137 KB | 37.1 KB | Lazy (on record) |
| Tasks + Insights | 117 KB | 33.7 KB | Lazy (on tab) |
| History | 78 KB | 22.1 KB | Lazy (on tab) |
| AI (engine, embeddings, analytics) | 57 KB | 19.0 KB | Lazy |
| Home dashboard | 28 KB | 8.1 KB | Lazy (after shell) |
| Cloud (Google Drive, OneDrive) | 32 KB | 7.6 KB | Lazy |
| Integrations + Apps | 99 KB | 24.5 KB | Lazy (on tab) |
| Setup wizard | 30 KB | 7.0 KB | Lazy (first run) |
| CSS | 85 KB | 15.4 KB | Always |

- **1 runtime dependency** — `@netlify/blobs` for optional edge storage
- **27 strategic chunks** — manual code-splitting via Vite rollup (zero circular chunk warnings)
- **Service Worker** — offline-first with pre-cached assets + dedicated WASM cache
- **Web Worker** — vector math offloaded from main thread

## 🌐 Browser Support

| Browser | Recording | Audio | Cloud Upload |
|---------|-----------|-------|-------------|
| Chrome  | ✅ | ✅ | ✅ |
| Edge    | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ |
| Safari  | ⚠️ Limited | ⚠️ Limited | ✅ |

Screen recording requires HTTPS. GitHub Pages and most modern hosts provide this automatically.

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 🔮 Coming Soon

These features are implemented in the codebase but not yet active at runtime. They can be enabled via Settings → Labs:

- 📅 **Calendar-Driven Auto-Recording** — automatic recording triggered by calendar events with configurable rules and exclusion patterns
- 🔄 **Cloud Task Sync** — cross-device task persistence via `tasks.json` uploaded alongside recordings
- 🤖 **Auto-Read Rules** — configurable rules engine for automated inbox processing by type, source, title, or participant

---

**Built for teams who'd rather spend $0 than $14/user/month. Now with autonomous intelligence.**
