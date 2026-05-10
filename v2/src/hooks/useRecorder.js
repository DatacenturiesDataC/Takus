import { useRef, useCallback, useEffect } from 'react';
import { Recorder } from '@lib/recorder/recorder.js';
import { FacecamManager } from '@lib/recorder/facecam.js';
import { useStore } from '@store/index.js';

/**
 * React hook wrapping the v1 Recorder and FacecamManager classes.
 * Syncs all state changes into the Zustand recording slice.
 */
export function useRecorder() {
  const recorder = useRef(null);
  const facecam = useRef(null);

  const {
    startRecording,
    pauseRecording,
    resumeRecording,
    finishRecording,
    setRecordingState,
    setRecordingError,
    resetRecording,
    recording,
  } = useStore((s) => ({
    startRecording: s.startRecording,
    pauseRecording: s.pauseRecording,
    resumeRecording: s.resumeRecording,
    finishRecording: s.finishRecording,
    setRecordingState: s.setRecordingState,
    setRecordingError: s.setRecordingError,
    resetRecording: s.resetRecording,
    recording: s.recording,
  }));

  // Tick: update elapsed + size in store every 500ms while recording
  const updateStats = useCallback((elapsed, size) => {
    useStore.setState((s) => ({
      recording: { ...s.recording, duration: elapsed, size },
    }));
  }, []);

  const _getOrCreateRecorder = useCallback(() => {
    if (!recorder.current) {
      recorder.current = new Recorder();
      recorder.current.onTick(updateStats);
      recorder.current.onError((err) => setRecordingError(err?.message || 'Recording error'));
      recorder.current.onTrackEnded(() => {
        // User clicked "Stop sharing" in browser chrome — treat as stop
        stop();
      });
    }
    return recorder.current;
  }, [updateStats, setRecordingError]);

  const _getOrCreateFacecam = useCallback(() => {
    if (!facecam.current) {
      facecam.current = new FacecamManager();
      facecam.current.onDeactivate(() => {
        useStore.setState((s) => ({
          recording: { ...s.recording, isCameraActive: false },
        }));
      });
    }
    return facecam.current;
  }, []);

  const requestAndStart = useCallback(async (type, { videoQuality = '720p', audioQuality = 'medium', micDeviceId = null } = {}) => {
    const rec = _getOrCreateRecorder();

    setRecordingState('requesting');
    try {
      await rec.requestStreams(micDeviceId);
    } catch (err) {
      // User dismissed the screen picker — go back to idle
      setRecordingState('idle');
      return;
    }

    startRecording(type);

    rec.onStop((blob, durationMs) => {
      finishRecording(blob, durationMs);
    });

    rec.start(videoQuality, audioQuality);
  }, [_getOrCreateRecorder, setRecordingState, startRecording, finishRecording]);

  const pause = useCallback(() => {
    recorder.current?.pause();
    pauseRecording();
  }, [pauseRecording]);

  const resume = useCallback(() => {
    recorder.current?.resume();
    resumeRecording();
  }, [resumeRecording]);

  const stop = useCallback(() => {
    recorder.current?.stop();
    // finishRecording is called from the onstop callback above with the real blob
  }, []);

  const reset = useCallback(() => {
    recorder.current?.cleanup();
    recorder.current = null;
    facecam.current?.stop();
    facecam.current = null;
    resetRecording();
  }, [resetRecording]);

  const toggleCamera = useCallback(async (cameraDeviceId = null) => {
    const fc = _getOrCreateFacecam();
    const isNowActive = await fc.toggle(cameraDeviceId);
    useStore.setState((s) => ({
      recording: { ...s.recording, isCameraActive: isNowActive },
    }));
    return isNowActive;
  }, [_getOrCreateFacecam]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recorder.current?.cleanup();
      facecam.current?.stop();
    };
  }, []);

  return {
    requestAndStart,
    pause,
    resume,
    stop,
    reset,
    toggleCamera,
    audioLevel: recorder.current?.audioLevel ?? 0,
    stream: recorder.current?.stream ?? null,
  };
}
