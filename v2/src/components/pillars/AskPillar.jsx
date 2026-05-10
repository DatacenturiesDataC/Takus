import React from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';

export default function AskPillar() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-white">Ask</h1>
        <p className="text-sm text-white/40 mt-1">Search across all your recordings using natural language.</p>
      </div>

      <div className="glass-panel p-6 flex flex-col items-center justify-center gap-3 min-h-48 border-dashed">
        <Sparkles size={36} className="text-takus-primary/40" />
        <p className="text-sm text-white/40 text-center">RAG pipeline — Phase 5</p>
        <p className="text-xs text-white/25 text-center max-w-sm">
          Once implemented, you'll be able to ask "What did Jane commit to?" and get answers
          cited back to exact recording timestamps.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="What did we decide about the pricing model?"
          disabled
          className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/60 placeholder:text-white/25 outline-none cursor-not-allowed"
        />
        <button disabled className="btn-primary px-4 opacity-30 cursor-not-allowed">
          <MessageSquare size={16} />
        </button>
      </div>
    </div>
  );
}
