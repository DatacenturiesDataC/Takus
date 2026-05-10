const DEFAULT_INTEGRATION = { connected: false };

/** @returns {import('zustand').StateCreator} */
export const createIntegrationsSlice = (set) => ({
  integrations: {
    github: { ...DEFAULT_INTEGRATION, user: null, repos: [] },
    jira:   { ...DEFAULT_INTEGRATION, domain: null },
    slack:  { ...DEFAULT_INTEGRATION, workspace: null },
    notion: { ...DEFAULT_INTEGRATION, workspace: null },
  },

  connectIntegration: (service, data) =>
    set((s) => ({
      integrations: {
        ...s.integrations,
        [service]: { connected: true, ...data },
      },
    })),

  disconnectIntegration: (service) =>
    set((s) => ({
      integrations: {
        ...s.integrations,
        [service]: { ...DEFAULT_INTEGRATION },
      },
    })),

  updateIntegration: (service, patch) =>
    set((s) => ({
      integrations: {
        ...s.integrations,
        [service]: { ...s.integrations[service], ...patch },
      },
    })),
});
