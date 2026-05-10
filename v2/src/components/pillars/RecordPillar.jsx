import React, { useEffect } from 'react';
import { Users, Monitor, Megaphone, RefreshCw, Pause, Play, Camera, CameraOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRecorder } from '@hooks/useRecorder.js';
import { useAI } from '@hooks/useAI.js';
import { useStore } from '@store/index.js';
import { formatDuration, formatSize } from '@lib/recorder/utils.js';

const TYPES = [
  { id: 'meeting',      label: 'Meeting',       Icon: Users,     accent: '#06b6d4', description: 'Record calls. Get action items, decisions, and speaker transcripts.' },
  { id: 'screen',       label: 'Screen',         Icon: Monitor,   accent: '#10b981', description: 'Capture your screen. Debug with DOM + console capture.' },
  { id: 'presentation', label: 'Presentation',   Icon: Megaphone, accent: '#a78bfa', description: 'Chapter markers, filler word detection, slide transitions.' },
  { id: 'update',       label: 'Update',          Icon: RefreshCw, accent: '#f59e0b', description: 'Async update linked to Jira/GitHub ticket. Auto-posts to Slack.' },
];

export default function RecordPillar() {
  const rec = useStore((s) => s.recording);
  const setRecordingType = useStore((s) => s.setRecordingType);
  const reset = useStore((s) => s.resetRecording);

  const { requestAndStart, pause, resume, stop, reset: resetRecorder, toggleCamera } = useRecorder();
  const { process: processAI, isProcessing, error: aiError } = useAI();

  const isIdle        = rec.state === 'idle';
  const isRequesting  = rec.state === 'requesting';
  const isRecording   = rec.state === 'recording';
  const isPaused      = rec.state === 'paused';
  const isReviewing   = rec.state === 'reviewing';
  const isProcessingAI = rec.state === 'processing';
  const isComplete    = rec.state === 'complete';
  const isFailed      = rec.state === 'failed';

  // Keyboard shortcuts — Space = pause/resume, S = stop
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' && isRecording) { e.preventDefault(); pause(); }
      if (e.key === ' ' && isPaused)    { e.preventDefault(); resume(); }
      if ((e.key === 's' || e.key === 'S') && (isRecording || isPaused)) { e.preventDefault(); stop(); }
      if (e.key === 'Enter' && isReviewing) handleApprove();
      if (e.key === 'Escape' && isReviewing) resetRecorder();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRecording, isPaused, isReviewing]);

  const handleApprove = async () => {
    if (!rec.blob || !rec.type) return;
    await processAI(rec.blob, rec.type);
  };

  // ── Complete state ────────────────────────────────────────────────────────
  if (isComplete) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="glass-panel p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-takus-success/20 flex items-center justify-center mx-auto text-takus-success text-3xl">✓</div>
          <h2 className="text-lg font-semibold text-white">Processing complete</h2>
          <p className="text-sm text-white/50">Transcript and summary are ready in the Agent Console →</p>
          <button onClick={resetRecorder} className="btn-ghost text-sm mt-2">Start a new recording</button>
        </div>
      </div>
    );
  }

  // ── Failed state ──────────────────────────────────────────────────────────
  if (isFailed) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="glass-panel p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-takus-danger/20 flex items-center justify-center mx-auto text-takus-danger text-3xl">!</div>
          <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
          <p className="text-sm text-takus-danger/80">{rec.error}</p>
          <button onClick={resetRecorder} className="btn-ghost text-sm">Try again</button>
        </div>
      </div>
    );
  }

  // ── Review state ──────────────────────────────────────────────────────────
  if (isReviewing) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in space-y-5">
        <h1 className="text-2xl font-semibold text-white">Review Recording</h1>
        <div className="glass-panel p-4 space-y-3">
          {rec.blob && (
            <video
              src={URL.createObjectURL(rec.blob)}
              controls
              className="w-full rounded-xl max-h-72 bg-black"
            />
          )}
          <div className="flex justify-between text-sm text-white/40">
            <span>{formatDuration(rec.duration)}</span>
            <span>{formatSize(rec.size)}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={isProcessingAI}
            className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5"
          >
            {isProcessingAI
              ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Processing…</>
              : 'Transcribe & Summarize'
            }
          </button>
          <button onClick={resetRecorder} className="btn-ghost" disabled={isProcessingAI}>Discard</button>
        </div>
        {aiError && (
          <div className="text-sm text-takus-danger bg-takus-danger/10 border border-takus-danger/20 rounded-xl p-3">
            {aiError}
          </div>
        )}
        <p className="text-center text-xs text-white/25">
          <kbd className="bg-white/[0.06] px-1.5 py-0.5 rounded">Enter</kbd> approve ·{' '}
          <kbd className="bg-white/[0.06] px-1.5 py-0.5 rounded">Esc</kbd> discard
        </p>
      </div>
    );
  }

  // ── Idle / requesting / recording / paused ────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">

      {/* Live stats bar */}
      <AnimatePresence>
        {(isRecording || isPaused) && (
          <motion.div
            className="glass-panel p-4 grid grid-cols-3 gap-4"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          >
            <div>
              <p className={`text-xl font-semibold tabular-nums ${isRecording ? 'text-takus-recording' : 'text-takus-warning'}`}>
                {formatDuration(rec.duration)}
              </p>
              <p className="text-xs text-white/40">{isPaused ? 'Paused' : 'Duration'}</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-white">{formatSize(rec.size)}</p>
              <p className="text-xs text-white/40">File Size</p>
            </div>
            {rec.type && (() => {
              const t = TYPES.find((t) => t.id === rec.type);
              return t ? (
                <div className="text-right">
                  <p className="text-sm font-medium" style={{ color: t.accent }}>{t.label}</p>
                  <p className="text-xs text-white/40">Type</p>
                </div>
              ) : null;
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Type picker — only when idle */}
      <AnimatePresence>
        {isIdle && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className="text-2xl font-semibold text-white mb-1">New Recording</h1>
            <p className="text-sm text-white/40 mb-5">Choose a type to get started.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TYPES.map(({ id, label, description, Icon, accent }) => {
                const selected = rec.type === id;
                return (
                  <motion.button
                    key={id}
                    onClick={() => setRecordingType(id)}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className={[
                      'relative text-left p-4 rounded-2xl border transition-all duration-150',
                      selected
                        ? 'bg-white/[0.06] border-white/20'
                        : 'bg-white/[0.02] border-white/[0.06] hover:border-white/10 hover:bg-white/[0.04]',
                    ].join(' ')}
                  >
                    {selected && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: accent + '33' }}>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
                      </div>
                    )}
                    <Icon size={22} className="mb-3" style={{ color: accent }} />
                    <p className="font-medium text-white text-sm">{label}</p>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">{description}</p>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Control buttons */}
      <div className="flex items-center justify-center gap-4">
        {isIdle && (
          <>
            <button
              onClick={toggleCamera}
              className={`btn-ghost flex items-center gap-2 text-sm ${rec.isCameraActive ? 'text-takus-primary-light' : ''}`}
              title="Toggle Facecam (Picture-in-Picture)"
            >
              {rec.isCameraActive ? <Camera size={16} /> : <CameraOff size={16} />}
              Cam
            </button>
            <RecordButton
              onClick={() => requestAndStart(rec.type)}
              disabled={!rec.type || isRequesting}
              active={false}
            />
          </>
        )}

        {isRequesting && (
          <div className="flex items-center gap-3 text-white/50 text-sm">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Requesting screen access…
          </div>
        )}

        {isRecording && (
          <>
            <button onClick={pause} className="btn-ghost p-3 rounded-full" title="Pause (Space)" aria-label="Pause">
              <Pause size={20} />
            </button>
            <RecordButton onClick={stop} active={true} />
          </>
        )}

        {isPaused && (
          <>
            <button onClick={resume} className="btn-ghost p-3 rounded-full text-takus-success" title="Resume (Space)" aria-label="Resume">
              <Play size={20} />
            </button>
            <RecordButton onClick={stop} active={false} />
          </>
        )}
      </div>

      {isIdle && rec.type && (
        <p className="text-center text-xs text-white/25">
          <kbd className="bg-white/[0.06] px-1.5 py-0.5 rounded">Space</kbd> pause ·{' '}
          <kbd className="bg-white/[0.06] px-1.5 py-0.5 rounded">S</kbd> stop
        </p>
      )}
    </div>
  );
}

/** The round record / stop button */
function RecordButton({ onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={active ? 'Stop recording' : 'Start recording'}
      className={[
        'w-16 h-16 rounded-full border-4 border-white/10 flex items-center justify-center',
        'transition-all duration-200 focus-visible:outline-none',
        'disabled:opacity-30 disabled:cursor-not-allowed',
        active ? 'bg-takus-recording hover:bg-red-600' : 'bg-white/10 hover:bg-white/15',
      ].join(' ')}
    >
      {/* Inner icon: square = stop, circle = start */}
      <div className={`${active ? 'w-5 h-5 rounded bg-white' : 'w-6 h-6 rounded-full bg-takus-recording'}`} />
    </button>
  );
}
