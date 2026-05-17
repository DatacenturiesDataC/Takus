# 🎬 Takus

**Adaptive AI with goal preservation in accordance with human well-being.**

Takus is a free, privacy-first Knowledge OS that captures meetings, screens, and documents, processes them with AI, and builds a knowledge graph connecting goals, tasks, people, and decisions. An autonomy engine monitors goal health, well-being signals, and preference patterns to provide gentle, non-intrusive intelligence. No accounts, no subscriptions, no meeting bots.

🌐 **[Try it live →](https://takus.netlify.app)**

![Status](https://img.shields.io/badge/Status-Pre--Release%20v0.16.0-blue)
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

- 🎬 **Screen + Audio Recording** — capture any screen, window, or tab with system audio and microphone
- 🎥 **Loom-Style Facecam** — floating Picture-in-Picture webcam overlay recorded automatically
- ☁️ **Multi-Cloud Upload** — auto-upload to Google Drive or Microsoft OneDrive with resumable chunked uploads
- 🤖 **BYOK AI Assistant** — transcribe audio and generate actionable meeting summaries via OpenAI
- 📝 **Auto Meeting Notes** — creates Google Docs or OneNote pages with summaries and transcripts
- 💾 **Instant MP4 Export** — convert WebM to MP4 instantly on the client side using WebAssembly FFmpeg
- 📅 **Smart Calendar Linking** — auto-matches Google Calendar or Outlook events and attaches recording links
- 🎛️ **Quality Presets** — 480p / 720p / 1080p video, 64 / 96 / 128 kbps audio
- ⏯️ **Pause / Resume** — full control with accurate duration tracking
- 🔊 **Dynamic Audio Visualizer** — 32-bar waveform visualizer for real-time audio monitoring
- 📋 **Recording History** — IndexedDB-backed list of past recordings with cloud links and AI summaries
- ⌨️ **Keyboard Shortcuts** — R (record), Space (pause/resume), S (stop)
- 🔒 **Privacy First** — all processing happens locally in your browser, zero backend
- ⏱️ **60-Minute Safety Limit** — auto-stops to prevent runaway memory usage
- 🌐 **Offline Detection** — toast notifications when connectivity changes
- 🆓 **$0/year to operate** — no servers, no API costs, hosted free on Netlify
- ✅ **AI Task Extraction** — auto-extract action items, tickets, and decisions from recordings
- 🔍 **Ask (Video-RAG)** — semantic search across all recordings with timestamped answers
- 🔗 **Connect** — route tasks to Slack, GitHub Issues, and Linear with one click
- 📊 **Insights Dashboard** — activity heatmap, quality trends, filler word analysis, decision ledger
- 🔐 **Identity Vault** — AES-GCM 256-bit encrypted credential storage for integrations
- 🔄 **Crash Recovery** — IndexedDB snapshots every 10s with opt-in session resume
- 📤 **Share & Export** — shareable summary links, library export/import as JSON, full ZIP backup with videos
- 📱 **QR Code Sharing** — scannable QR codes for shareable summary links
- 🏷️ **Recording Templates** — one-click presets (Standup, 1-on-1, Bug Bash, Demo, Sprint Review)
- 📂 **Structured Cloud Vault** — recordings organized in `YYYY-MM/{id}/` folders with companion metadata, transcripts, and summaries
- 🗄️ **Intelligent Archival** — auto-detect archival eligibility, extract key frames, generate condensed packages for 95%+ storage savings
- 📌 **Pin & Legal Hold** — protect critical recordings from archival with audited pin/unpin trail
- 🔄 **Cross-Device Sync** — background vault sync populates local history from cloud on login
- 👥 **People & Closeness Scoring** — track contact relationships with weighted interaction signals
- 📊 **Knowledge Levels (L0–L4)** — automatic content classification based on ownership, participation, and engagement
- 🔁 **Background Recomputation** — scheduled 24h closeness score updates with knowledge level re-evaluation
- 🎯 **Smart Archive Replay** — transcript-synchronized lightweight replay for recordings without video blobs
- ⚡ **Embedding Pre-filter** — keyword-based pruning for faster semantic search over large recording libraries
- 🧠 **Meeting Prep** — proactive context cards with attendee closeness scores, past recordings, and open tasks
- 📋 **Daily Digest** — "Today" card with recording streak, overdue tasks, and weekly activity summary
- 🎯 **Task Priority Scoring** — deterministic priority engine using deadline urgency, requester closeness, task age, and action routing
- 🔗 **Related Recordings** — automatic discovery via shared participants, embedding cosine similarity, and knowledge graph edges
- 🧬 **Knowledge Graph** — lightweight edge store linking recordings ↔ contacts ↔ tasks with auto-created PARTICIPATED_IN, HAS_TASK, and SIMILAR_TO edges
- 💬 **Feedback System** — in-app bug reports and feature requests with PII-sanitized device diagnostics and local submission history
- ⚡ **Autonomy Engine** — background intelligence loop that auto-embeds transcripts, computes similarity edges, and recomputes closeness scores using `requestIdleCallback`
- 🔍 **Command Bar** — Spotlight-style overlay (`⌘K` or `/`) for unified search across recordings, contacts, and commands
- 🔔 **Notification Manager** — three-tier notification system: ephemeral toasts, persistent banners, and actionable cards
- 🧠 **"Right Now" Intelligence** — proactive cards showing pending tasks, completion trends, connection nudges, and autonomy status
- 📖 **Knowledge Classification** — automatic fact/decision/assumption/open-question classification of meeting insights with assumption risk scoring
- 📥 **Inbox & Read-to-Ingest** — recordings held as `raw` until explicitly processed; state badges and inbox banner in history panel
- 🤖 **Auto-Read Rules** — configurable rules engine for automated inbox processing by type, source, title, or participant
- 📄 **Document Ingestion** — import .txt, .md, .json files into the knowledge graph with AI summarization and semantic linking
- 🔄 **Archive Restore** — download archived recordings from cloud and transition back to active state with full audit trail

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
npm test           # 1,176 tests across 75 files
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
│   ├── state-machine.js        # 9-state recording FSM
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
│   ├── storage.js              # IndexedDB persistence (12 stores, v7)
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
| UI shell | 382 KB | 95 KB | Always |
| Core (storage, graph, config) | 63 KB | 18 KB | Always |
| AI (engine, embeddings, analytics) | 55 KB | 19 KB | Always |
| Pipeline (recording, archive, ffmpeg) | 43 KB | 14 KB | Lazy |
| Recording detail | 34 KB | 9.0 KB | Lazy (on click) |
| Cloud (Google Drive, OneDrive) | 33 KB | 7.7 KB | Lazy |
| App registry | 28 KB | 7.3 KB | Lazy (on tab) |
| Global tasks | 24 KB | 7.7 KB | Lazy (on tab) |
| Integrations (Slack, GitHub, etc.) | 11 KB | 3.9 KB | Lazy |
| Setup wizard | 10 KB | 2.6 KB | Lazy (first run) |
| Contacts panel | 10 KB | 3.3 KB | Lazy (on tab) |
| QR code generator | 7 KB | 3.1 KB | Lazy (on click) |
| Auto-record panel | 6 KB | 1.7 KB | Lazy (in settings) |
| CSS | 53 KB | 10.1 KB | Always |

- **1 runtime dependency** — `@netlify/blobs` for optional edge storage
- **6 strategic chunks** — manual code-splitting via Vite rollup
- **Service Worker** — offline-first with pre-cached assets

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
- 🗄️ **Intelligent Archival** — auto-detect archival eligibility, extract key frames, generate condensed packages
- 🤖 **Auto-Read Rules** — configurable inbox automation (Settings → Auto-Read; rules engine active)
- 📄 **Document Ingestion** — import text documents into the knowledge graph (history panel → + button or drag-and-drop)

---

**Built for teams who'd rather spend $0 than $14/user/month. Now with autonomous intelligence.**
