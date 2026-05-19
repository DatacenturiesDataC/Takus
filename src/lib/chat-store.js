// Takus — Chat Store
// Persistent chat threads stored in the wiki IDB store.
// Each thread contains messages (user + assistant) and metadata.

import { saveWikiEntry, getWikiEntries, deleteWikiEntry } from './storage.js';
import { generateId } from './id.js';

/**
 * @typedef {object} ChatMessage
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 * @property {number} timestamp
 * @property {object[]} [sources] - Source entries referenced
 */

/**
 * @typedef {object} ChatThread
 * @property {string} id
 * @property {string} subject - Auto-generated or user-set thread title
 * @property {number} date - Last updated timestamp
 * @property {string} query - First user message (for wiki compat)
 * @property {string} answer - Last assistant message (for wiki compat)
 * @property {ChatMessage[]} messages
 * @property {boolean} [isThread] - Marks as chat thread (vs legacy wiki entry)
 */

/** Create a new chat thread. */
export function createThread(firstMessage) {
  return {
    id: generateId('chat'),
    subject: firstMessage.slice(0, 60) || 'New conversation',
    date: Date.now(),
    query: firstMessage,
    answer: '',
    messages: [{ role: 'user', content: firstMessage, timestamp: Date.now() }],
    isThread: true,
  };
}

/** Save a thread (upsert). */
export async function saveThread(thread) {
  thread.date = Date.now();
  // Keep wiki-compat fields in sync
  if (thread.messages.length) {
    const lastUser = [...thread.messages].reverse().find(m => m.role === 'user');
    const lastAssistant = [...thread.messages].reverse().find(m => m.role === 'assistant');
    if (lastUser) thread.query = lastUser.content;
    if (lastAssistant) thread.answer = lastAssistant.content;
  }
  await saveWikiEntry(thread);
}

/** Get all threads (newest first). */
export async function getThreads() {
  const all = await getWikiEntries().catch(() => []);
  return all.filter(e => e.isThread);
}

/** Get legacy wiki entries (non-thread). */
export async function getLegacyWiki() {
  const all = await getWikiEntries().catch(() => []);
  return all.filter(e => !e.isThread);
}

/** Delete a thread. */
export async function deleteThread(id) {
  await deleteWikiEntry(id);
}

/**
 * Auto-generate a thread subject from the first few messages using AI.
 * Falls back to the first user message truncated.
 */
export async function generateSubject(messages, apiKey, provider) {
  if (!apiKey || messages.length < 2) {
    const first = messages.find(m => m.role === 'user');
    return first?.content?.slice(0, 50) || 'New conversation';
  }
  try {
    const { generateAnswer } = await import('./ai-engine.js');
    const context = messages.slice(0, 4).map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
    const prompt = `Generate a short title (max 6 words) for this conversation:\n${context}\n\nTitle:`;
    // Use a lightweight call — just need a short string
    const title = await generateAnswer(prompt, [], [], apiKey, provider);
    return title.replace(/^["']|["']$/g, '').trim().slice(0, 60) || 'Conversation';
  } catch { /* non-critical */
    const first = messages.find(m => m.role === 'user');
    return first?.content?.slice(0, 50) || 'Conversation';
  }
}
