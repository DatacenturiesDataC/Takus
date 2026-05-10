// Recording quality config — ported from v1, cloud provider config removed (handled by Netlify Blobs)

export const RECORDING_CONFIG = {
  defaultVideoQuality: '720p',
  defaultAudioQuality: 'medium',
  qualities: {
    '480p':  { width: 854,  height: 480,  bitrate: 1_000_000 },
    '720p':  { width: 1280, height: 720,  bitrate: 2_500_000 },
    '1080p': { width: 1920, height: 1080, bitrate: 5_000_000 },
  },
  audioQualities: { low: 64_000, medium: 96_000, high: 128_000 },
};
