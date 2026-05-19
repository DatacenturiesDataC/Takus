// Takus — Tasks App (App Platform Wrapper)
// Wraps global task management and step execution as a self-contained app.

import { createAppStub } from '../../lib/app-interface.js';

export const TasksApp = createAppStub({
  id: 'tasks',
  name: 'Tasks',
  version: '1.0.0',
  description: 'Track and manage action items, bug reports, and follow-ups across all entries.',
  icon: '⚡',
  category: 'core',
  requires: [],

  async activate(platform) {
    this._platform = platform;
    this._pendingCount = 0;

    // Register the 'task' node type with the graph
    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'task',
        label: 'Task',
        icon: '⚡',
        appId: 'tasks',
        requiredProps: ['title', 'status'],
        validate: (node) => {
          const p = node.properties || {};
          const valid = ['pending', 'done', 'ignored'];
          if (p.status && !valid.includes(p.status)) return null;
          return node;
        },
      });
    } catch { /* non-critical */ }

    // Load initial pending count
    try {
      const { getTaskCounts } = await import('../../lib/graph/task-store.js');
      const counts = await getTaskCounts();
      this._pendingCount = counts.pending;
    } catch { /* non-critical */ }
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'showIgnored', label: 'Show Ignored Tasks', type: 'toggle',
        defaultValue: false, description: 'Include ignored tasks in the task list',
      },
    ];
  },

  getDefaultSettings() {
    return { showIgnored: false };
  },

  getNavItem() {
    return {
      id: 'tasks',
      label: 'Tasks',
      icon: '⚡',
      order: 20,
      getBadgeCount: () => this._pendingCount || 0,
    };
  },

  async renderPanel(container) {
    const { renderGlobalTasksPanel } = await import('../../components/global-tasks-panel.js');
    renderGlobalTasksPanel(container);
  },

  getNodeTypes() { return ['task']; },
  getEdgeTypes() { return ['ASSIGNED_TO', 'DERIVED_FROM']; },
  getStepTypes() { return []; }, // Steps are registered by other apps

  getAutoRunPresets() {
    return [
      {
        field: 'type', operator: 'equals', value: 'standup',
        label: 'Auto-run: extract tasks from standups',
        description: 'Automatically extract and route action items from standup entries',
      },
      {
        field: 'type', operator: 'equals', value: 'bug_report',
        label: 'Auto-run: create bug tickets',
        description: 'Automatically create bug report tasks from bug report entries',
      },
    ];
  },

  canProduceInboxItems: false,
});

export default TasksApp;
