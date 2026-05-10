/**
 * Tasks slice
 *
 * agentTasks  — things Takus will autonomously act on (post to Jira, send Slack, etc.)
 * myTasks     — commitments extracted from recordings that the user should act on
 */

/** @returns {import('zustand').StateCreator} */
export const createTaskSlice = (set) => ({
  agentTasks: [],
  myTasks: [],

  addAgentTask: (task) =>
    set((s) => ({ agentTasks: [{ id: crypto.randomUUID(), createdAt: Date.now(), status: 'pending', ...task }, ...s.agentTasks] })),

  updateAgentTask: (id, patch) =>
    set((s) => ({ agentTasks: s.agentTasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  removeAgentTask: (id) =>
    set((s) => ({ agentTasks: s.agentTasks.filter((t) => t.id !== id) })),

  addMyTask: (task) =>
    set((s) => ({ myTasks: [{ id: crypto.randomUUID(), createdAt: Date.now(), done: false, ...task }, ...s.myTasks] })),

  toggleMyTask: (id) =>
    set((s) => ({ myTasks: s.myTasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),

  removeMyTask: (id) =>
    set((s) => ({ myTasks: s.myTasks.filter((t) => t.id !== id) })),

  clearCompletedTasks: () =>
    set((s) => ({ myTasks: s.myTasks.filter((t) => !t.done) })),

  setTasksFromArtifacts: (agentOutput) => {
    const tasks = agentOutput?.decisionLedger ?? agentOutput?.actionItems ?? [];
    set((s) => ({
      myTasks: [
        ...tasks.map((item) => ({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          done: false,
          text: item.commitment ?? item.text,
          recordingId: agentOutput.recordingId,
          timestampMs: item.timestampMs ?? item.clipStartMs,
          assignee: item.assignee ?? null,
          dueDate: item.dueDate ?? null,
        })),
        ...s.myTasks,
      ],
    }));
  },
});
