# Changelog

All notable changes to **Takus** are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.13.2] — 2026-05-15

### Added
- **Apps Dashboard** — new "Apps" tab replaces the "Connect" tab with visual status tiles for all integrations, "Connect New App" entry point, and built-in features summary.
- **6-tab navigation** — `History | Tasks | People | Insights | Apps | Settings` (was 5 tabs).
- **SEARCH_REFINED signal** — wired in ask-panel.js for RL preference learning (tracks refined queries).
- **PRIORITY_OVERRIDE signal** — clickable priority badges on pending tasks with manual tier override persisted to IDB.
- **All 8/8 RL signals active** — closed-loop preference learning.
- **NOTIFY event constant** — centralized in events.js, replacing hardcoded `'takus:notify'` strings.
- 82 new tests across 4 new test files: auto-record-engine (26), embeddings (11), calendar-poller (15), qr-code (10), recording-pipeline (20).

### Fixed
- **Critical: `chunkTranscript` infinite loop** — embeddings.js chunking loop froze the browser tab for any transcript > 400 chars.
- **`_cache` ReferenceError** — settings-panel.js accessed an unexported module variable; crashed on settings open.
- **Falsy numeric defaults** — `||` → `??` for `bufferBeforeMin`, `bufferAfterMin`, `maxConcurrent` in auto-record-engine.js.
- **Delete handler resilience** — recording-detail, history-panel, contacts-panel delete operations now guard optional cleanup with `.catch()`.
- **Pin audit trail consistency** — recording-detail pin toggle now uses shared `togglePin()` for proper archiveLog.
- **Clear-all handler** — wrapped in try-catch for graceful IDB error handling.
- **JSON.parse safety** — all 12 calls verified with try-catch.
- **`.toLowerCase()` safety** — all 20 calls use fallback strings.

### Changed
- Settings-panel.js deduplicated: 924 → 714 lines (−22.7%).
- Service worker cache: v34 → v38.
- Test count: 499 → 608 (46 test files, was 39).
- Bundle: 461 KB / 120 KB gzip.
- Zero hardcoded `takus:` event strings remain — all routed through `events.js`.

---

## [0.13.0] — 2026-05-14

### Added
- **Knowledge Level Pipeline** — recording-pipeline writes `content_items` to IDB; engagement events for VIEW/PLAY; autonomy resolves L0–L4.
- **Archive Engine Activation** — autonomy archive scan gated by `archiveEngine` feature flag.
- **Knowledge Framework** (`knowledge-framework.js`) — insight classification, assumption risk scoring, reasoning chains. 17 tests.
- **Auto-Record Notification Wiring** — `AUTO_RECORD_PENDING` DOM event; app-shell listener gated by `autoRecord` flag.
- **Archive UI** — recording-detail Archive / View Archive button (flag-gated).
- **Decision reasoning chains** — collapsible chains in summary tab.
- **TASK_EDITED signals** — 8 signal sites total, 5 of 7 types wired.

### Changed
- `getSettingCached(key)` in settings-store.js for hot cache reads.
- Zero orphan components, zero unused exports.
- Version: 0.12.0 → 0.13.0; service worker: v33 → v34.
- Test count: 482 → 499 (39 test files).
- Bundle: 464 KB / 120 KB gzip.

---

## [0.12.0] — 2026-05-14

### Added
- **Preference Engine** (`src/lib/preference-engine.js`) — records user behavior signals (task accept/ignore, summary edits, search clicks, priority overrides) to IDB. Aggregates signals into prompt preferences and scoring weight adjustments. LRU-capped at 500 signals.
- **Blind Spot Detector** (`src/lib/blind-spot-detector.js`) — analyzes user behavior patterns to surface 4 types of confirmation bias: ignored task categories, single-source tunnel vision, stale close contacts, and recency bias. Pure computation, no side effects.
- **Feature Flags** (`src/lib/feature-flags.js`) — simple flag system with 5 flags (autoRecord, archiveEngine, adaptiveAI, blindSpots, dissent). Flags have tiers (stable/experimental), stored in IDB settings.
- **Labs Section** in Settings → toggle switches for all feature flags with tier badges.
- **Blind Spots Card** in Insights → "Right Now" section shows detected confirmation bias patterns.
- **Dissent & Open Questions** — meeting summary prompts now explicitly ask the AI to flag disagreements, unresolved tensions, and assumptions.
- **Adaptive AI Prompts** — summary and task extraction prompts dynamically adjust based on accumulated user preference signals (detailed vs concise, preferred/deprioritized task types).

### Changed
- Version bump to 0.12.0
- Test count: 451 → 482 (38 test files, +3 new test files)
- Bundle: 438 KB → 446 KB (115 KB gzip)
- README: Fixed stale test counts (407→482), bundle sizes (388→446 KB), removed Step Executor from "Coming Soon" (now active), added Intelligent Archival to Coming Soon.
- All new modules import from `storage.js` for IDB access (not settings-store.js).
- `ai-engine.js`: meeting prompts include contrarian section, summary/task prompts include adaptive hints.

### Known Dormant
- `archive-engine.js` — fully implemented and tested, now activatable via Labs flag.
- `auto-record-engine.js` + `calendar-poller.js` — now activatable via Labs flag.
- `auto-record-notification.js` — orphan component with no importer.

---

## [0.11.0] — 2026-05-14

### Added
- **Autonomy Engine** (`src/lib/autonomy-engine.js`) — background intelligence loop using `requestIdleCallback` that auto-embeds transcripts, computes similarity edges, and recomputes closeness scores. Pauses on page hidden, logs actions for auditability.
- **Command Bar** (`src/components/command-bar.js`) — Spotlight-style overlay activated via `⌘K` or `/`. Unified search across recordings, contacts, and commands. 9 built-in commands. Keyboard-first navigation.
- **Notification Manager** (`src/lib/notification-manager.js`) — three-tier notification system: ephemeral (toast), persistent (banner), and actionable (card with buttons). Priority-aware rendering, deduplication by ID. Event-based bridge to toast.js via `takus:notify` DOM events.
- **MENTIONED_IN edges** — recording pipeline now scans transcripts for known contact names and creates knowledge graph edges automatically
- **Meeting Context** — calendar-linked recordings display previous meetings, open tasks, and key decisions in the recording detail view
- **"Right Now" Intelligence Cards** — 6 proactive cards: Pending Actions, Task Rate, Patterns, Connection Nudges, Week Stats, Autonomy Status
- **`pulse` CSS animation** for the autonomy indicator

### Changed
- **Branding**: "Knowledge Studio" → **"Knowledge OS"** across header, manifest, index.html, meta tags, Open Graph, Twitter Cards, JSON-LD, 404 page, privacy policy, terms of service
- **Architecture**: All lib/ modules now route notifications through `notification-manager.js` → DOM events → app-shell → toast. Zero lib→component import violations remain.
- **Step-executor wired**: `autonomy_embed` and `autonomy_closeness` registered as auto-approved step types, making step-executor a production-active module.
- `⌘K` now opens the Command Bar (was: focus Ask input). `/` added as alternative shortcut.
- Keyboard shortcuts overlay updated to reflect new bindings
- Version bump to 0.11.0
- Service worker cache bumped to v32
- Module count: 84 → 87 (+autonomy-engine, +command-bar, +notification-manager)
- Test count: 386 → 441 (34 test files)
- CSS design tokens normalized: 14 legacy `--text-muted` / `--border` vars replaced with `--color-text-muted` / `--color-border`

### Fixed
- `getSettings` import in `recording-detail.js` normalized to `lib/settings-store.js` (was: `settings-panel.js`)
- Entity lifecycle integrity: contact delete now removes orphan edges; `clearAllRecordings` clears edges store
- Schema validators wired into all 6 IDB read paths (recordings, contacts x2, wiki, edges x2)
- **Defensive error handling** added to `embeddings.js`, `meeting-prep.js`, `integration-config.js` — all return safe defaults on failure instead of crashing callers

---

## [0.10.0] — 2026-05-13

### Added
- **Meeting Prep Engine** (`src/lib/meeting-prep.js`) — cross-reference calendar events with contacts, past recordings, and open tasks to generate structured preparation packages
- **Daily Digest Generator** (`src/lib/daily-digest.js`) — aggregates recording streak, overdue tasks, weekly stats, and upcoming meetings into a "Today" summary
- **Task Priority Scoring** (`src/lib/task-priority.js`) — deterministic priority engine using weighted formula: deadline urgency (35%) + requester closeness (25%) + task age (20%) + action routing weight (20%)
- **Today Card** in Insights panel — real-time daily digest with streak badge, overdue alerts, completion rate
- **Priority Sort** in Global Tasks — new filter chip + 🔴🟡🔵 priority badges on pending tasks
- **Related Recordings** enhanced — combines embedding cosine similarity with shared participant overlap (up to 5 related)
- **CHANGELOG.md** — full version history from v0.1.0 onwards
- 73 new unit tests: intelligence layer, closeness score, schema validator, identity vault, library import, archive engine

### Changed
- Version bump to 0.10.0
- Service worker cache bumped to v22
- Module count: 71 → 74
- Test count: 176 → 285 (21 files)

### Fixed
- **Watch modal memory leak** — `requestAnimationFrame` now cancelled on cleanup
- **Watch modal accessibility** — added `role="dialog"`, `aria-modal`, `aria-label`, focus management
- **Archive player accessibility** — added ARIA dialog attributes
- **Insights panel performance** — eliminated duplicate IndexedDB read by passing pre-loaded recordings to daily digest
- **Library import crash** — guarded `JSON.parse` with try/catch for corrupt backup files

### Removed
- 3 unused imports (`extractTLDW`, `getAllInteractions`, `computeStreak`)

---

## [0.9.0] — 2026-05-12

### Added
- Pre-production hardening pass
- Utility CSS classes (`text-xs`, `text-muted`, `flex-center`, `gap-*`, `truncate`, etc.)
- Inline style consolidation across all components
- ARIA labels on all tab panels

### Changed
- Consolidated 200+ inline styles into reusable CSS utilities
- Consistent `role="tablist"` / `role="tab"` across all tab bars

---

## [0.8.0] — 2026-05-12

### Added
- **Closeness Worker** — background 24h closeness score recomputation
- **Knowledge Level Badges** (L0–L4) — automatic content classification
- **Embedding Pre-filter** — keyword pruning for faster semantic search
- **Storage API expansion** — contacts, interactions, content items, engagement events
- IndexedDB upgraded to v5

---

## [0.7.0] — 2026-05-11

### Added
- **Task Steps & Objectives** — granular sub-steps and strategic objective alignment
- **Task Analytics** — completion metrics, action breakdown, average time-to-done
- **Objective Grouping** — strategic summary cards in insights panel
- **ZIP Backup** — full library export with videos, metadata, transcripts
- **Shared View** — public read-only summary page for shareable links

### Changed
- Task schema evolved to tri-state model (pending/done/ignored) with mandatory metadata

---

## [0.6.0] — 2026-05-10

### Added
- **Global Tasks Dashboard** — aggregate tasks across all recordings with filters and progress
- **Per-Recording Tasks Panel** — status transitions, dependency indicators, integration routing
- **Connect Panel** — Slack, GitHub, Linear, Jira, Notion integrations with encrypted credential storage
- **Identity Vault** — AES-GCM 256-bit encrypted credential storage

---

## [0.5.0] — 2026-03-10

### Added
- **PWA Support** — installable standalone app with service worker offline caching
- **GIF Export** — FFmpeg WASM-powered animated GIF creation
- **Keyboard Shortcuts** — customizable hotkeys for recording workflow
- **Recording Detail View** — 70/30 split layout with Ask, Summary, Transcript, Tasks tabs
- **Auto-Recording** — calendar-driven automatic recording with configurable rules

---

## [0.4.0] — 2026-03-08

### Added
- **Google Docs / OneNote** — auto-create meeting notes documents
- **Video Watermark** — customizable text overlay on recordings
- **Quality Presets** — 480p / 720p / 1080p video settings
- **Structured Cloud Vault** — `YYYY-MM/{id}/` folder organization

---

## [0.3.0] — 2026-03-06

### Added
- **Video Review Panel** — post-recording trim, GIF extract, approve/discard
- **Device Selection** — camera and microphone choosers
- **Cross-Device Sync** — background vault sync populates local history from cloud

---

## [0.2.0] — 2026-03-04

### Added
- **AI Task Extraction** — auto-extract action items from recordings
- **Ask (Video-RAG)** — semantic search across recordings with embeddings
- **Filler Word Analysis** — speaking quality metrics
- **Activity Heatmap** — recording frequency visualization

---

## [0.1.0] — 2026-03-02

### Added
- Initial release — screen + audio recording with Google Drive upload
- Loom-style floating facecam (Picture-in-Picture)
- OpenAI Whisper transcription + GPT-4o-mini summaries
- Google Calendar auto-linking
- Recording history with IndexedDB persistence
