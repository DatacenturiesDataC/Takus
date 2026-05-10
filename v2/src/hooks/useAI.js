import { useCallback, useState } from 'react';
import { generateTranscriptionAndSummary } from '@lib/ai/engine.js';
import { useStore } from '@store/index.js';
import { getSetting } from '@lib/storage/indexeddb.js';

/**
 * Hook for running AI transcription + summary on a recording blob.
 * On completion, artifacts are written to the Zustand recording slice.
 */
export function useAI() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const setArtifacts = useStore((s) => s.setArtifacts);
  const setRecordingState = useStore((s) => s.setRecordingState);

  const process = useCallback(async (blob, type) => {
    setIsProcessing(true);
    setError(null);
    setRecordingState('processing');

    try {
      const provider = (await getSetting('aiProvider')) || 'openai';
      const apiKey = provider === 'gemini'
        ? await getSetting('geminiKey')
        : await getSetting('openaiKey');

      const { transcript, summary, vtt } = await generateTranscriptionAndSummary(blob, apiKey, type, provider);
      setArtifacts({ transcript, summary, vtt });
      setRecordingState('complete');
      return { transcript, summary, vtt };
    } catch (err) {
      setError(err.message);
      setRecordingState('failed');
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, [setArtifacts, setRecordingState]);

  return { process, isProcessing, error };
}
