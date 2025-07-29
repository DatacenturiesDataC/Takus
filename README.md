# 🎥 Google Meet Recorder

A powerful, browser-based tool to record Google Meet sessions with automatic Google Drive upload and Calendar integration. No need for expensive Google Workspace subscriptions!

![Google Meet Recorder](https://img.shields.io/badge/Status-Ready%20to%20Use-brightgreen)
![Browser Support](https://img.shields.io/badge/Browser-Chrome%20%7C%20Firefox%20%7C%20Edge-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

- 🎬 **High-Quality Recording**: Record both screen and audio from Google Meet sessions
- 📤 **Auto Google Drive Upload**: Automatically saves recordings to your Google Drive
- 📅 **Calendar Integration**: Adds recording links to your Google Calendar events
- 🎛️ **Quality Control**: Choose video quality (480p/720p/1080p) and audio quality
- ⏯️ **Pause/Resume**: Full control over your recording session
- 📱 **Smart Naming**: Automatically detects meeting titles and creates organized filenames
- 🔒 **Privacy First**: All processing happens locally in your browser
- 🆓 **Completely Free**: No subscriptions or account required

## 🚀 Quick Start

### 1. Configure Google APIs

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Google Drive API and Google Calendar API
4. Create OAuth 2.0 credentials
5. Add your domain to "Authorized JavaScript origins"
6. Update `config.js` with your Client ID

### 2. Deploy to GitHub Pages

1. Fork or clone this repository
2. Update `config.js` with your Google Client ID
3. Enable GitHub Pages in repository Settings → Pages
4. Visit your app at: `https://yourusername.github.io/google-meet-recorder`

### 3. Start Recording

1. Connect to Google Drive (first time only)
2. Join your Google Meet
3. Click "Start Recording" and select your meeting window
4. Recording automatically uploads to your Google Drive!

## 🎯 Perfect For

- **Remote Teams**: Record important meetings for absent team members
- **Training Sessions**: Capture training materials and presentations
- **Client Meetings**: Keep records of project discussions and decisions
- **Educational Content**: Record online classes and workshops
- **Documentation**: Create video records of processes and procedures

## 📋 Requirements

- Modern web browser (Chrome recommended)
- Google account
- HTTPS hosting (GitHub Pages provides this automatically)
- Internet connection for Google API access

## 🔧 Technical Features

### Enhanced Audio Capture

- **System Audio**: Captures all meeting participants' voices
- **Microphone Integration**: Optional microphone audio mixing
- **Quality Options**: 64/96/128 kbps audio quality settings
- **Noise Reduction**: Built-in echo cancellation and noise suppression

### Video Recording

- **Multiple Resolutions**: 480p, 720p, 1080p support
- **Optimized Bitrates**: Balanced quality and file size
- **Long Recording Support**: Handle 60+ minute meetings
- **Real-time Preview**: See what you're recording

### Smart File Management

- **Auto-naming**: `Meeting Title - Date Time.webm`
- **Organized Storage**: Creates "Google Meet Recordings" folder
- **Shareable Links**: Automatically generates Drive sharing links
- **Progress Tracking**: Real-time recording statistics

## 📁 File Structure

```
google-meet-recorder/
├── index.html          # Main application interface
├── recorder.js         # Core recording functionality
├── google-api.js       # Google Drive & Calendar integration
├── config.js           # Configuration settings
├── setup-guide.md      # Detailed setup instructions
└── README.md           # This file
```

## ⚙️ Configuration Options

### Recording Quality

```javascript
// In config.js
RECORDING: {
    DEFAULT_VIDEO_QUALITY: '720p',  // 480p, 720p, 1080p
    DEFAULT_AUDIO_QUALITY: 'medium' // low, medium, high
}
```

### Google Drive Settings

```javascript
DRIVE: {
    RECORDINGS_FOLDER: 'Google Meet Recordings',
    MAKE_PUBLIC: true,
    FILE_NAME_PATTERN: '{title} - {date} {time}'
}
```

### Calendar Integration

```javascript
CALENDAR: {
    ENABLED: true,
    ADD_TO: 'description',
    NOTE_TEMPLATE: '\n\n📹 Recording: {link}'
}
```

## 🛡️ Privacy & Security

- **Local Processing**: All recording happens in your browser
- **Your Google Drive**: Files stored in your personal Google Drive
- **Minimal Permissions**: Only requests necessary Google API scopes
- **No Third-party Servers**: No data sent to external services
- **Open Source**: Full transparency of code and functionality

## 🌐 Browser Compatibility

| Browser | Recording | Audio | Drive Upload | Notes                   |
| ------- | --------- | ----- | ------------ | ----------------------- |
| Chrome  | ✅        | ✅    | ✅           | Best performance        |
| Firefox | ✅        | ✅    | ✅           | Full support            |
| Edge    | ✅        | ✅    | ✅           | Excellent compatibility |
| Safari  | ⚠️        | ⚠️    | ✅           | Limited screen share    |

## 🚨 Troubleshooting

### Common Issues

**"Setup Required" Error**

- Configure your Google Client ID in `config.js`
- Enable required APIs in Google Cloud Console

**No Audio in Recording**

- Select "Share tab audio" when sharing screen
- Check browser microphone permissions
- Verify audio quality settings

**Upload Failed**

- Check Google Drive storage space
- Verify internet connection
- Try reconnecting to Google Drive

**Recording Won't Start**

- Grant screen sharing permissions
- Refresh the page and try again
- Check browser console for errors

### Getting Help

1. 📖 Read the [Setup Guide](setup-guide.md)
2. 🔍 Check browser console for error messages
3. 🧪 Test with a short recording first
4. 🔄 Try different quality settings

## 🚀 Advanced Usage

### Custom File Naming

Use variables in your filename pattern:

- `{title}`: Meeting title
- `{date}`: Current date
- `{time}`: Current time
- `{timestamp}`: Full timestamp

### Long Recordings

The system handles long recordings (60+ minutes) with:

- Progress tracking
- Chunked data collection
- Memory optimization
- Error recovery

### Quality Optimization

For smaller files:

- Use 480p video quality
- Select "low" audio quality
- Enable MP4 conversion (experimental)

## 🔄 Updates & Maintenance

To update the recorder:

1. Backup your `config.js` settings
2. Download latest files
3. Restore your configuration
4. Test with a short recording

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions welcome! Please feel free to submit pull requests or create issues for bugs and feature requests.

## ⭐ Show Your Support

If this tool saves you money on Google Workspace subscriptions or makes your meetings more productive, please give it a star! ⭐

---

**Built with ❤️ for the remote work community**

_Save money, record meetings, stay productive!_
