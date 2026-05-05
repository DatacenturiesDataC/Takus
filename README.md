# 🎬 Takus

**Record your screen. Vault it in Google Drive. Free forever.**

Takus is a free, privacy-first screen recorder that saves directly to your Google Drive. No accounts, no subscriptions, no meeting bots, no third-party servers. Your recordings stay yours.

![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)
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
- 📤 **Auto Google Drive Upload** — resumable uploads in 5MB chunks with retry and progress tracking
- 🤖 **BYOK AI Assistant** — transcribe audio and generate actionable meeting summaries via OpenAI
- 📝 **WebVTT Subtitles** — generate and download perfectly synced closed captions for your recordings
- 💾 **Instant MP4 Export** — convert WebM to MP4 instantly on the client side using WebAssembly FFmpeg
- 📅 **Smart Calendar Linking** — automatically finds the matching calendar event and attaches the recording link
- 🎛️ **Quality Presets** — 480p / 720p / 1080p video, 64 / 96 / 128 kbps audio
- ⏯️ **Pause / Resume** — full control with accurate duration tracking
- 🔊 **Dynamic Audio Visualizer** — 32-bar waveform visualizer for real-time audio monitoring
- 📋 **Recording History** — IndexedDB-backed list of past recordings with Drive links and AI summaries
- ⌨️ **Keyboard Shortcuts** — R (record), Space (pause/resume), S (stop)
- 🔒 **Privacy First** — all processing happens locally in your browser, zero backend
- 🆓 **$0/year to operate** — no servers, no API costs, hosted free on GitHub Pages

## 🚀 Quick Start

### 1. Configure Google APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable **Google Drive API** and **Google Calendar API**
3. Create OAuth 2.0 credentials (Web application)
4. Add your domain to "Authorized JavaScript origins"
5. Copy your Client ID

### 2. Set Your Client ID

Edit `index.html` and replace the placeholder:

```html
<script>
  window.__TAKUS_CONFIG__ = {
    google: {
      clientId: 'your-id.apps.googleusercontent.com',
    },
  };
</script>
```

### 3. Run

```bash
npm install
npm run dev        # Dev server on localhost:3000
npm run build      # Production build to dist/
```

### 4. Deploy

Deploy the `dist/` folder to GitHub Pages, Netlify, Vercel, or any static host.

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
│   ├── ai-engine.js            # OpenAI Whisper + GPT integration
│   ├── ffmpeg-engine.js        # WebAssembly WebM -> MP4 conversion
│   ├── audio-engine.js         # Audio mixing + 32-bar visualizer analyzer
│   ├── google-auth.js          # OAuth with token lifecycle
│   ├── google-drive.js         # Resumable uploads
│   ├── google-calendar.js      # Smart event matching
│   ├── storage.js              # IndexedDB persistence
│   ├── config.js               # Runtime configuration
│   └── icons.js                # Inline SVG icons
└── components/
    ├── app-shell.js            # State router & orchestrator
    ├── header.js               # Brand + Drive status
    ├── hero-section.js         # Landing value proposition
    ├── recorder-panel.js       # Record/pause/stop controls
    ├── preview-canvas.js       # Video preview + audio meter
    ├── settings-panel.js       # Quality & naming config
    ├── drive-panel.js          # Google Drive connection
    ├── upload-progress.js      # Upload states (progress/complete/failed)
    ├── history-panel.js        # Recording history
    ├── consent-notice.js       # Legal recording notice
    └── toast.js                # Notification system
```

## ⚙️ Configuration

All configuration is set via `window.__TAKUS_CONFIG__` in `index.html`:

```javascript
window.__TAKUS_CONFIG__ = {
  google: {
    clientId: 'your-id.apps.googleusercontent.com',
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar'],
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

### Resumable Uploads

Files are uploaded to Google Drive using the resumable upload protocol:
1. Initiate session → get session URI
2. Upload in 5MB chunks
3. Handle `308 Resume Incomplete` → continue from last byte
4. Refresh OAuth token mid-upload if needed
5. Retry failed chunks with exponential backoff

### Audio Engine

- Mixes system audio + microphone via Web Audio API
- Independent gain control per source
- `AnalyserNode` for real-time level metering
- Handles Chrome AudioContext suspension policy

### Calendar Matching

Instead of guessing, Takus scores calendar events by:
- Time proximity to recording start (±2 hour window)
- Presence of Google Meet conference link (+30 pts)
- Keywords in event title ("meet", "call", "sync", etc.)
- Selects highest-scoring match

## 🛡️ Privacy & Security

- **Local processing** — all recording and encoding happens in your browser
- **Your Google Drive** — files go to your personal Drive, not our servers
- **Minimal permissions** — only `drive.file` (app-created files only) and `calendar`
- **No telemetry** — zero tracking, analytics, or data collection
- **Private by default** — recordings are not shared unless you choose to
- **Open source** — audit every line of code

## 🌐 Browser Support

| Browser | Recording | Audio | Drive Upload |
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

---

**Built for teams who'd rather spend $0 than $14/user/month.**
