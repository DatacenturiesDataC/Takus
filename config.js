// Google Meet Recorder Configuration
// Replace the values below with your own Google API credentials

const CONFIG = {
    // Google API Configuration
    GOOGLE: {
        // Get these from Google Cloud Console: https://console.cloud.google.com/
        CLIENT_ID: '506782822550-284plbnl3tokvlu9n0h9f2lvrg30br8h.apps.googleusercontent.com',
        API_KEY: '', // Optional - leave empty for OAuth 2.0 flow

        // Required scopes for the application
        SCOPES: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/calendar'
        ],

        // Discovery documents
        DISCOVERY_DOCS: [
            'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
            'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
        ]
    },

    // Recording Settings
    RECORDING: {
        // Default video quality options
        VIDEO_QUALITY: {
            '480p': {
                width: 854,
                height: 480,
                bitrate: 1000000 // 1 Mbps
            },
            '720p': {
                width: 1280,
                height: 720,
                bitrate: 2500000 // 2.5 Mbps
            },
            '1080p': {
                width: 1920,
                height: 1080,
                bitrate: 5000000 // 5 Mbps
            }
        },

        // Audio quality options
        AUDIO_QUALITY: {
            'low': 64000,    // 64 kbps
            'medium': 96000, // 96 kbps
            'high': 128000   // 128 kbps
        },

        // Default recording settings
        DEFAULT_VIDEO_QUALITY: '720p',
        DEFAULT_AUDIO_QUALITY: 'medium',

        // Frame rate
        FRAME_RATE: 30,

        // Audio settings
        AUDIO_SETTINGS: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 2
        }
    },

    // Google Drive Settings
    DRIVE: {
        // Folder name for recordings
        RECORDINGS_FOLDER: 'Google Meet Recordings',

        // File naming pattern
        // Available variables: {title}, {date}, {time}, {timestamp}
        FILE_NAME_PATTERN: '{title} - {date} {time}',

        // Make files publicly shareable by default
        MAKE_PUBLIC: true,

        // File description template
        DESCRIPTION_TEMPLATE: 'Google Meet recording uploaded on {datetime}'
    },

    // Calendar Integration
    CALENDAR: {
        // Enable calendar integration
        ENABLED: true,

        // Calendar ID (use 'primary' for main calendar)
        CALENDAR_ID: 'primary',

        // How to add recording link to calendar
        // Options: 'description', 'attachment', 'both'
        ADD_TO: 'description',

        // Template for calendar note
        NOTE_TEMPLATE: '\n\n📹 Recording: {link}\n(Uploaded: {datetime})'
    },

    // UI Settings
    UI: {
        // Theme
        THEME: 'light', // 'light' or 'dark'

        // Show advanced settings by default
        SHOW_ADVANCED: false,

        // Auto-detect meeting title
        AUTO_DETECT_TITLE: true,

        // Show recording preview
        SHOW_PREVIEW: true
    },

    // Advanced Settings
    ADVANCED: {
        // Enable debug logging
        DEBUG: false,

        // Chunk size for recording (in milliseconds)
        CHUNK_SIZE: 1000,

        // Maximum recording duration (in minutes, 0 = no limit)
        MAX_DURATION: 0,

        // Enable MP4 conversion (requires FFmpeg.js)
        ENABLE_MP4_CONVERSION: false,

        // Compression level for MP4 (1-10, higher = more compression)
        COMPRESSION_LEVEL: 5
    }
};

// Validation functions
const ConfigValidator = {
    validate() {
        const errors = [];

        // Check Google API configuration
        if (CONFIG.GOOGLE.CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
            errors.push('Google Client ID not configured');
        }

        // Validate video quality settings
        if (!CONFIG.RECORDING.VIDEO_QUALITY[CONFIG.RECORDING.DEFAULT_VIDEO_QUALITY]) {
            errors.push('Invalid default video quality');
        }

        // Validate audio quality settings
        if (!CONFIG.RECORDING.AUDIO_QUALITY[CONFIG.RECORDING.DEFAULT_AUDIO_QUALITY]) {
            errors.push('Invalid default audio quality');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    },

    showValidationErrors(errors) {
        console.group('🚨 Configuration Errors');
        errors.forEach(error => console.error(`❌ ${error}`));
        console.groupEnd();

        // Show user-friendly error
        const errorMessage = `Configuration errors found:\n\n${errors.join('\n')}\n\nPlease check config.js and fix these issues.`;
        alert(errorMessage);
    }
};

// Export configuration
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, ConfigValidator };
} else {
    window.CONFIG = CONFIG;
    window.ConfigValidator = ConfigValidator;
} 