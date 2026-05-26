// Takus — AI Engine (OpenAI Integration)

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';

import { getPromptPreferences } from './preference-engine.js';
import { isEnabled } from './feature-flags.js';
import { configureLimit, consume } from './rate-limiter.js';
import { getWorkContext } from '../apps/passport/index.js';

// Configure default API rate limits (protective, not restrictive)
configureLimit('openai', { maxRequests: 10, windowMs: 60_000 });   // 10 req/min
configureLimit('gemini', { maxRequests: 30, windowMs: 60_000 });   // 30 req/min

/**
 * Build a one-liner describing the user's work context for system prompts.
 * Returns '' if neither role nor company is set in the passport.
 */
function _buildWorkContextLine() {
  try {
    const ctx = getWorkContext();
    if (!ctx.role && !ctx.company) return '';
    const parts = [];
    if (ctx.role) parts.push(ctx.role);
    if (ctx.company) parts.push(`at ${ctx.company}`);
    let line = `The user is a ${parts.join(' ')}`;
    if (ctx.projects.length > 0) {
      line += `, working on: ${ctx.projects.join(', ')}`;
    }
    return line + '.';
  } catch {
    return '';
  }
}

/** Fetch with an AbortController timeout (ms). Throws a clear message on timeout. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch with timeout + automatic retry on transient failures.
 * Retries on 429 (rate-limited) and 5xx (server error) with backoff.
 * Respects `Retry-After` header from 429 responses when present.
 * Client errors (4xx except 429) are returned immediately without retry.
 */
async function fetchWithRetry(url, options, timeoutMs, maxRetries = 2) {
  let backoffMs = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, backoffMs));
    }
    backoffMs = Math.min(2000 * Math.pow(2, attempt), 30000) * (0.8 + Math.random() * 0.4); // exponential backoff with jitter
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      const isTransient = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (isTransient && attempt < maxRetries) {
        // Respect Retry-After header if present (value is in seconds)
        const retryAfter = res.headers.get('Retry-After');
        if (retryAfter) {
          const secs = Number(retryAfter);
          if (!isNaN(secs) && secs > 0 && secs <= 120) {
            backoffMs = secs * 1000;
          }
        }
        continue;
      }
      return res;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      // Network/timeout error — retry
    }
  }
  // Safety: should never reach here, but if it does, throw rather than return undefined
  throw new Error('All retry attempts exhausted');
}

/**
 * Send a request through the workspace AI proxy.
 * Used when workspace members share a centrally-managed AI key.
 *
 * @param {string} proxyUrl   Base proxy URL (e.g. '/api/ai-proxy')
 * @param {string} endpoint   Proxy sub-endpoint (e.g. 'transcribe', 'chat')
 * @param {*}      body       Request body (object for JSON, FormData for multipart)
 * @param {string} wsId       Workspace ID
 * @param {string} memberToken Member auth token
 * @param {boolean} [isFormData=false] Whether body is FormData (skips JSON serialization)
 * @returns {Promise<object>} Parsed JSON response
 */
async function _proxyFetch(proxyUrl, endpoint, body, wsId, memberToken, isFormData = false) {
  const headers = {
    'x-workspace-id': wsId,
    'x-member-token': memberToken,
  };
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const res = await fetchWithRetry(`${proxyUrl}/${endpoint}`, {
    method: 'POST',
    headers,
    body: isFormData ? body : JSON.stringify(body),
  }, 120_000, 1); // 2 minute timeout, 1 retry — proxy may be slower than direct API
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Proxy request failed');
    throw new Error(`AI proxy error (${res.status}): ${errText}`);
  }
  return res.json();
}

const PROMPTS = {
  meeting: {
    system: 'You are a concise, professional meeting assistant. Use clear markdown formatting.',
    user: (transcript, truncationNote, dissentEnabled = true) => `You are an expert meeting assistant. Below is the transcript of a recorded meeting.

Provide a structured response with these sections:
## Summary
2–3 sentences covering the key points discussed.

## Action Items
Bulleted list of concrete next steps with owners where mentioned (if none, write "None identified").

## Key Decisions
Bulleted list of decisions reached during the meeting (if none, write "None recorded").

## Decision Ledger
A markdown table of commitments made. Use exactly this format (include header row):
| Commitment | Owner | Due |
|---|---|---|
List every concrete commitment. If none, write a single row: | None recorded | — | — |

## Sentiment
One sentence describing the overall tone (e.g. collaborative, tense, informational).
${dissentEnabled ? `
## Dissent & Open Questions
- List any disagreements, unresolved tensions, or competing viewpoints expressed during the meeting.
- Flag assumptions made without explicit evidence or consensus.
- Note topics that were raised but not fully addressed or deferred.
If none, write "No significant dissent noted."
` : ''}
${truncationNote}
Transcript:
${transcript}`,
  },
  screen: {
    system: 'You are a concise technical documentation assistant. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert technical writer. Below is the narration transcript from a screen entry.

Provide a structured response with these sections:
## Overview
1–2 sentences describing what this screen entry demonstrates.

## Key Steps Demonstrated
Numbered list of the main actions or steps shown in the entry.

## Bug Report
If a bug or issue is shown, fill in this card (otherwise write "Not applicable"):
- **Element / Component:** (what was clicked or interacted with)
- **Steps to Reproduce:** (numbered steps)
- **Expected behaviour:**
- **Actual behaviour:**

## Technical Notes
Bulleted list of any notable tools, commands, settings or configurations mentioned (if none, write "None identified").
${truncationNote}
Narration transcript:
${transcript}`,
  },
  presentation: {
    system: 'You are a concise presentation analyst. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert presentation coach. Below is the transcript of a recorded presentation.

Provide a structured response with these sections:
## Presentation Summary
2–3 sentences covering the central message and topic of the presentation.

## Key Points
Bulleted list of the main points or arguments made.

## Chapter List
Ordered list of the main sections or topics covered, with approximate timestamps where mentioned (format: "1. [~00:02] Slide title or topic"). If no timestamps are detectable, omit them.

## Audience Takeaways
Bulleted list of what the audience should remember or act on after watching.
${truncationNote}
Transcript:
${transcript}`,
  },
  update: {
    system: 'You are a concise async-update summariser. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert at distilling quick status updates into shareable summaries. Below is the transcript of a recorded status update.

Provide a structured response with these sections:
## TL;DR
3–5 bullet points covering what was completed, what is in progress, and any blockers.

## Ticket / Issue References
List any ticket IDs, issue numbers, PR numbers, or Jira/Linear references mentioned (format: "- PROJ-123: brief description"). If none, write "None mentioned".

## Blockers & Risks
Bulleted list of anything blocking progress or at risk (if none, write "None identified").

## Next Steps
Bulleted list of the immediate next actions planned.
${truncationNote}
Transcript:
${transcript}`,
  },

  // ── Document-type prompts ──────────────────────────────────────────────
  document: {
    system: 'You are a concise document analyst. Use clear markdown formatting.',
    user: (text, truncationNote) => `You are an expert document analyst. Below is the text content of an imported document.

Provide a structured response with these sections:
## Summary
2–3 sentences covering the key points of this document.

## Key Points
Bulleted list of the main arguments, findings, or information presented.

## References & Links
List any URLs, citations, or external references mentioned (if none, write "None found").

## Action Items
Bulleted list of any tasks, to-dos, or follow-ups mentioned (if none, write "None identified").
${truncationNote}
Document content:
${text}`,
  },
  markdown: {
    system: 'You are a knowledge curator and note organizer. Use clear markdown formatting.',
    user: (text, truncationNote) => `You are an expert knowledge curator. Below is a markdown note or document.

Provide a structured response with these sections:
## Summary
2–3 sentences capturing the essence of this note.

## Key Concepts
Bulleted list of the main ideas, concepts, or topics covered.

## Connections
Identify any references to people, projects, tools, or related topics that could be linked to other knowledge.

## Enhancements
Suggest 1–3 ways this note could be improved or expanded (if applicable, otherwise write "None needed").
${truncationNote}
Markdown content:
${text}`,
  },
  email: {
    system: 'You are an email intelligence assistant. Use clear markdown formatting.',
    user: (text, truncationNote) => `You are an expert email analyst. Below is the content of an email or email thread.

Provide a structured response with these sections:
## Summary
2–3 sentences covering what this email thread is about.

## Action Items
Bulleted list of tasks or follow-ups requested or implied (with owners where mentioned). If none, write "None identified".

## Commitments Made
Bulleted list of any promises, deadlines, or commitments made by any party. If none, write "None recorded".

## Follow-Up Required
List any items that need a response or follow-up, with urgency level (if none, write "None required").

## Sentiment
One sentence describing the overall tone of the communication.
${truncationNote}
Email content:
${text}`,
  },
  note: {
    system: 'You are a note organizer and enhancer. Use clear markdown formatting.',
    user: (text, truncationNote) => `You are an expert at organizing and enhancing notes. Below is a free-form note.

Provide a structured response with these sections:
## Summary
1–2 sentences capturing the purpose of this note.

## Organized Content
Restructure the note content into clear sections with headers and bullet points.

## Action Items
Bulleted list of any tasks or to-dos mentioned (if none, write "None identified").

## Tags
Suggest 3–5 relevant tags or keywords for this note.
${truncationNote}
Note content:
${text}`,
  },
  bookmark: {
    system: 'You are a web content analyst. Use clear markdown formatting.',
    user: (text, truncationNote) => `You are an expert at extracting key information from web content. Below is the saved content of a bookmark.

Provide a structured response with these sections:
## Summary
2–3 sentences describing what this content is about.

## Key Takeaways
Bulleted list of the most important points or insights.

## Related Topics
List any related topics, tools, or concepts worth exploring further.
${truncationNote}
Content:
${text}`,
  },
  chat: {
    system: 'You are a chat conversation analyst. Use clear markdown formatting.',
    user: (text, truncationNote) => `You are an expert at analysing team chat conversations. Below is a chat message or thread from a messaging platform.

Provide a structured response with these sections:
## Summary
2–3 sentences capturing the core topic and outcome of this conversation.

## Key Decisions
Bulleted list of any decisions made or conclusions reached.

## Action Items
Bulleted list of tasks, follow-ups, or commitments mentioned.

## Context
Any important context: participants, referenced projects, deadlines, or dependencies.
${truncationNote}
Chat content:
${text}`,
  },
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Main entry point for AUDIO content. Supports two AI providers:
 *   provider='openai'  — Whisper STT + GPT-4o-mini summary (apiKey = OpenAI key)
 *   provider='gemini'  — Gemini 1.5 Flash for both transcription and summary (apiKey = Gemini key)
 */
export async function generateTranscriptionAndSummary(audioBlob, apiKey, type = 'screen', provider = 'openai', config = null) {
  // When config with proxy is provided, apiKey check is skipped (key lives on server)
  if (!config?.useProxy && !apiKey) throw new Error('API key is required. Add one in Settings → AI Provider.');

  // Rate limit check — protect against accidental rapid-fire processing
  const limiterKey = (config?.provider || provider) === 'gemini' ? 'gemini' : 'openai';
  const limitResult = consume(limiterKey);
  if (!limitResult.allowed) {
    const waitSec = Math.ceil(limitResult.retryAfter / 1000);
    throw new Error(`Rate limit reached — please wait ${waitSec}s before processing another entry.`);
  }

  // Proxy mode — route through workspace AI proxy
  if (config?.useProxy && config.proxyUrl) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('type', type);
    formData.append('provider', config.provider || provider);
    return _proxyFetch(config.proxyUrl, 'transcribe', formData, config.workspaceId, config.memberToken, true);
  }

  if ((config?.provider || provider) === 'gemini') return _geminiFlow(audioBlob, apiKey, type);
  return _openaiFlow(audioBlob, apiKey, type);
}

/**
 * Summarize text content directly — NO audio transcription step.
 * This is the proper path for documents, emails, notes, and bookmarks.
 * Uses the same type-aware prompts as the audio pipeline but skips Whisper/Gemini STT.
 *
 * @param {string} text     The document text to summarize
 * @param {string} apiKey   API key for the provider
 * @param {string} type     Content type (document, markdown, email, note, bookmark)
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<{summary: string}>}
 */
export async function summarizeText(text, apiKey, type = 'document', provider = 'openai', config = null) {
  if (!config?.useProxy && !apiKey) throw new Error('API key is required. Add one in Settings → AI Provider.');
  if (!text || typeof text !== 'string') throw new Error('Text content is required for summarization.');

  const limiterKey = provider === 'gemini' ? 'gemini' : 'openai';
  const limitResult = consume(limiterKey);
  if (!limitResult.allowed) {
    const waitSec = Math.ceil(limitResult.retryAfter / 1000);
    throw new Error(`Rate limit reached — please wait ${waitSec}s before processing.`);
  }

  const MAX_TEXT_CHARS = 50_000;
  let truncatedText = text;
  let truncationNote = '';
  if (text.length > MAX_TEXT_CHARS) {
    truncatedText = text.slice(0, MAX_TEXT_CHARS);
    truncationNote = `\n\n[Note: Content truncated from ${text.length} to ${MAX_TEXT_CHARS} characters.]`;
  }

  const promptDef = PROMPTS[type] || PROMPTS.document;
  const adaptiveHint = await _buildAdaptiveHint(type);
  const dissentEnabled = await isEnabled('dissent');
  const prompt = promptDef.user(truncatedText, truncationNote, dissentEnabled) + adaptiveHint;

  // Proxy mode — route through workspace AI proxy
  if (config?.useProxy && config.proxyUrl) {
    return _proxyFetch(config.proxyUrl, 'chat', {
      prompt, systemPrompt: promptDef.system, type,
      provider: config.provider || provider,
    }, config.workspaceId, config.memberToken);
  }

  if (provider === 'gemini') {
    const requestBody = {
      contents: [{ parts: [{ text: `${promptDef.system}${_buildWorkContextLine() ? ' ' + _buildWorkContextLine() : ''}\n\n${prompt}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    };

    const geminiRes = await fetchWithRetry(
      GEMINI_API_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(requestBody) },
      60_000,
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API failed: ${geminiRes.status}`);
    }

    const data = await geminiRes.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!summary) throw new Error('AI returned an empty summary.');
    return { summary };
  }

  // OpenAI path — direct GPT-4o-mini call (no Whisper)
  const chatRes = await fetchWithRetry(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: promptDef.system + (_buildWorkContextLine() ? ' ' + _buildWorkContextLine() : '') },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  }, 60_000);

  if (!chatRes.ok) {
    const err = await chatRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Chat API failed: ${chatRes.status}`);
  }

  const chatData = await chatRes.json();
  const summary = chatData.choices[0]?.message?.content || '';
  if (!summary) throw new Error('AI returned an empty summary.');
  return { summary };
}

/**
 * Build an adaptive prompt hint based on accumulated user preferences
 * and the user's active goals.
 * Returns a string to append to the user prompt, or '' if no adaptation.
 * @param {string} type  Entry type
 * @returns {Promise<string>}
 */
async function _buildAdaptiveHint(type) {
  try {
    if (!await isEnabled('adaptiveAI')) return '';

    const hints = [];

    // Preference-based adaptation
    const prefs = await getPromptPreferences(type);
    if (prefs.hasEnoughData) {
      if (prefs.summaryStyle === 'detailed') {
        hints.push('The user prefers detailed summaries — include more specifics about action items, deadlines, and key decisions.');
      }
      if (prefs.ignoredActions.length > 0) {
        hints.push(`The user rarely acts on these task types: ${prefs.ignoredActions.join(', ')}. Deprioritize them.`);
      }
      if (prefs.taskFocus.length > 0) {
        hints.push(`The user prefers these task types: ${prefs.taskFocus.join(', ')}. Focus extraction on these.`);
      }
    }

    // Goal-aware context — inject active goals so AI can extract goal-relevant content
    try {
      const { getNodesByType } = await import('./storage.js');
      const goals = await getNodesByType('goal').catch(() => []);
      const activeGoals = goals
        .filter(g => {
          const state = g.properties?.state || g.state;
          return state === 'active' || state === 'at-risk';
        })
        .sort((a, b) => (b.properties?.mentionCount || 0) - (a.properties?.mentionCount || 0))
        .slice(0, 5);
      if (activeGoals.length > 0) {
        const goalList = activeGoals.map(g => `"${g.properties?.title || 'Untitled'}"`).join(', ');
        hints.push(`The user's active goals are: ${goalList}. When extracting tasks, note which goals each task may relate to in the objective field.`);
      }
    } catch { /* goals unavailable — skip goal context */ }

    return hints.length > 0 ? `\n\n[Adaptive context: ${hints.join(' ')}]` : '';
  } catch (e) {
    console.warn('[AI] Adaptive context failed:', e.message);
    return '';
  }
}


async function _openaiFlow(audioBlob, apiKey, type) {
  // 1. Transcribe audio with Whisper (requesting verbose_json for timestamps)
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  // Whisper can take up to 2 minutes for long entries; retry up to 2× on transient errors
  const whisperRes = await fetchWithRetry(WHISPER_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  }, 120_000);

  if (!whisperRes.ok) {
    const err = await whisperRes.json().catch(() => ({}));
    const msg = err.error?.message || `Whisper API failed: ${whisperRes.status}`;
    if (whisperRes.status === 401) throw new Error('Invalid OpenAI API key — check your key in Settings.');
    if (whisperRes.status === 429) throw new Error('OpenAI rate limit reached — please wait and try again.');
    throw new Error(msg);
  }

  const whisperData = await whisperRes.json();
  const transcript = whisperData.text;

  if (!transcript || transcript.trim().length < 10) {
    throw new Error('Transcription too short or empty — the entry may have no audible speech.');
  }

  const vtt = generateVTT(whisperData.segments || []);

  // 2. Generate summary with GPT-4o-mini
  const MAX_TRANSCRIPT_CHARS = 50_000;
  let truncatedTranscript = transcript;
  let truncationNote = '';
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    truncatedTranscript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    truncationNote = `\n\n[Note: Transcript truncated from ${transcript.length} to ${MAX_TRANSCRIPT_CHARS} characters.]`;
  }

  const promptDef = PROMPTS[type] || PROMPTS.screen;
  const adaptiveHint = await _buildAdaptiveHint(type);
  const dissentEnabled = await isEnabled('dissent');
  const prompt = promptDef.user(truncatedTranscript, truncationNote, dissentEnabled) + adaptiveHint;

  const chatRes = await fetchWithRetry(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: promptDef.system + (_buildWorkContextLine() ? ' ' + _buildWorkContextLine() : '') },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  }, 60_000);

  if (!chatRes.ok) {
    const err = await chatRes.json().catch(() => ({}));
    const msg = err.error?.message || `Chat API failed: ${chatRes.status}`;
    if (chatRes.status === 401) throw new Error('Invalid OpenAI API key — check your key in Settings.');
    if (chatRes.status === 429) throw new Error('OpenAI rate limit reached — please wait and try again.');
    throw new Error(msg);
  }

  const chatData = await chatRes.json();
  const summary = chatData.choices[0]?.message?.content || '';

  if (!summary) {
    throw new Error('AI returned an empty summary — the entry may be too short or the content unclear.');
  }

  return { transcript, summary, vtt };
}

// ─── Gemini flow (single API call: audio → transcript + summary) ─────────────

async function _geminiFlow(audioBlob, apiKey, type) {
  // Gemini 1.5 Flash accepts audio natively — no separate STT step needed.
  // Convert blob to base64 for inline_data (max ~20 MB; extractAudio keeps it small).
  const base64Audio = await _blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

  const promptDef = PROMPTS[type] || PROMPTS.screen;
  const dissentEnabled = await isEnabled('dissent');
  const taskInstruction = promptDef.user('[See audio above]', '', dissentEnabled);

  const requestBody = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Audio } },
        {
          text: `${promptDef.system}${_buildWorkContextLine() ? ' ' + _buildWorkContextLine() : ''}\n\nFirst, produce a full verbatim transcript of the audio enclosed in <transcript>...</transcript> tags.\nThen, provide the following structured analysis:\n\n${taskInstruction}`,
        },
      ],
    }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  };

  const geminiRes = await fetchWithRetry(
    GEMINI_API_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(requestBody) },
    180_000,
  );

  if (!geminiRes.ok) {
    const err = await geminiRes.json().catch(() => ({}));
    const msg = err.error?.message || `Gemini API failed: ${geminiRes.status}`;
    if (geminiRes.status === 400) throw new Error('Gemini API error — check your API key in Settings.');
    if (geminiRes.status === 429) throw new Error('Gemini rate limit reached — please wait and try again.');
    throw new Error(msg);
  }

  const geminiData = await geminiRes.json();
  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!rawText) throw new Error('Gemini returned an empty response — the audio may have no audible speech.');

  // Extract transcript from <transcript>...</transcript> block
  const transcriptMatch = rawText.match(/<transcript>([\s\S]*?)<\/transcript>/i);
  // If Gemini omitted the tags, treat the full response as the summary and leave transcript empty
  // rather than returning a garbled first-10-lines approximation.
  const transcript = transcriptMatch ? transcriptMatch[1].trim() : '';

  // Everything outside/after the transcript tags is the structured summary
  const summary = rawText.replace(/<transcript>[\s\S]*?<\/transcript>/i, '').trim() || rawText.trim();

  return { transcript, summary, vtt: null }; // Gemini doesn't produce VTT segments
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Task Extraction ──────────────────────────────────

/**
 * Extracts structured tasks from a transcript + observer log.
 * Returns { takusTasks, meTasks } — both arrays may be empty.
 *
 * @param {string} transcript
 * @param {{ consoleErrors: Array, networkErrors: Array, actions: Array }} observerLog
 * @param {string} type  entry type
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 */
export async function extractTasks(transcript, observerLog, type, apiKey, provider, config = null) {
  if (!config?.useProxy && !apiKey) return { takusTasks: [], meTasks: [] };
  if (!transcript) return { takusTasks: [], meTasks: [] };

  const errorContext = _buildErrorContext(observerLog);
  const adaptiveHint = await _buildAdaptiveHint(type);
  const prompt = _buildTaskPrompt(transcript, errorContext, type, adaptiveHint);

  let rawJson = '';
  try {
    // Proxy mode — route through workspace AI proxy
    if (config?.useProxy && config.proxyUrl) {
      const result = await _proxyFetch(config.proxyUrl, 'chat', {
        prompt, systemPrompt: 'You are a precise task extractor. Output only valid JSON.',
        type: 'task-extraction', provider: config.provider || provider,
      }, config.workspaceId, config.memberToken);
      // Proxy may return parsed JSON or raw text in a wrapper
      rawJson = typeof result === 'string' ? result : (result.content || result.text || JSON.stringify(result));
    } else if (provider === 'gemini') {
      rawJson = await _geminiTaskExtraction(prompt, apiKey);
    } else {
      rawJson = await _openaiTaskExtraction(prompt, apiKey);
    }
    return _parseTaskJson(rawJson);
  } catch (e) {
    console.warn('[Tasks] Extraction failed:', e.message);
    return { takusTasks: [], meTasks: [] };
  }
}

function _buildErrorContext(log) {
  if (!log) return '';
  const lines = [];
  if (log.consoleErrors?.length) {
    lines.push('Console errors/warnings:');
    log.consoleErrors.slice(0, 10).forEach(e =>
      lines.push(`  [${e.level}] ${e.message}`)
    );
  }
  if (log.networkErrors?.length) {
    lines.push('Failed network requests:');
    log.networkErrors.slice(0, 10).forEach(e =>
      lines.push(`  ${e.method} ${e.url} → ${e.status}`)
    );
  }
  return lines.join('\n');
}

function _buildTaskPrompt(transcript, errorContext, type, adaptiveHint = '') {
  const typeInstructions = {
    meeting: `Focus on:
- Verbal commitments ("I will...", "I'll...", "I'm going to...") → me_tasks
- Delegations ("Can you...", "Could you...") → me_tasks with the assignee name
- Decisions that should be logged → takus_tasks with action LOG_DECISION
- Unresolved topics / conflicts → me_tasks with action FOLLOW_UP`,

    screen: `Focus on:
- Any bug, error, or unexpected behaviour described or shown → takus_tasks with action CREATE_BUG_REPORT
- Use the console/network errors below to populate technical_context
- Any follow-up the speaker mentions doing → me_tasks`,

    presentation: `Focus on:
- Follow-up actions the presenter commits to → me_tasks
- Content that should be shared or distributed → takus_tasks with action DRAFT_SHARE_MESSAGE
- Questions the presenter says they'll answer later → me_tasks`,

    update: `Focus on:
- Ticket IDs or issue numbers mentioned (e.g. TAK-123, #402) → takus_tasks with action UPDATE_TICKET
- Blockers that need escalation → me_tasks with urgency "high"
- Anything the speaker says they'll do next → me_tasks`,

    document: `Focus on:
- Action items mentioned in the document → me_tasks
- Decisions that are documented → takus_tasks with action LOG_DECISION
- References to work that needs to be done → takus_tasks`,

    email: `Focus on:
- Requests from sender to recipient → me_tasks with urgency based on tone
- Commitments made by any party → me_tasks
- Follow-up items mentioned → me_tasks with action FOLLOW_UP
- Decisions communicated → takus_tasks with action LOG_DECISION`,

    note: `Focus on:
- To-do items or tasks listed → me_tasks
- Ideas that need follow-up → me_tasks
- Decisions recorded → takus_tasks with action LOG_DECISION`,

    markdown: `Focus on:
- Action items or TODOs → me_tasks
- Technical tasks mentioned → takus_tasks
- Issues or bugs described → takus_tasks with action CREATE_BUG_REPORT`,

    bookmark: `Focus on:
- Key insights that warrant follow-up → me_tasks
- Tools or resources to evaluate → me_tasks
- Action items inspired by the content → me_tasks`,
    chat: `Focus on:
- Decisions made in the conversation → me_tasks or team_tasks
- Requests or asks from participants → me_tasks
- Commitments or promises made → me_tasks
- Follow-up items mentioned → me_tasks
- Questions that need answers → me_tasks`,
  };

  const instructions = typeInstructions[type] || typeInstructions.document;

  return `You are an AI task extractor. Analyse the following content and extract actionable tasks.

Content type: ${type}
${instructions}

${errorContext ? `\n--- Technical Context ---\n${errorContext}\n---\n` : ''}${adaptiveHint}

Return ONLY a valid JSON object with this exact shape (no markdown fences, no extra text):
{
  "takusTasks": [
    {
      "id": "t-001",
      "action": "CREATE_BUG_REPORT | LOG_DECISION | DRAFT_SHARE_MESSAGE | UPDATE_TICKET | DRAFT_SLACK_MESSAGE | CREATE_CALENDAR_EVENT | DRAFT_EMAIL | UPLOAD_TO_DRIVE",
      "title": "short human-readable title",
      "payload": { "any": "relevant fields" },
      "contextTimestamp": "MM:SS or null",
      "deadline": "ISO 8601 date string (e.g. 2026-06-01) or null if no deadline mentioned",
      "dependsOn": ["t-002"] or null,
      "sequence": 1,
      "integrations": ["jira", "slack"],
      "steps": ["Step 1 description", "Step 2 description"],
      "objective": "The higher-level goal this task supports"
    }
  ],
  "meTasks": [
    {
      "id": "m-001",
      "note": "what the person said they would do",
      "contextTimestamp": "MM:SS or null",
      "deadline": "ISO 8601 date string (e.g. 2026-06-01) or null if no deadline mentioned",
      "urgency": "normal | high",
      "dependsOn": ["m-002"] or null,
      "sequence": 1,
      "steps": ["Step 1 description", "Step 2 description"],
      "objective": "The higher-level goal this task supports"
    }
  ]
}

Rules:
- Return at most 5 takusTasks and 5 meTasks.
- If there are no tasks of a type, return an empty array.
- contextTimestamp should be the approximate timestamp where the commitment was made (MM:SS format), or null if unknown.
- deadline: If a deadline or due date is mentioned (e.g., "by Friday", "end of sprint", "2025-03-15"), include it as an ISO 8601 date string. Use null if no deadline is stated.
- Do not invent tasks not supported by the transcript.
- dependsOn: If task B cannot start until task A completes, set task B's dependsOn to ["<id of task A>"]. Use null if no dependency.
- sequence: Assign integer ordering (1, 2, 3...) if tasks should be done in a specific order. Use null if order doesn't matter.
- integrations: For takusTasks, suggest which integrations could handle the task. Valid values: slack, github, linear, jira, notion, calendar, email, drive. Use an empty array if none apply.
- steps: Break the task into 1–4 concrete sub-steps that move it toward completion. Each step should be an actionable phrase. Use an empty array only if the task is truly atomic.
- objective: Identify the broader goal or outcome this task connects to (e.g., "Ship v2.0 release", "Resolve production incident", "Prepare quarterly review"). Use null if no clear objective.

Transcript:
${transcript.slice(0, 8000)}`;
}

async function _openaiTaskExtraction(prompt, apiKey) {
  const res = await fetchWithRetry(CHAT_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise task extractor. Output only valid JSON.' + (_buildWorkContextLine() ? ' ' + _buildWorkContextLine() : '') },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  }, 60_000);
  if (!res.ok) throw new Error(`Task extraction API error: ${res.status}`);
  const data = await res.json();
  return data.choices[0]?.message?.content || '{}';
}

async function _geminiTaskExtraction(prompt, apiKey) {
  const res = await fetchWithRetry(
    GEMINI_API_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: (_buildWorkContextLine() ? _buildWorkContextLine() + '\n\n' : '') + prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    },
    60_000,
  );
  if (!res.ok) throw new Error(`Gemini task extraction error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

function _parseTaskJson(raw) {
  // Strip markdown code fences if present
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(clean);

    const VALID_INTEGRATIONS = ['slack', 'github', 'linear', 'jira', 'notion', 'calendar', 'email', 'drive'];

    const takusTasks = (parsed.takusTasks || []).slice(0, 5).map((t, i) => ({
      id: t.id || `t-${String(i + 1).padStart(3, '0')}`,
      action: t.action || 'TAKUS_TASK',
      title: t.title || 'Untitled task',
      payload: t.payload || {},
      contextTimestamp: t.contextTimestamp || null,
      deadline: t.deadline || t.due_date || t.dueDate || null,
      // Rich status model (plain data — no getters)
      status: 'pending',
      output: null,
      ignoredReason: null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(d => typeof d === 'string') : null,
      sequence: typeof t.sequence === 'number' ? t.sequence : null,
      integrations: Array.isArray(t.integrations)
        ? t.integrations.filter(ig => VALID_INTEGRATIONS.includes(ig))
        : [],
      steps: Array.isArray(t.steps)
        ? t.steps.filter(s => typeof s === 'string').slice(0, 4).map(s => ({ text: s, done: false, status: 'pending' }))
        : [],
      objective: typeof t.objective === 'string' ? t.objective : null,
      doneAt: null,
      ignoredAt: null,
    }));

    const meTasks = (parsed.meTasks || []).slice(0, 5).map((t, i) => ({
      id: t.id || `m-${String(i + 1).padStart(3, '0')}`,
      note: t.note || '',
      contextTimestamp: t.contextTimestamp || null,
      deadline: t.deadline || t.due_date || t.dueDate || null,
      urgency: t.urgency === 'high' ? 'high' : 'normal',
      // Rich status model
      status: 'pending',
      output: null,
      ignoredReason: null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(d => typeof d === 'string') : null,
      sequence: typeof t.sequence === 'number' ? t.sequence : null,
      steps: Array.isArray(t.steps)
        ? t.steps.filter(s => typeof s === 'string').slice(0, 4).map(s => ({ text: s, done: false, status: 'pending' }))
        : [],
      objective: typeof t.objective === 'string' ? t.objective : null,
      doneAt: null,
      ignoredAt: null,
    }));

    return { takusTasks, meTasks };
  } catch (e) {
    console.warn('[AI] Task JSON parsing failed:', e.message);
    return { takusTasks: [], meTasks: [] };
  }
}

/**
 * Normalize a task object, ensuring all required fields have defaults.
 * Idempotent — safe to call on already-normalized tasks.
 * @param {object} task  Task object from IndexedDB
 * @returns {object}     New task object with all fields guaranteed (does not mutate input)
 */
export function normalizeTask(task) {
  const t = { ...task };
  if (!t.status) t.status = 'pending';
  if (t.output === undefined) t.output = null;
  if (t.ignoredReason === undefined) t.ignoredReason = null;
  if (t.dependsOn === undefined) t.dependsOn = null;
  if (t.sequence === undefined) t.sequence = null;
  if (t.integrations === undefined) t.integrations = [];
  if (t.doneAt === undefined) t.doneAt = null;
  if (t.ignoredAt === undefined) t.ignoredAt = null;
  if (!Array.isArray(t.steps)) t.steps = [];
  t.steps = t.steps.map(s => typeof s === 'string' ? { text: s, status: 'pending' } : s);
  if (t.objective === undefined) t.objective = null;
  return t;
}




// ─── Answer Generation ───────────────────────────────────────

/**
 * Generate a natural-language answer to `query` grounded in the provided
 * transcript chunks.  Returns the raw text from the LLM.
 *
 * @param {string} query
 * @param {Array<{chunk:{text:string}, contentId:string, score:number}>} contextChunks  top-k results from semanticSearch()
 * @param {Array<{id:string,title:string,date:number}>} entries  full entry objects for metadata
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<string>}
 */
export async function generateAnswer(query, contextChunks, entries, apiKey, provider, config = null) {
  const context = contextChunks.map((r, i) => {
    const match = entries.find(e => e.id === r.contentId);
    const title = match?.title || 'Unknown entry';
    const date  = match ? new Date(match.date).toLocaleDateString() : '';
    return `[Source ${i + 1}: "${title}" (${date})]\n${r.chunk.text}`;
  }).join('\n\n');

  const prompt = `You are a helpful AI assistant answering questions about the user's knowledge base.

Answer the user's question in 2–4 concise sentences based ONLY on the provided context excerpts.
If the context does not contain enough information to answer confidently, say so honestly.
After your answer, on a new line cite which sources you used: e.g. [Source 1], [Source 2].

Question: ${query}

Context:
${context}`;

  // Proxy mode — route through workspace AI proxy (provider-agnostic)
  if (config?.useProxy && config.proxyUrl) {
    return _proxyFetch(config.proxyUrl, 'chat', {
      prompt, systemPrompt: 'You are a helpful AI that answers questions about the user\'s knowledge base.',
      type: 'answer', provider: config.provider || provider,
    }, config.workspaceId, config.memberToken).then(r => r.content || r.text || '');
  }

  if (provider === 'gemini') {
    const res = await fetchWithRetry(
      GEMINI_API_URL,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents:         [{ parts: [{ text: (_buildWorkContextLine() ? _buildWorkContextLine() + '\n\n' : '') + prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
        }),
      },
      60_000,
    );
    if (!res.ok) throw new Error(`Gemini answer error: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const res = await fetchWithRetry(CHAT_API_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful AI that answers questions about the user\'s knowledge base.' + (_buildWorkContextLine() ? ' ' + _buildWorkContextLine() : '') },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.2,
      max_tokens:  512,
    }),
  }, 60_000);
  if (!res.ok) throw new Error(`Answer API error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Helper: Convert Whisper segments to WebVTT format
function generateVTT(segments) {
  if (!segments || segments.length === 0) return null;

  let vtt = 'WEBVTT\n\n';
  for (const seg of segments) {
    if (typeof seg.start !== 'number' || typeof seg.end !== 'number') continue;
    const text = (seg.text || '').replace(/[\r\n]+/g, ' ').trim();
    if (!text) continue;
    const start = formatVTTTime(seg.start);
    const end = formatVTTTime(Math.max(seg.end, seg.start + 0.001));
    vtt += `${start} --> ${end}\n${text}\n\n`;
  }
  return vtt;
}

function formatVTTTime(seconds) {
  // Don't use Date — its UTC hour wraps at 24, mangling long entries.
  const total = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// ─── Goal Extraction ──────────────────────────

/**
 * Extract goals, commitments, and aspirations from any text content.
 * Platform-agnostic — works on transcripts, documents, meeting notes, etc.
 *
 * @param {string} text          Source text to analyse
 * @param {Array}  existingGoals Existing goal nodes from graph store
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<{ goals: Array<{ title: string, description: string, evidence: string, isNew: boolean, matchedGoalId?: string }> }>}
 */
export async function extractGoals(text, existingGoals = [], apiKey, provider = 'openai', config = null) {
  if (!config?.useProxy && !apiKey) return { goals: [] };
  if (!text || text.length < 20) return { goals: [] };

  const existingList = existingGoals.length > 0
    ? `\n\nExisting goals (match to these if relevant):\n${existingGoals.slice(0, 20).map(g => `- ID: ${g.id} | "${(g.properties?.title || g.title || 'Untitled')}"`).join('\n')}`
    : '';

  const prompt = `You are an AI that identifies goals, commitments, and aspirations from text content.

Analyse the text below and extract any goals, objectives, or commitments mentioned.
A "goal" is a desired outcome, aspiration, or commitment that requires sustained effort over time.
Short-term tasks (e.g., "send an email") are NOT goals — only extract higher-level objectives.
${existingList}

Return ONLY a valid JSON object (no markdown fences, no extra text):
{
  "goals": [
    {
      "title": "short goal title (max 80 chars)",
      "description": "1-2 sentence description of the goal",
      "evidence": "the exact quote or paraphrase from the text that supports this goal",
      "isNew": true,
      "matchedGoalId": null
    }
  ]
}

Rules:
- Return at most 3 goals per text.
- If a goal matches an existing one (same intent), set isNew=false and matchedGoalId to the existing ID.
- If no goals are found, return {"goals": []}.
- "evidence" must be a direct quote or close paraphrase from the text.
- Do not invent goals not supported by the text.

Text:
${text.slice(0, 6000)}`;

  try {
    let rawJson = '';
    if (config?.useProxy && config.proxyUrl) {
      const result = await _proxyFetch(config.proxyUrl, 'chat', {
        prompt, systemPrompt: 'You are a precise goal extractor. Output only valid JSON.',
        type: 'goal-extraction', provider: config.provider || provider,
      }, config.workspaceId, config.memberToken);
      rawJson = typeof result === 'string' ? result : (result.content || result.text || JSON.stringify(result));
    } else if (provider === 'gemini') {
      rawJson = await _geminiTaskExtraction(prompt, apiKey);
    } else {
      rawJson = await _openaiTaskExtraction(prompt, apiKey);
    }
    return _parseGoalJson(rawJson);
  } catch (e) {
    console.warn('[Goals] Extraction failed:', e.message);
    return { goals: [] };
  }
}

function _parseGoalJson(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(clean);
    const goals = (parsed.goals || []).slice(0, 3).map(g => ({
      title: typeof g.title === 'string' ? g.title.slice(0, 80) : 'Untitled goal',
      description: typeof g.description === 'string' ? g.description : '',
      evidence: typeof g.evidence === 'string' ? g.evidence : '',
      isNew: g.isNew !== false,
      matchedGoalId: typeof g.matchedGoalId === 'string' ? g.matchedGoalId : null,
    }));
    return { goals };
  } catch (e) {
    console.warn('[AI] Goal JSON parsing failed:', e.message);
    return { goals: [] };
  }
}
