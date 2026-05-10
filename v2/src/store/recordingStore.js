/**
 * Recording slice — full state machine for a single recording session.
 *
 * States:
 *   idle → requesting → previewing → recording → paused
 *        → reviewing → processing → uploading → complete | failed
 */

const INITIAL_ARTIFACTS = {
  transcript: null,
  vtt: null,
  summary: null,
  chapters: null,
  domSnapshots: [],
  consoleLog: [],
  networkHar: [],
};

const INITIAL_STATE = {
  state: 'idle',
  type: null,
  blob: null,
  duration: 0,
  size: 0,
  title: '',
  isCameraActive: false,
  error: null,
  startTime: null,
  artifacts: INITIAL_ARTIFACTS,
  uploadProgress: { loaded: 0, total: 0 },
  driveLink: null,
  error: null,
};

/** @returns {import('zustand').StateCreator} */
export const createRecordingSlice = (set, get) => ({
  recording: INITIAL_STATE,

  // Transition helpers
  setRecordingState: (state) =>
    set((s) => ({ recording: { ...s.recording, state, error: null } })),

  setRecordingType: (type) =>
    set((s) => ({ recording: { ...s.recording, type } })),

  startRecording: (type) =>
    set((s) => ({
      recording: {
        ...s.recording,
        state: 'recording',
        type,
        startTime: Date.now(),
        blob: null,
        duration: 0,
        size: 0,
        artifacts: INITIAL_ARTIFACTS,
        driveLink: null,
        error: null,
      },
    })),

  pauseRecording: () =>
    set((s) => ({ recording: { ...s.recording, state: 'paused' } })),

  resumeRecording: () =>
    set((s) => ({ recording: { ...s.recording, state: 'recording' } })),

  finishRecording: (blob, durationMs) =>
    set((s) => ({
      recording: {
        ...s.recording,
        state: 'reviewing',
        blob,
        duration: durationMs,
        size: blob?.size ?? 0,
      },
    })),

  setArtifacts: (artifacts) =>
    set((s) => ({
      recording: { ...s.recording, artifacts: { ...s.recording.artifacts, ...artifacts } },
    })),

  appendDomSnapshot: (snapshot) =>
    set((s) => ({
      recording: {
        ...s.recording,
        artifacts: {
          ...s.recording.artifacts,
          domSnapshots: [...s.recording.artifacts.domSnapshots, snapshot],
        },
      },
    })),

  appendConsoleEntry: (entry) =>
    set((s) => ({
      recording: {
        ...s.recording,
        artifacts: {
          ...s.recording.artifacts,
          consoleLog: [...s.recording.artifacts.consoleLog, entry],
        },
      },
    })),

  setUploadProgress: (loaded, total) =>
    set((s) => ({ recording: { ...s.recording, uploadProgress: { loaded, total } } })),

  setDriveLink: (url) =>
    set((s) => ({ recording: { ...s.recording, driveLink: url } })),

  setRecordingError: (message) =>
    set((s) => ({ recording: { ...s.recording, state: 'failed', error: message } })),

  resetRecording: () =>
    set({ recording: INITIAL_STATE }),
});
