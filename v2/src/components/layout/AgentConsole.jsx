import React from 'react';
import { MessageSquare, FileText, CheckSquare } from 'lucide-react';
import { useUi, useRecording } from '@store/index.js';

const TABS = [
  { id: 'chat',  label: 'Chat',      Icon: MessageSquare },
  { id: 'docs',  label: 'Auto-Docs', Icon: FileText },
  { id: 'tasks', label: 'Task Triage', Icon: CheckSquare },
];

export function AgentConsole() {
  const { agentConsoleTab, setAgentConsoleTab } = useUi();
  const { state: recState, artifacts } = useRecording();
  const hasContent = artifacts.transcript || artifacts.summary;

  return (
    <div className="flex flex-col h-full border-l border-white/[0.04]">
      {/* Tab bar */}
      <div className="flex border-b border-white/[0.06] px-2 pt-2 gap-0.5 flex-shrink-0">
        {TABS.map(({ id, label, Icon }) => {
          const active = agentConsoleTab === id;
          return (
            <button
              key={id}
              onClick={() => setAgentConsoleTab(id)}
              className={[
                'flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-colors',
                active
                  ? 'text-white border-b-2 border-takus-primary -mb-px bg-white/[0.03]'
                  : 'text-white/40 hover:text-white/70',
              ].join(' ')}
            >
              <Icon size={13} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {agentConsoleTab === 'chat' && <ChatTab />}
        {agentConsoleTab === 'docs' && <DocsTab hasContent={hasContent} artifacts={artifacts} />}
        {agentConsoleTab === 'tasks' && <TaskTriageTab />}
      </div>
    </div>
  );
}

function ChatTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <MessageSquare size={32} className="text-white/10 mx-auto" />
          <p className="text-sm text-white/30">Ask questions about your recordings</p>
          <p className="text-xs text-white/20">Phase 5 — RAG pipeline coming soon</p>
        </div>
      </div>
      <div className="border-t border-white/[0.06] pt-3">
        <input
          type="text"
          placeholder="Ask Takus anything…"
          disabled
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white/60 placeholder:text-white/25 outline-none cursor-not-allowed"
        />
      </div>
    </div>
  );
}

function DocsTab({ hasContent, artifacts }) {
  if (!hasContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <FileText size={32} className="text-white/10 mx-auto" />
          <p className="text-sm text-white/30">No recording yet</p>
          <p className="text-xs text-white/20">AI-generated docs will appear here after processing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {artifacts.transcript && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Transcript</h3>
          <div className="glass-panel p-3">
            <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed line-clamp-6">{artifacts.transcript}</p>
          </div>
        </section>
      )}
      {artifacts.summary && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Summary</h3>
          <div className="glass-panel p-3">
            <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed">{artifacts.summary}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function TaskTriageTab() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <CheckSquare size={32} className="text-white/10 mx-auto" />
        <p className="text-sm text-white/30">No tasks extracted yet</p>
        <p className="text-xs text-white/20">Commitments and action items will appear here</p>
      </div>
    </div>
  );
}
