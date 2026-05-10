import React, { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './Header.jsx';
import { Sidebar } from './Sidebar.jsx';
import { WorkspacePane } from './WorkspacePane.jsx';
import { AgentConsole } from './AgentConsole.jsx';
import { useUi } from '@store/index.js';

export function AppShell() {
  const { sidebarOpen, setSidebarOpen, sourcePanelWidth, setSourcePanelWidth } = useUi();

  const handleDividerDrag = useCallback((e) => {
    const startX = e.clientX;
    const startWidth = sourcePanelWidth;
    const totalWidth = window.innerWidth - 240; // subtract sidebar

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const newWidth = startWidth + delta / totalWidth;
      setSourcePanelWidth(newWidth);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sourcePanelWidth, setSourcePanelWidth]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#06060f]">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <Sidebar />

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Source pane */}
          <div
            className="flex flex-col overflow-hidden"
            style={{ width: `${sourcePanelWidth * 100}%` }}
          >
            <WorkspacePane />
          </div>

          {/* Resize divider */}
          <div
            className="w-1 bg-white/[0.04] hover:bg-takus-primary/40 cursor-col-resize flex-shrink-0 transition-colors duration-150"
            onMouseDown={handleDividerDrag}
          />

          {/* Agent Console */}
          <div
            className="flex flex-col overflow-hidden"
            style={{ width: `${(1 - sourcePanelWidth) * 100}%` }}
          >
            <AgentConsole />
          </div>
        </div>
      </div>
    </div>
  );
}
