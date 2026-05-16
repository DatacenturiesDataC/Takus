// Takus — Recording Templates (Phase 52)
// Pre-configured processing profiles for different recording types.
// Each template defines which AI steps to run, what to extract, and
// default settings for that recording type.
//
// Templates are registered with the template registry and selected
// at recording creation time.

import { generateId } from './id.js';

/**
 * @typedef {object} RecordingTemplate
 * @property {string} id — Unique template identifier
 * @property {string} name — Display name
 * @property {string} description — What this template is for
 * @property {string} type — Recording type (meeting, screen, voice_note, etc.)
 * @property {string} icon — Emoji icon
 * @property {string[]} steps — Step types to auto-queue after recording
 * @property {object} defaults — Default recording settings
 * @property {object} [extraction] — What to extract
 * @property {boolean} [extraction.tasks=true]
 * @property {boolean} [extraction.decisions=true]
 * @property {boolean} [extraction.contacts=true]
 * @property {boolean} [extraction.analytics=true]
 * @property {object} [processing] — Processing options
 * @property {boolean} [processing.autoTranscribe=true]
 * @property {boolean} [processing.autoSummarize=true]
 */

// ── Template Registry ────────────────────────────────────────────────────────

/** @type {Map<string, RecordingTemplate>} */
const _templates = new Map();

/**
 * Register a recording template.
 * @param {RecordingTemplate} template
 */
export function registerTemplate(template) {
  if (!template.id) template.id = generateId('tmpl');
  _templates.set(template.id, template);
}

/**
 * Get all registered templates.
 * @returns {RecordingTemplate[]}
 */
export function getTemplates() {
  return [..._templates.values()];
}

/**
 * Get a template by ID.
 * @param {string} id
 * @returns {RecordingTemplate|undefined}
 */
export function getTemplate(id) {
  return _templates.get(id);
}

/**
 * Get templates for a specific recording type.
 * @param {string} type
 * @returns {RecordingTemplate[]}
 */
export function getTemplatesForType(type) {
  return [..._templates.values()].filter(t => t.type === type);
}

/**
 * Apply a template to a recording context.
 * Returns the step sequence and settings to use.
 *
 * @param {string} templateId
 * @returns {{ steps: string[], extraction: object, processing: object, defaults: object } | null}
 */
export function applyTemplate(templateId) {
  const template = _templates.get(templateId);
  if (!template) return null;

  return {
    steps: [...(template.steps || ['ai_transcribe', 'ai_summarize', 'ai_extract_tasks', 'ai_analytics'])],
    extraction: {
      tasks: true,
      decisions: true,
      contacts: true,
      analytics: true,
      ...template.extraction,
    },
    processing: {
      autoTranscribe: true,
      autoSummarize: true,
      ...template.processing,
    },
    defaults: { ...template.defaults },
  };
}

// ── Built-in Templates ───────────────────────────────────────────────────────

registerTemplate({
  id: 'tmpl_standup',
  name: 'Daily Standup',
  description: 'Quick standup — extracts blockers, decisions, and action items',
  type: 'meeting',
  icon: '🌅',
  steps: ['ai_transcribe', 'ai_summarize', 'ai_extract_tasks'],
  defaults: { maxDuration: 15 * 60 },
  extraction: { tasks: true, decisions: true, contacts: false, analytics: false },
  processing: { autoTranscribe: true, autoSummarize: true },
});

registerTemplate({
  id: 'tmpl_planning',
  name: 'Sprint Planning',
  description: 'Sprint planning — full extraction with analytics and goal linking',
  type: 'meeting',
  icon: '📋',
  steps: ['ai_transcribe', 'ai_summarize', 'ai_extract_tasks', 'ai_analytics'],
  defaults: {},
  extraction: { tasks: true, decisions: true, contacts: true, analytics: true },
  processing: { autoTranscribe: true, autoSummarize: true },
});

registerTemplate({
  id: 'tmpl_one_on_one',
  name: '1:1 Meeting',
  description: 'One-on-one — extracts feedback, action items, and personal notes',
  type: 'meeting',
  icon: '🤝',
  steps: ['ai_transcribe', 'ai_summarize', 'ai_extract_tasks'],
  defaults: {},
  extraction: { tasks: true, decisions: true, contacts: true, analytics: false },
  processing: { autoTranscribe: true, autoSummarize: true },
});

registerTemplate({
  id: 'tmpl_demo',
  name: 'Product Demo',
  description: 'Screen recording demo — transcription with quality score',
  type: 'screen',
  icon: '🖥️',
  steps: ['ai_transcribe', 'ai_summarize', 'ai_analytics'],
  defaults: {},
  extraction: { tasks: false, decisions: false, contacts: false, analytics: true },
  processing: { autoTranscribe: true, autoSummarize: true },
});

registerTemplate({
  id: 'tmpl_bug_report',
  name: 'Bug Report',
  description: 'Screen recording for bug reproduction — extracts steps and issues',
  type: 'screen',
  icon: '🐛',
  steps: ['ai_transcribe', 'ai_summarize', 'ai_extract_tasks'],
  defaults: {},
  extraction: { tasks: true, decisions: false, contacts: false, analytics: false },
  processing: { autoTranscribe: true, autoSummarize: true },
});

registerTemplate({
  id: 'tmpl_voice_memo',
  name: 'Voice Memo',
  description: 'Quick voice note — transcription and task extraction',
  type: 'voice_note',
  icon: '🎙️',
  steps: ['ai_transcribe', 'ai_extract_tasks'],
  defaults: { maxDuration: 5 * 60 },
  extraction: { tasks: true, decisions: true, contacts: false, analytics: false },
  processing: { autoTranscribe: true, autoSummarize: false },
});

registerTemplate({
  id: 'tmpl_brainstorm',
  name: 'Brainstorm Session',
  description: 'Creative session — full extraction with idea clustering',
  type: 'meeting',
  icon: '💡',
  steps: ['ai_transcribe', 'ai_summarize', 'ai_extract_tasks', 'ai_analytics'],
  defaults: {},
  extraction: { tasks: true, decisions: true, contacts: true, analytics: true },
  processing: { autoTranscribe: true, autoSummarize: true },
});

registerTemplate({
  id: 'tmpl_interview',
  name: 'Interview',
  description: 'Interview recording — transcription with speaker notes',
  type: 'meeting',
  icon: '🎯',
  steps: ['ai_transcribe', 'ai_summarize'],
  defaults: {},
  extraction: { tasks: false, decisions: true, contacts: true, analytics: false },
  processing: { autoTranscribe: true, autoSummarize: true },
});
