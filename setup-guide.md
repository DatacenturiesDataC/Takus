# Takus — Setup Guide

## Prerequisites

- Modern web browser (Chrome recommended, Firefox or Edge also work)
- Google account
- HTTPS hosting (GitHub Pages, Netlify, Vercel — all free)

## Step 1: Google Cloud Setup

### Create a Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **New Project** → name it "Takus" → click **Create**

### Enable APIs

1. Navigate to **APIs & Services → Library**
2. Search and enable:
   - **Google Drive API**
   - **Google Calendar API**

### Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ CREATE CREDENTIALS → OAuth client ID**
3. If prompted, configure the consent screen:
   - User type: **External**
   - App name: **Takus**
   - Add your email as a test user
4. For the OAuth client:
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `https://yourusername.github.io` (for GitHub Pages)
     - `http://localhost:3000` (for local development)
5. Click **Create** and copy the **Client ID**

## Step 2: Configure Takus

Open `index.html` and set your Client ID:

```html
<script>
  window.__TAKUS_CONFIG__ = {
    google: {
      clientId: 'your-client-id.apps.googleusercontent.com',
    },
    drive: {
      folderName: 'Takus Recordings',
      makePublic: false,
    },
    calendar: {
      enabled: true,
    },
  };
</script>
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `google.clientId` | (required) | Your OAuth 2.0 Client ID |
| `drive.folderName` | `'Takus Recordings'` | Google Drive folder name for recordings |
| `drive.makePublic` | `false` | Whether to make recordings publicly shareable |
| `drive.fileNamePattern` | `'{title} — {date} {time}'` | Filename template. Variables: `{title}`, `{date}`, `{time}`, `{timestamp}` |
| `calendar.enabled` | `true` | Whether to link recordings to calendar events |
| `recording.defaultVideoQuality` | `'720p'` | Default video quality (480p/720p/1080p) |
| `recording.defaultAudioQuality` | `'medium'` | Default audio quality (low/medium/high) |

## Step 3: Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in Chrome.

## Step 4: Deploy

### GitHub Pages

```bash
npm run build
```

Push the `dist/` folder to your GitHub Pages branch, or use a GitHub Action to build and deploy automatically.

### Other Hosts

The `dist/` folder is a static site. Deploy it anywhere: Netlify, Vercel, Cloudflare Pages, S3, etc.

## Using Takus

### Recording Flow

1. **Connect Google Drive** — click "Connect Google Drive" (first time only)
2. **Set quality** — choose video/audio quality in Settings
3. **Enter a title** — optional but recommended for organization
4. **Click the record button** (or press `R`)
5. **Select what to share** — choose a screen, window, or tab
6. **Confirm** — click "Start Recording"
7. **Pause/Resume** — press Space or click the pause button
8. **Stop** — press `S` or click the stop button
9. **Auto-upload** — recording uploads to your Google Drive with progress tracking
10. **Calendar** — if a matching event is found, the Drive link is added to its description

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Start recording |
| `Space` | Pause / Resume |
| `S` | Stop recording |

### Tips

- **Audio capture**: when sharing a tab, check "Share tab audio" in the browser's sharing dialog
- **Quality vs. size**: 720p at medium audio uses ~18.6 MB/min (~1.1 GB/hour)
- **Long recordings**: resumable uploads handle files of any size without crashing
- **Offline fallback**: if Google Drive isn't connected, recordings download locally

## Troubleshooting

### "Configure your Google Client ID"

You haven't set a Client ID in `index.html`. Follow Step 1 and Step 2 above.

### Google Drive connection fails

- Check that your domain is in "Authorized JavaScript origins" in Google Cloud Console
- Make sure you're on HTTPS (not HTTP)
- Try clearing browser cache and cookies
- Check the browser console (F12) for specific error messages

### No audio in recording

- When sharing your screen, make sure to check "Share tab audio" or "Share system audio"
- The audio level meter at the bottom of the preview shows whether audio is being captured
- If using a microphone, grant microphone permission when prompted

### Recording stops unexpectedly

- If you click "Stop Sharing" in the browser's sharing bar, the recording stops automatically
- The recording data is preserved and will still upload or download

### Upload fails

- Check your internet connection
- The upload will automatically retry failed chunks up to 3 times
- If it still fails, click "Download Instead" to save locally
- You can then manually upload the file to Google Drive

---

**Need help?** Check the browser console (F12) for detailed error messages and logs.
