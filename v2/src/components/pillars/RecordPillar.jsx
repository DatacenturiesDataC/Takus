import React from 'react';
import { Video, Users, Monitor, Megaphone, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useRecording } from '@store/index.js';

const TYPES = [
  {
    id: 'meeting',
    label: 'Meeting',
    description: 'Record and transcribe calls. Get action items and decision logs.',
    Icon: Users,
    accent: '#06b6d4',
  },
  {
    id: 'screen',
    label: 'Screen',
    description: 'Capture your screen with audio. Debug sessions with DOM + console capture.',
    Icon: Monitor,
    accent: '#10b981',
  },
  {
    id: 'presentation',
    label: 'Presentation',
    description: 'Record presentations with chapter markers and filler word detection.',
    Icon: Megaphone,
    accent: '#a78bfa',
  },
  {
    id: 'update',
    label: 'Update',
    description: 'Quick async updates. Auto-link to Jira/GitHub tickets and post to Slack.',
    Icon: RefreshCw,
    accent: '#f59e0b',
  },
];

export default function RecordPillar() {
  const { state, type: activeType, setRecordingType, setRecordingState } = useRecording();
  const isIdle = state === 'idle';

  const handleSelectType = (id) => {
    if (!isIdle) return;
    setRecordingType(id);
  };

  const handleStart = () => {
    if (!activeType) return;
    // Phase 2: replace with useRecorder hook
    setRecordingState('requesting');
    // Temporary stub — real MediaRecorder integration comes in Phase 2
    setTimeout(() => setRecordingState('idle'), 1500);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-white">New Recording</h1>
        <p className="text-sm text-white/40 mt-1">Choose a recording type to get started.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TYPES.map(({ id, label, description, Icon, accent }) => {
          const selected = activeType === id;
          return (
            <motion.button
              key={id}
              onClick={() => handleSelectType(id)}
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
                <div
                  className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: accent + '33', color: accent }}
                >
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

      <button
        onClick={handleStart}
        disabled={!activeType || !isIdle}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm"
      >
        <Video size={16} />
        {state === 'requesting' ? 'Requesting access…' : `Start ${activeType ? TYPES.find(t => t.id === activeType)?.label : ''} Recording`}
      </button>

      <p className="text-center text-xs text-white/25">
        Screen capture requires Chrome, Edge, or Firefox on desktop.
      </p>
    </div>
  );
}
