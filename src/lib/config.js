// Takus — Runtime Configuration

const DEFAULT_CONFIG = {
  google: {
    clientId: '',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/calendar',
    ],
  },
  capture: {
    defaultVideoQuality: '720p',
    defaultAudioQuality: 'medium',
    frameRate: 30,
    qualities: {
      '480p':  { width: 854,  height: 480,  bitrate: 1_000_000 },
      '720p':  { width: 1280, height: 720,  bitrate: 2_500_000 },
      '1080p': { width: 1920, height: 1080, bitrate: 5_000_000 },
    },
    audioQualities: { low: 64_000, medium: 96_000, high: 128_000 },
  },
  drive: {
    folderName: 'Takus Captures',
    makePublic: false,
    fileNamePattern: '{title} — {date} {time}',
  },
  calendar: { enabled: true, calendarId: 'primary' },
  microsoft: {
    clientId: '',
    authority: 'https://login.microsoftonline.com/common',
  },
};

let _config = null;

export function initConfig() {
  const userConfig = window.__TAKUS_CONFIG__ || {};
  _config = deepMerge(DEFAULT_CONFIG, userConfig);

  const errors = validate(_config);
  if (errors.length > 0) {
    console.warn('[Takus] Config issues:', errors);
  }
  return _config;
}

export function getConfig() {
  if (!_config) return initConfig();
  return _config;
}

export function isGoogleConfigured() {
  const c = getConfig();
  return !!(c.google.clientId && !c.google.clientId.includes('YOUR_CLIENT_ID'));
}

export function isMicrosoftConfigured() {
  const c = getConfig();
  return !!(c.microsoft?.clientId && !c.microsoft.clientId.includes('YOUR_CLIENT_ID'));
}

function validate(c) {
  const errors = [];
  const googleOk = !!(c.google.clientId && !c.google.clientId.includes('YOUR_CLIENT_ID'));
  const msOk = !!(c.microsoft?.clientId && !c.microsoft.clientId.includes('YOUR_CLIENT_ID'));

  if (!googleOk && !msOk) {
    errors.push('No cloud provider configured. Set google.clientId or microsoft.clientId in public/config.js → window.__TAKUS_CONFIG__');
  }
  if (c.google.clientId && c.google.clientId.includes('YOUR_CLIENT_ID')) {
    errors.push('Google client ID is still a placeholder. Replace YOUR_CLIENT_ID in public/config.js with your OAuth 2.0 client ID from console.cloud.google.com');
  }
  if (c.microsoft?.clientId && c.microsoft.clientId.includes('YOUR_CLIENT_ID')) {
    errors.push('Microsoft client ID is still a placeholder. Replace it with your Azure AD app registration client ID');
  }
  return errors;
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] === null || source[key] === undefined) continue;
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}
