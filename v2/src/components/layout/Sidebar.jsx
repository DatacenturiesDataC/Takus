import React from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Video, CheckSquare, Plug } from 'lucide-react';
import { useUi } from '@store/index.js';

const PILLARS = [
  { id: 'ask',     label: 'Ask',     Icon: MessageSquare },
  { id: 'record',  label: 'Record',  Icon: Video },
  { id: 'tasks',   label: 'Tasks',   Icon: CheckSquare },
  { id: 'connect', label: 'Connect', Icon: Plug },
];

export function Sidebar() {
  const { activePillar, setActivePillar, sidebarOpen, setSidebarOpen } = useUi();

  const handleNav = (id) => {
    setActivePillar(id);
    setSidebarOpen(false);
  };

  return (
    <motion.aside
      className={[
        'flex-shrink-0 flex flex-col border-r border-white/[0.06] bg-[#06060f] z-50',
        'fixed md:static inset-y-0 left-0 top-14',
        'w-[var(--sidebar-width)]',
      ].join(' ')}
      style={{ '--sidebar-width': '240px' }}
      initial={false}
      animate={{ x: sidebarOpen ? 0 : undefined }}
      // On desktop, always visible via static positioning (CSS class handles it)
    >
      <nav className="flex-1 p-3 space-y-1 mt-2">
        {PILLARS.map(({ id, label, Icon }) => {
          const active = activePillar === id;
          return (
            <button
              key={id}
              onClick={() => handleNav(id)}
              className={[
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-takus-primary/20 text-takus-primary-light'
                  : 'text-white/50 hover:text-white hover:bg-white/[0.05]',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} className={active ? 'text-takus-primary-light' : 'text-white/40'} />
              {label}
              {active && (
                <motion.div
                  className="ml-auto w-1.5 h-1.5 rounded-full bg-takus-primary-light"
                  layoutId="nav-dot"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/[0.04]">
        <p className="text-[10px] text-white/20 text-center">Takus v2.0.0-alpha</p>
      </div>
    </motion.aside>
  );
}
