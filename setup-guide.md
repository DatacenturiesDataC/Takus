# Google Meet Recorder - Setup Guide

This guide will help you set up the Google Meet Recorder with Google Drive upload and Calendar integration.

## 🚀 Quick Start

1. **Fork/clone this repository** to get the files
2. **Set up Google API credentials** (see below)
3. **Configure the application** in `config.js`
4. **Deploy to GitHub Pages** (or host on any HTTPS server)
5. **Connect to Google Drive** and start recording!

## 📋 Prerequisites

- Modern web browser (Chrome, Firefox, Edge, Safari)
- Google account
- Basic understanding of Google Cloud Console

## 🔧 Google API Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "New Project" or select an existing project
3. Give your project a name (e.g., "Google Meet Recorder")
4. Click "Create"

### Step 2: Enable Required APIs

1. In the Cloud Console, go to **APIs & Services > Library**
2. Enable the following APIs:
   - **Google Drive API**
   - **Google Calendar API**

### Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **"+ CREATE CREDENTIALS"** > **"OAuth client ID"**
3. If prompted, configure the OAuth consent screen:
   - Choose "External" user type
   - Fill in required fields (App name, User support email, etc.)
   - Add your email to test users
4. For the OAuth client ID:
   - Application type: **Web application**
   - Name: **Google Meet Recorder**
   - Authorized JavaScript origins:
     - `https://yourusername.github.io` (for GitHub Pages)
     - `https://your-custom-domain.com` (if using custom domain)
     - Must be HTTPS for screen recording to work
5. Click **"Create"**
6. Copy the **Client ID** (you'll need this for configuration)

### Step 4: Configure the Application

1. Open `config.js` in a text editor
2. Replace `YOUR_GOOGLE_CLIENT_ID_HERE` with your actual Client ID
3. Optionally customize other settings (recording quality, folder names, etc.)

## 🎯 Configuration Options

### Basic Configuration

```javascript
const CONFIG = {
  GOOGLE: {
    CLIENT_ID: "your-actual-client-id.googleusercontent.com",
    // ... other settings
  },
};
```

### Recording Quality Settings

- **480p**: Smaller files, good for long meetings
- **720p**: Recommended balance of quality and file size
- **1080p**: Best quality, larger files

### Audio Quality Settings

- **Low (64 kbps)**: Smallest files, adequate for voice
- **Medium (96 kbps)**: Recommended for most meetings
- **High (128 kbps)**: Best audio quality

## 🎬 How to Use

### Starting a Recording

1. **Open the application** in your web browser
2. **Connect to Google Drive** (first time only)
3. **Join your Google Meet** in another tab/window
4. **Return to the recorder** and click "Start Recording"
5. **Select the Google Meet window** when prompted
6. **Click "Share"** to begin recording

### Managing Recordings

- **Pause/Resume**: Use the pause button during recording
- **Stop**: Click stop when the meeting ends
- **Auto-upload**: Files automatically upload to Google Drive
- **Calendar Integration**: Recording links are added to your calendar events

### Tips for Best Results

1. **Audio Quality**:

   - Make sure to select "Share tab audio" when sharing your screen
   - Consider using headphones to reduce echo
   - Close unnecessary applications to reduce system noise

2. **Video Quality**:

   - Use a stable internet connection
   - Close other bandwidth-heavy applications
   - Choose appropriate quality based on meeting length

3. **File Management**:
   - Recordings are saved to "Google Meet Recordings" folder in Drive
   - Files are automatically named with meeting title and timestamp
   - Shareable links are generated automatically

## 🔒 Privacy & Security

### What Data is Accessed

- **Google Drive**: Upload and manage recording files
- **Google Calendar**: Read events and add recording links
- **Screen/Audio**: Record your selected screen and system audio

### Data Storage

- Recordings are stored in your personal Google Drive
- No data is sent to third-party servers
- All processing happens locally in your browser

### Permissions

The app requests minimal permissions:

- `drive.file`: Create and manage files created by the app
- `calendar`: Read and modify your calendar events

## 🛠️ Troubleshooting

### Common Issues

**"Setup Required" Error**

- Make sure you've replaced the placeholder Client ID in `config.js`
- Verify your Google Cloud project has the required APIs enabled

**"Authentication Failed"**

- Check that your domain is added to authorized JavaScript origins
- Try clearing browser cache and cookies
- Ensure popup blockers aren't preventing the auth window

**"No Audio in Recording"**

- When sharing screen, check "Share tab audio" or "Share system audio"
- Verify your browser has microphone permissions
- Check audio quality settings in the recorder

**"Upload Failed"**

- Verify your Google Drive has sufficient space
- Check your internet connection
- Try disconnecting and reconnecting to Google Drive

**"Recording Not Starting"**

- Grant screen sharing permissions when prompted
- Try refreshing the page and starting again
- Check browser console for error messages

### Browser-Specific Notes

**Chrome/Chromium**:

- Best compatibility and performance
- Supports all features including audio mixing

**Firefox**:

- Good compatibility
- May require additional permissions for microphone access

**Safari**:

- Limited screen sharing capabilities
- May not support advanced audio features

**Edge**:

- Similar to Chrome
- Good overall compatibility

## 📱 Mobile Support

Currently, screen recording is not supported on mobile browsers due to API limitations. This tool is designed for desktop use.

## 🚀 Advanced Features

### Custom File Naming

Modify the `FILE_NAME_PATTERN` in `config.js`:

```javascript
FILE_NAME_PATTERN: "{title} - {date} {time}";
```

Available variables:

- `{title}`: Meeting title
- `{date}`: Current date
- `{time}`: Current time
- `{timestamp}`: Full timestamp

### MP4 Conversion

For smaller file sizes, enable MP4 conversion:

```javascript
ENABLE_MP4_CONVERSION: true;
```

Note: This requires additional setup and may slow down processing.

## 🆘 Getting Help

If you encounter issues:

1. Check the browser console for error messages
2. Verify your Google API setup
3. Review this guide for troubleshooting steps
4. Check that all required permissions are granted

## 🔄 Updates

To update the recorder:

1. Download the latest files
2. Backup your `config.js` settings
3. Replace files and restore your configuration

---

**Happy Recording! 🎥**
