/** @returns {import('zustand').StateCreator} */
export const createUiSlice = (set) => ({
  // State
  activePillar: 'record',
  agentConsoleTab: 'chat',
  sidebarOpen: false,
  sourcePanelWidth: 0.7,

  // Actions
  setActivePillar: (pillar) => set({ activePillar: pillar }),
  setAgentConsoleTab: (tab) => set({ agentConsoleTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSourcePanelWidth: (width) => set({ sourcePanelWidth: Math.min(0.85, Math.max(0.5, width)) }),
});
