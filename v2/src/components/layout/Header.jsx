import React from 'react';
import { Menu, Circle } from 'lucide-react';
import { useUi, useRecording } from '@store/index.js';

export function Header() {
  const { toggleSidebar } = useUi();
  const { state: recState } = useRecording();
  const isLive = recState === 'recording' || recState === 'paused';

  return (
    <header className="h-14 flex items-center px-4 gap-3 border-b border-white/[0.06] flex-shrink-0 z-30">
      {/* Mobile menu toggle */}
      <button
        className="md:hidden p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white transition-colors"
        onClick={toggleSidebar}
        aria-label="Open sidebar"
      >
        <Menu size={18} />
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2 select-none">
        <div className="w-7 h-7 rounded-lg bg-takus-primary flex items-center justify-center">
          <span className="text-white text-xs font-bold">T</span>
        </div>
        <span className="font-semibold text-white hidden sm:block">Takus</span>
        <span className="text-white/30 text-xs hidden sm:block">2.0</span>
      </div>

      <div className="flex-1" />

      {/* Live recording badge */}
      {isLive && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-takus-recording/15 border border-takus-recording/30">
          <Circle
            size={7}
            className={`fill-takus-recording text-takus-recording ${recState === 'recording' ? 'animate-pulse-record' : 'opacity-50'}`}
          />
          <span className="text-xs font-medium text-takus-recording">
            {recState === 'paused' ? 'Paused' : 'Live'}
          </span>
        </div>
      )}

      {/* Account placeholder */}
      <button className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 transition-colors flex items-center justify-center text-xs font-medium text-white/70">
        ?
      </button>
    </header>
  );
}
