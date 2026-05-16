// Takus — Node Registry (App Platform: Graph Foundation)
// Manages node type definitions and validation for the unified graph store.
// Apps register their node types here during activation.
//
// The node registry is the schema layer above the raw IDB `nodes` store.
// It ensures that every node in the graph has a valid type and required fields.

/**
 * @typedef {object} NodeTypeDef
 * @property {string} type           - Node type key (e.g. 'recording', 'person')
 * @property {string} label          - Human-readable label
 * @property {string} icon           - Emoji or SVG for display
 * @property {string} appId          - ID of the app that owns this type
 * @property {string[]} requiredProps - Property keys that must be present
 * @property {function(object): object} [validate] - Optional custom validator
 */

/** @type {Map<string, NodeTypeDef>} */
const _types = new Map();

// ── Registration ───────────────────────────────────────────────────────────

/**
 * Register a node type.
 * Called by apps during activation via the app manager.
 *
 * @param {NodeTypeDef} typeDef
 * @throws {Error} If type key is missing or already registered by a different app
 */
export function registerNodeType(typeDef) {
  if (!typeDef?.type) throw new Error('Node type definition requires a "type" key');

  const existing = _types.get(typeDef.type);
  if (existing && existing.appId !== typeDef.appId) {
    throw new Error(`Node type "${typeDef.type}" already registered by app "${existing.appId}"`);
  }

  _types.set(typeDef.type, {
    type: typeDef.type,
    label: typeDef.label || typeDef.type,
    icon: typeDef.icon || '📄',
    appId: typeDef.appId || 'unknown',
    requiredProps: typeDef.requiredProps || [],
    validate: typeDef.validate || null,
  });
}

/**
 * Register multiple node types at once.
 * @param {NodeTypeDef[]} defs
 */
export function registerNodeTypes(defs) {
  for (const def of defs) registerNodeType(def);
}

/**
 * Unregister all node types owned by a specific app.
 * Called when an app is deactivated.
 * @param {string} appId
 */
export function unregisterAppNodeTypes(appId) {
  for (const [key, def] of _types) {
    if (def.appId === appId) _types.delete(key);
  }
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Get a node type definition.
 * @param {string} type
 * @returns {NodeTypeDef|null}
 */
export function getNodeType(type) {
  return _types.get(type) || null;
}

/**
 * Get all registered node types.
 * @returns {NodeTypeDef[]}
 */
export function getAllNodeTypes() {
  return [..._types.values()];
}

/**
 * Get all node types registered by a specific app.
 * @param {string} appId
 * @returns {NodeTypeDef[]}
 */
export function getNodeTypesForApp(appId) {
  return [..._types.values()].filter(t => t.appId === appId);
}

/**
 * Check if a node type is registered.
 * @param {string} type
 * @returns {boolean}
 */
export function hasNodeType(type) {
  return _types.has(type);
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a node object against its registered type.
 * Checks: type exists, required fields present, custom validator passes.
 *
 * @param {object} node
 * @returns {{ valid: boolean, error?: string, node?: object }}
 */
export function validateNode(node) {
  if (!node || typeof node !== 'object') {
    return { valid: false, error: 'Node must be a non-null object' };
  }
  if (!node.id || typeof node.id !== 'string') {
    return { valid: false, error: 'Node must have a string "id" field' };
  }
  if (!node.type || typeof node.type !== 'string') {
    return { valid: false, error: 'Node must have a string "type" field' };
  }

  const typeDef = _types.get(node.type);
  if (!typeDef) {
    // Allow unknown types with a warning — extensibility over strictness
    return { valid: true, node };
  }

  // Check required properties
  for (const prop of typeDef.requiredProps) {
    if (node.properties && !(prop in node.properties) && !(prop in node)) {
      return { valid: false, error: `Node of type "${node.type}" missing required property: ${prop}` };
    }
  }

  // Run custom validator if defined
  if (typeDef.validate) {
    try {
      const cleaned = typeDef.validate(node);
      if (cleaned === null || cleaned === false) {
        return { valid: false, error: `Custom validator rejected node of type "${node.type}"` };
      }
      return { valid: true, node: typeof cleaned === 'object' ? cleaned : node };
    } catch (err) {
      return { valid: false, error: `Validator error for "${node.type}": ${err.message}` };
    }
  }

  return { valid: true, node };
}

/**
 * Create a new node with standard fields pre-populated.
 *
 * @param {string} type - Node type key
 * @param {object} properties - Node-specific properties
 * @param {object} [options]
 * @param {string} [options.id] - Override the auto-generated ID
 * @param {string} [options.state] - Initial state (default: 'active')
 * @param {string} [options.appId] - Owning app ID (auto-resolved from type if registered)
 * @returns {object} A new node object ready for saveNode()
 */
export function createNode(type, properties = {}, options = {}) {
  const typeDef = _types.get(type);
  const now = Date.now();
  // Inline ID generation to avoid circular imports with id.js
  const id = options.id || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    type,
    state: options.state || 'active',
    appId: options.appId || typeDef?.appId || 'unknown',
    properties: { ...properties },
    createdAt: now,
    updatedAt: now,
  };
}

// ── Test Helpers ────────────────────────────────────────────────────────────

/** @internal Reset all registered types — for testing only */
export function _resetForTest() {
  _types.clear();
}
