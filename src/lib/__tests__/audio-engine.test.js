// Takus — Audio Engine Tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Web Audio API mocks ──────────────────────────────────────────────────────

function mockMediaStream(hasAudio = true) {
  return { getAudioTracks: () => hasAudio ? [{ id: 'track-1' }] : [] };
}

function createMockCtx() {
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn((arr) => { arr.fill(0); }),
    connect: vi.fn(),
  };
  const destination = { stream: mockMediaStream(true) };
  const source = { connect: vi.fn() };
  const makeGain = () => ({ gain: { value: 1.0 }, connect: vi.fn() });

  return {
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => makeGain()),
    createMediaStreamDestination: vi.fn(() => destination),
    createMediaStreamSource: vi.fn(() => source),
    _analyser: analyser,
  };
}

// Mock the Web Audio API on the global window BEFORE import
let mockCtx;
const origAC = globalThis.window?.AudioContext;
const origRAF = globalThis.window?.requestAnimationFrame;
const origCAF = globalThis.window?.cancelAnimationFrame;

beforeEach(() => {
  mockCtx = createMockCtx();
  // Must be a proper constructor function (not arrow) for `new` to work
  function MockAudioContext() { return mockCtx; }
  Object.defineProperty(window, 'AudioContext', {
    value: MockAudioContext,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'webkitAudioContext', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: vi.fn(() => 42),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  // Restore originals
  if (origAC !== undefined) window.AudioContext = origAC;
  if (origRAF !== undefined) window.requestAnimationFrame = origRAF;
  if (origCAF !== undefined) window.cancelAnimationFrame = origCAF;
});

// Import AFTER mocks are set up
import { AudioEngine } from '../audio-engine.js';

describe('AudioEngine', () => {
  it('constructs with null defaults', () => {
    const engine = new AudioEngine();
    expect(engine.ctx).toBeNull();
    expect(engine.analyser).toBeNull();
    expect(engine.level).toBe(0);
  });

  it('initializes with system and mic streams', async () => {
    const engine = new AudioEngine();
    const result = await engine.init(mockMediaStream(true), mockMediaStream(true));

    expect(engine.ctx).toBe(mockCtx);
    expect(engine.analyser).toBeDefined();
    expect(result).toBeDefined();
  });

  it('initializes with system stream only (mic null)', async () => {
    const engine = new AudioEngine();
    await engine.init(mockMediaStream(true), null);

    expect(engine.ctx).toBe(mockCtx);
    expect(engine.gainMic).toBeNull();
  });

  it('initializes with mic stream only (system null)', async () => {
    const engine = new AudioEngine();
    await engine.init(null, mockMediaStream(true));

    expect(engine.ctx).toBe(mockCtx);
    expect(engine.gainSystem).toBeNull();
  });

  it('resumes suspended AudioContext', async () => {
    mockCtx.state = 'suspended';
    const engine = new AudioEngine();
    await engine.init(mockMediaStream(true), null);
    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('sets system volume', async () => {
    const engine = new AudioEngine();
    await engine.init(mockMediaStream(true), mockMediaStream(true));
    engine.setSystemVolume(0.5);
    expect(engine.gainSystem.gain.value).toBe(0.5);
  });

  it('sets mic volume', async () => {
    const engine = new AudioEngine();
    await engine.init(mockMediaStream(true), mockMediaStream(true));
    engine.setMicVolume(0.7);
    expect(engine.gainMic.gain.value).toBe(0.7);
  });

  it('handles setSystemVolume when no system gain', () => {
    const engine = new AudioEngine();
    expect(() => engine.setSystemVolume(0.5)).not.toThrow();
  });

  it('handles getFrequencyData when no analyser', () => {
    const engine = new AudioEngine();
    const data = new Uint8Array(128);
    expect(() => engine.getFrequencyData(data)).not.toThrow();
  });

  it('destroys cleanly after init', async () => {
    const engine = new AudioEngine();
    await engine.init(mockMediaStream(true), mockMediaStream(true));
    engine.destroy();

    expect(engine.ctx).toBeNull();
    expect(engine.analyser).toBeNull();
    expect(engine.gainSystem).toBeNull();
    expect(engine.gainMic).toBeNull();
    expect(engine.level).toBe(0);
  });

  it('destroys gracefully when not initialized', () => {
    const engine = new AudioEngine();
    expect(() => engine.destroy()).not.toThrow();
  });

  it('exposes analyserNode getter', async () => {
    const engine = new AudioEngine();
    await engine.init(mockMediaStream(true), null);
    expect(engine.analyserNode).toBe(engine.analyser);
  });
});
