# Takus — Setup Guide

## Prerequisites

- Modern web browser (Chrome recommended, Firefox or Edge also work)
- Google account and/or Microsoft account
- HTTPS hosting (GitHub Pages, Netlify, Vercel — all free)

## Step 1: Cloud Provider Setup

You need at least one cloud provider configured. You can set up both to let users choose.

### Option A: Google (Drive + Calendar + Docs)

#### Create a Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **New Project** → name it "Takus" → click **Create**

#### Enable APIs

1. Navigate to **APIs & Services → Library**
2. Search and enable:
   - **Google Drive API**
   - **Google Calendar API**
   - **Google Docs API**

#### Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ CREATE CREDENTIALS → OAuth client ID**
3. If prompted, configure the consent screen:
   - User type: **External**
   - App name: **Takus**
   - Add your email as a test user
4. For the OAuth client:
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `https://yourdomain.netlify.app` (production)
     - `http://localhost:5173` (local development)
5. Click **Create** and copy the **Client ID**

### Option B: Microsoft (OneDrive + Outlook Calendar + OneNote)

#### Register an Application

1. Go to [Microsoft Entra admin center](https://entra.microsoft.com/)
2. Navigate to **Applications → App registrations → New registration**
3. Name: **Takus**
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
5. Redirect URI: Platform = **Single-page application (SPA)**, URI = `https://yourdomain.netlify.app`

#### Add Permissions

1. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**
2. Add these permissions:
   - `User.Read` (profile)
   - `Files.ReadWrite` (OneDrive uploads)
   - `Calendars.ReadWrite` (calendar integration)
   - `Notes.Create` (OneNote pages)
   - `Notes.ReadWrite` (OneNote sections)
3. Click **Grant admin consent** if you are the admin, otherwise users will consent on first login

#### Copy the Application ID

1. Go to **Overview** → copy the **Application (client) ID**

## Step 2: Configure Takus

Open `index.html` and set your provider credentials:

```html
<script>
  window.__TAKUS_CONFIG__ = {
    google: {
      clientId: 'your-google-client-id.apps.googleusercontent.com',
    },
    microsoft: {
      clientId: 'your-microsoft-app-id',
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

> **Note:** You can omit either `google` or `microsoft` if you only want one provider. The Connect dropdown will show a "Configure" tag for unconfigured providers.

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `google.clientId` | `''` | Your Google OAuth 2.0 Client ID |
| `microsoft.clientId` | `''` | Your Microsoft Entra Application ID |
| `microsoft.authority` | `'https://login.microsoftonline.com/common'` | MSAL authority (change for single-tenant apps) |
| `drive.folderName` | `'Takus Recordings'` | Cloud folder name for recordings (both providers) |
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

Open `http://localhost:5173` in Chrome.

## Step 4: Deploy

### Netlify (recommended)

Connect your GitHub repo to Netlify. Build command: `npm run build`, publish directory: `dist/`.

### Other Hosts

The `dist/` folder is a static site. Deploy it anywhere: Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3, etc.

## Using Takus

### Recording Flow

1. **Connect a cloud provider** — click "Connect" and choose Google Drive or Microsoft OneDrive (first time only)
2. **Set quality** — choose video/audio quality in Settings
3. **Enter a title** — optional but recommended for organization
4. **Click the record button** (or press `R`)
5. **Select what to share** — choose a screen, window, or tab
6. **3-2-1 countdown** — recording starts after the countdown
7. **Pause/Resume** — press Space or click the pause button
8. **Stop** — press `S` or click the stop button
9. **Review & trim** — preview the recording, optionally trim start/end
10. **Auto-upload** — recording uploads to your cloud storage with progress tracking
11. **Calendar** — if a matching Google Calendar / Outlook event is found, the link is added automatically
12. **Meeting notes** — if AI is configured, a Google Doc or OneNote page is created with the summary

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Start recording |
| `Space` | Pause / Resume |
| `S` | Stop recording |
| `Esc` | Cancel (during preview/countdown) |

### Tips

- **Audio capture**: when sharing a tab, check "Share tab audio" in the browser's sharing dialog
- **Quality vs. size**: 720p at medium audio uses ~18.6 MB/min (~1.1 GB/hour)
- **Long recordings**: resumable uploads handle files of any size without crashing
- **Offline fallback**: if no cloud provider is connected, recordings download locally
- **Facecam**: click the camera icon to activate Picture-in-Picture webcam overlay

## Troubleshooting

### "No cloud provider configured"

You haven't set a Client ID in `index.html`. Follow Step 1 and Step 2 above.

### Cloud connection fails

- Check that your domain/redirect URI is in the authorized origins
- Make sure you're on HTTPS (not HTTP)
- Try clearing browser cache and cookies
- Check the browser console (F12) for specific error messages

### Microsoft login shows "Need admin approval"

Your organization may require admin consent for the requested permissions. Ask your IT admin to approve the app, or use a personal Microsoft account.

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
- If it still fails, click "Save Locally" to download the file
- You can then manually upload the file to your cloud storage

---

**Need help?** Check the browser console (F12) for detailed error messages and logs.
