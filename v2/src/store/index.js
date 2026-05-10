import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { createUiSlice } from './uiStore.js';
import { createRecordingSlice } from './recordingStore.js';
import { createTaskSlice } from './taskStore.js';
import { createIntegrationsSlice } from './integrationsStore.js';

/**
 * Root Zustand store combining all 4 slices.
 *
 * Persisted to localStorage: ui pillar, agentConsoleTab, integrations connection state.
 * NOT persisted: live recording state, blobs (too large).
 */
export const useStore = create(
  devtools(
    persist(
      (...args) => ({
        ...createUiSlice(...args),
        ...createRecordingSlice(...args),
        ...createTaskSlice(...args),
        ...createIntegrationsSlice(...args),
      }),
      {
        name: 'takus-v2',
        partialize: (state) => ({
          activePillar: state.activePillar,
          agentConsoleTab: state.agentConsoleTab,
          sourcePanelWidth: state.sourcePanelWidth,
          integrations: state.integrations,
          myTasks: state.myTasks,
        }),
      },
    ),
    { name: 'Takus Store' },
  ),
);

// Convenience selector hooks
export const useUi = () => useStore((s) => ({
  activePillar: s.activePillar,
  agentConsoleTab: s.agentConsoleTab,
  sidebarOpen: s.sidebarOpen,
  sourcePanelWidth: s.sourcePanelWidth,
  setActivePillar: s.setActivePillar,
  setAgentConsoleTab: s.setAgentConsoleTab,
  toggleSidebar: s.toggleSidebar,
  setSidebarOpen: s.setSidebarOpen,
  setSourcePanelWidth: s.setSourcePanelWidth,
}));

export const useRecording = () => useStore((s) => ({
  ...s.recording,
  setRecordingState: s.setRecordingState,
  setRecordingType: s.setRecordingType,
  startRecording: s.startRecording,
  pauseRecording: s.pauseRecording,
  resumeRecording: s.resumeRecording,
  finishRecording: s.finishRecording,
  setArtifacts: s.setArtifacts,
  appendDomSnapshot: s.appendDomSnapshot,
  appendConsoleEntry: s.appendConsoleEntry,
  setUploadProgress: s.setUploadProgress,
  setDriveLink: s.setDriveLink,
  setRecordingError: s.setRecordingError,
  resetRecording: s.resetRecording,
}));

export const useTasks = () => useStore((s) => ({
  agentTasks: s.agentTasks,
  myTasks: s.myTasks,
  addAgentTask: s.addAgentTask,
  updateAgentTask: s.updateAgentTask,
  removeAgentTask: s.removeAgentTask,
  addMyTask: s.addMyTask,
  toggleMyTask: s.toggleMyTask,
  removeMyTask: s.removeMyTask,
  clearCompletedTasks: s.clearCompletedTasks,
  setTasksFromArtifacts: s.setTasksFromArtifacts,
}));

export const useIntegrations = () => useStore((s) => ({
  integrations: s.integrations,
  connectIntegration: s.connectIntegration,
  disconnectIntegration: s.disconnectIntegration,
  updateIntegration: s.updateIntegration,
}));
