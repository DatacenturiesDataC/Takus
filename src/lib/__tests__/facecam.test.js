// Takus — Facecam Manager Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage
vi.mock('../storage.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import { FacecamManager } from '../facecam.js';

describe('FacecamManager', () => {
  let cam;

  beforeEach(() => {
    cam = new FacecamManager();
    // Reset PiP state
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      value: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'pictureInPictureElement', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  it('starts with inactive state', () => {
    expect(cam.isActive).toBe(false);
    expect(cam.stream).toBeNull();
    expect(cam.videoEl).toBeNull();
  });

  it('stop() is a no-op when not active', async () => {
    // Should not throw
    await expect(cam.stop()).resolves.not.toThrow();
    expect(cam.isActive).toBe(false);
  });

  it('toggle() returns false when stopping', async () => {
    // Simulate active state
    cam.isActive = true;
    cam.stream = { getTracks: () => [{ stop: vi.fn() }] };
    cam.videoEl = document.createElement('video');
    cam.videoEl.srcObject = null;
    cam.videoEl.remove = vi.fn();

    const result = await cam.toggle();
    expect(result).toBe(false);
    expect(cam.isActive).toBe(false);
  });

  it('stop() cleans up stream and video element', async () => {
    const mockTrack = { stop: vi.fn() };
    cam.isActive = true;
    cam.stream = { getTracks: () => [mockTrack] };
    cam.videoEl = document.createElement('video');
    cam.videoEl.remove = vi.fn();

    await cam.stop();

    expect(cam.isActive).toBe(false);
    expect(cam.stream).toBeNull();
    expect(cam.videoEl).toBeNull();
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it('stop() cleans up drag listeners if present', async () => {
    const cleanupFn = vi.fn();
    cam.isActive = true;
    cam.stream = { getTracks: () => [] };
    cam.videoEl = document.createElement('video');
    cam.videoEl.remove = vi.fn();
    cam._dragCleanup = cleanupFn;

    await cam.stop();

    expect(cleanupFn).toHaveBeenCalled();
    expect(cam._dragCleanup).toBeNull();
  });

  it('supports _onDeactivate callback', () => {
    const cb = vi.fn();
    cam._onDeactivate = cb;
    expect(cam._onDeactivate).toBe(cb);
  });

  it('_showFallbackOverlay is a no-op without videoEl', () => {
    cam.videoEl = null;
    expect(() => cam._showFallbackOverlay()).not.toThrow();
  });

  it('_showFallbackOverlay makes video visible', () => {
    cam.videoEl = document.createElement('video');
    cam._showFallbackOverlay();
    expect(cam.videoEl.style.opacity).toBe('1');
    expect(cam.videoEl.style.width).toBe('200px');
    expect(cam.videoEl.style.zIndex).toBe('9999');
  });
});
