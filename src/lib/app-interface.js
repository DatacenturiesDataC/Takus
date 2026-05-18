// Takus — App Interface Contract
// Every Takus app (built-in or community) implements this interface.
// Analogous to a WordPress plugin's required hooks and metadata.
//
// Apps are self-contained feature units that register their own:
//   - Node types (what data they produce in the graph)
//   - Edge types (what relationships they create)
//   - Step types (what autonomous actions they can perform)
//   - Settings (per-app configuration with defaults)
//   - UI (navigation item + panel rendering)

/**
 * @typedef {'core'|'built-in'|'community'} AppCategory
 *   - core: essential platform apps (cannot be deactivated)
 *   - built-in: ship with Takus, can be deactivated
 *   - community: user-installed (future)
 */

/**
 * @typedef {object} AppNavItem
 * @property {string} id       - Unique nav ID (used for tab switching)
 * @property {string} label    - Tab/nav label
 * @property {string} icon     - Emoji or SVG string for nav
 * @property {number} [order]  - Sort order (lower = further left, default 50)
 * @property {function(): number} [getBadgeCount] - Returns badge number (0 = hidden)
 */

/**
 * @typedef {object} SettingField
 * @property {string} key         - Setting key (namespaced automatically by app manager)
 * @property {string} label       - Human-readable label
 * @property {'text'|'password'|'toggle'|'select'|'number'|'textarea'} type
 * @property {*} defaultValue     - Default value
 * @property {string} [description] - Help text
 * @property {Array<{label: string, value: *}>} [options] - For 'select' type
 * @property {boolean} [syncable]   - Whether this setting is safe to sync to cloud (default: false)
 */

/**
 * @typedef {object} StepTypeDef
 * @property {string} type        - Step type key (e.g. 'ai_transcribe')
 * @property {function} handler   - Async step handler function
 * @property {boolean} [autoApprove] - Whether this step runs without user consent (default: false)
 */

/**
 * @typedef {object} QuickAction
 * An action contributed to the Quick Actions bar on the main screen.
 * @property {string} id        - Unique action ID within the app (e.g. 'record', 'upload')
 * @property {string} label     - Button label
 * @property {string} icon      - SVG or emoji for the button
 * @property {boolean} [primary] - If true, rendered as the hero/CTA action (default: false)
 * @property {function(): void|Promise<void>} handler - Click handler
 */

/**
 * @typedef {object} AutoRunPreset
 * A suggested Auto-Run rule contributed by an app.
 * Presets appear in the Settings panel as "Suggested rules" that users can enable.
 * @property {'type'|'source'|'title'|'participant'} field - Field to match against
 * @property {'equals'|'contains'|'startsWith'} operator - Match operator
 * @property {string} value    - Value to match
 * @property {string} label    - Human-readable name (e.g. 'Auto-run: process meetings')
 * @property {string} description - Explanation shown to the user
 */

/**
 * @typedef {object} PlatformServices
 * Services injected into the app by the platform on activation.
 * @property {object} graph       - Graph store API (saveNode, getNode, addEdge, etc.)
 * @property {object} tasks       - Task engine API (createStep, executeStep, etc.)
 * @property {object} settings    - App settings API (get, set, getAll)
 * @property {object} notifications - Notification API (toast, desktop, badge)
 * @property {object} events      - Event bus (emit, on, off)
 */

/**
 * @typedef {object} TakusApp
 *
 * @property {string} id           - Unique app identifier (e.g. 'recorder', 'passport')
 * @property {string} name         - Human-readable display name
 * @property {string} version      - Semantic version string
 * @property {string} description  - Short description for the app manager
 * @property {string} icon         - Emoji or SVG string for the app tile
 * @property {AppCategory} category - 'core', 'built-in', or 'community'
 * @property {string[]} [requires] - IDs of apps this app depends on
 *
 * @property {function(PlatformServices): Promise<void>} activate
 *   Called when the app is activated. Receives platform services.
 *   App should register its step types and set up any listeners here.
 *
 * @property {function(): Promise<void>} deactivate
 *   Called when the app is deactivated. Clean up listeners and UI.
 *
 * @property {function(): SettingField[]} getSettingsSchema
 *   Returns the settings schema for this app.
 *   The app manager renders the settings UI from this schema.
 *
 * @property {function(): object} getDefaultSettings
 *   Returns default values for all settings keys.
 *
 * @property {function(HTMLElement): void} [renderSettings]
 *   Optional custom settings renderer (overrides schema-based rendering).
 *
 * @property {function(): AppNavItem|null} getNavItem
 *   Returns nav/tab configuration, or null if no nav entry needed.
 *
 * @property {function(HTMLElement): void} renderPanel
 *   Render the app's main UI into the given container element.
 *
 * @property {function(): string[]} getNodeTypes
 *   Returns the graph node types this app manages (e.g. ['entry']).
 *
 * @property {function(): string[]} getEdgeTypes
 *   Returns the edge types this app creates (e.g. ['HAS_TASK', 'MENTIONED_IN']).
 *
 * @property {function(): StepTypeDef[]} getStepTypes
 *   Returns the step types this app registers with the task engine.
 *
 * @property {function(): QuickAction[]} [getQuickActions]
 *   Returns 0-2 quick actions for the main-screen Quick Actions bar.
 *   Optional — apps without quick actions need not implement this.
 *
 * @property {function(): AutoRunPreset[]} [getAutoRunPresets]
 *   Returns suggested Auto-Run presets for this app.
 *   These appear as "Suggested rules" in the Settings → Auto-Runs section.
 *   Optional — apps without automation presets need not implement this.
 *
 * @property {function(HTMLElement, object): void|Promise<void>} [renderConfigPanel]
 *   Render a configuration panel for the home screen IDLE state.
 *   Called by the AppShell for each active app that implements this.
 *   The callback object provides: { onStateChange: fn } for apps that need
 *   to communicate state back to the shell.
 *   Optional — most apps don't need a config panel.
 *
 * @property {boolean} [canProduceInboxItems]
 *   Whether this app can produce items for the unified inbox.
 */

/**
 * Validate that an object conforms to the TakusApp interface.
 * Throws on missing required fields.
 *
 * @param {object} app - Candidate app object
 * @returns {TakusApp} The validated app
 * @throws {Error} If required fields are missing
 */
export function validateAppManifest(app) {
  const required = ['id', 'name', 'version', 'description', 'icon', 'category'];
  const requiredFns = ['activate', 'deactivate', 'getSettingsSchema', 'getDefaultSettings',
    'getNavItem', 'renderPanel', 'getNodeTypes', 'getEdgeTypes', 'getStepTypes'];

  for (const field of required) {
    if (!app[field]) throw new Error(`App manifest missing required field: ${field}`);
  }
  for (const fn of requiredFns) {
    if (typeof app[fn] !== 'function') {
      throw new Error(`App manifest missing required method: ${fn}()`);
    }
  }

  if (!/^[a-z][a-z0-9_-]*$/.test(app.id)) {
    throw new Error(`App ID must be lowercase alphanumeric with hyphens/underscores: "${app.id}"`);
  }

  return app;
}

/**
 * Create a minimal app stub with defaults for optional fields.
 * Useful for building apps incrementally — provide only what you need,
 * get sensible defaults for the rest.
 *
 * @param {object} partial - Partial app manifest (id, name, icon required)
 * @returns {TakusApp}
 */
export function createAppStub(partial) {
  return {
    version: '1.0.0',
    description: '',
    category: 'built-in',
    requires: [],
    activate: async () => {},
    deactivate: async () => {},
    getSettingsSchema: () => [],
    getDefaultSettings: () => ({}),
    getNavItem: () => null,
    renderPanel: () => {},
    getNodeTypes: () => [],
    getEdgeTypes: () => [],
    getStepTypes: () => [],
    getQuickActions: () => [],
    getAutoRunPresets: () => [],
    renderConfigPanel: null,  // Optional — only apps with home-screen config implement this
    canProduceInboxItems: false,
    ...partial,
  };
}
