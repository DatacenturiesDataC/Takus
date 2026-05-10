import React from 'react';
import { Github, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import { useIntegrations } from '@store/index.js';

const SERVICES = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'Auto-create issues from bug reports captured during screen recordings.',
    color: '#fff',
    Icon: Github,
  },
  {
    id: 'jira',
    label: 'Jira',
    description: 'Link recordings to tickets and post bug reports or update comments.',
    color: '#0052cc',
    Icon: () => <span className="text-base font-bold" style={{ color: '#0052cc' }}>J</span>,
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Post async update recaps with highlight clips directly to channels.',
    color: '#4a154b',
    Icon: () => <span className="text-base font-bold text-[#e01e5a]">#</span>,
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Save meeting notes, decision logs, and transcripts as Notion pages.',
    color: '#fff',
    Icon: () => <span className="text-base font-bold text-white">N</span>,
  },
];

export default function ConnectPillar() {
  const { integrations, connectIntegration, disconnectIntegration } = useIntegrations();

  const handleToggle = (id) => {
    if (integrations[id]?.connected) {
      disconnectIntegration(id);
    } else {
      // Phase 6: replace with real OAuth flow
      connectIntegration(id, { user: 'demo@example.com' });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-white">Connect</h1>
        <p className="text-sm text-white/40 mt-1">
          Link your tools so Takus can push insights where your team already works.
        </p>
      </div>

      <div className="space-y-3">
        {SERVICES.map(({ id, label, description, Icon }) => {
          const connected = integrations[id]?.connected;
          return (
            <div key={id} className="glass-panel p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                <Icon />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{label}</p>
                  {connected && (
                    <span className="badge bg-takus-success/15 text-takus-success">
                      <CheckCircle size={10} /> Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{description}</p>
              </div>
              <button
                onClick={() => handleToggle(id)}
                className={[
                  'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  connected
                    ? 'bg-white/[0.06] text-white/50 hover:text-takus-danger hover:bg-takus-danger/10'
                    : 'bg-takus-primary/20 text-takus-primary-light hover:bg-takus-primary/30',
                ].join(' ')}
              >
                {connected ? (
                  <><XCircle size={13} /> Disconnect</>
                ) : (
                  <><ExternalLink size={13} /> Connect</>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-white/20 text-center">
        OAuth flows will be implemented in Phase 6. Click Connect for a preview of the UI.
      </p>
    </div>
  );
}
