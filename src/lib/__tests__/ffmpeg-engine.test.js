// Takus — FFmpeg Engine Tests
// Tests the pure-logic parts of the FFmpeg engine (validation, error handling, queueing).
// The actual FFmpeg WASM operations are not testable without a browser + CDN.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the browser globals before importing
beforeEach(() => {
  globalThis.window = globalThis.window || {};
  globalThis.window.FFmpeg = undefined;
  globalThis.window.FFmpegUtil = undefined;
});

describe('FFmpeg Engine', () => {
  describe('input validation', () => {
    it('rejects null blob for convertToMP4', async () => {
      const { convertToMP4 } = await import('../ffmpeg-engine.js');
      await expect(convertToMP4(null)).rejects.toThrow('No media data');
    });

    it('rejects empty blob for convertToMP4', async () => {
      const { convertToMP4 } = await import('../ffmpeg-engine.js');
      const tinyBlob = new Blob(['x'], { type: 'video/webm' });
      await expect(convertToMP4(tinyBlob)).rejects.toThrow('too short or empty');
    });

    it('rejects null blob for extractAudio', async () => {
      const { extractAudio } = await import('../ffmpeg-engine.js');
      await expect(extractAudio(null)).rejects.toThrow('No media data');
    });

    it('rejects null blob for trimVideo', async () => {
      const { trimVideo } = await import('../ffmpeg-engine.js');
      await expect(trimVideo(null, 0, 10)).rejects.toThrow('No media data');
    });

    it('rejects null blob for addWatermark', async () => {
      const { addWatermark } = await import('../ffmpeg-engine.js');
      await expect(addWatermark(null, 'text')).rejects.toThrow('No media data');
    });

    it('rejects null blob for convertToGIF', async () => {
      const { convertToGIF } = await import('../ffmpeg-engine.js');
      await expect(convertToGIF(null)).rejects.toThrow('No media data');
    });
  });

  describe('preloadFFmpeg', () => {
    it('does not throw even when FFmpeg is unavailable', () => {
      const { preloadFFmpeg } = require('../ffmpeg-engine.js');
      // Should swallow errors silently
      expect(() => preloadFFmpeg()).not.toThrow();
    });
  });
});
