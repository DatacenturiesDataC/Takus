// Takus — AI Engine (OpenAI Integration)

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';

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
    backoffMs = 2000 * (attempt + 1); // default for next retry: 2s, 4s, 6s
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
}

const PROMPTS = {
  meeting: {
    system: 'You are a concise, professional meeting assistant. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert meeting assistant. Below is the transcript of a recorded meeting.

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
${truncationNote}
Transcript:
${transcript}`,
  },
  screen: {
    system: 'You are a concise technical documentation assistant. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert technical writer. Below is the narration transcript from a screen recording.

Provide a structured response with these sections:
## Overview
1–2 sentences describing what this screen recording demonstrates.

## Key Steps Demonstrated
Numbered list of the main actions or steps shown in the recording.

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
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Main entry point. Supports two AI providers:
 *   provider='openai'  — Whisper STT + GPT-4o-mini summary (apiKey = OpenAI key)
 *   provider='gemini'  — Gemini 1.5 Flash for both transcription and summary (apiKey = Gemini key)
 */
export async function generateTranscriptionAndSummary(audioBlob, apiKey, type = 'screen', provider = 'openai') {
  if (!apiKey) throw new Error('API key is required. Add one in Settings → AI Provider.');
  if (provider === 'gemini') return _geminiFlow(audioBlob, apiKey, type);
  return _openaiFlow(audioBlob, apiKey, type);
}

// ─── OpenAI flow (Whisper + GPT-4o-mini) ────────────────────────────────────

async function _openaiFlow(audioBlob, apiKey, type) {
  // 1. Transcribe audio with Whisper (requesting verbose_json for timestamps)
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  // Whisper can take up to 2 minutes for long recordings; retry up to 2× on transient errors
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
    throw new Error('Transcription too short or empty — the recording may have no audible speech.');
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
  const prompt = promptDef.user(truncatedTranscript, truncationNote);

  const chatRes = await fetchWithRetry(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: promptDef.system },
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
    throw new Error('AI returned an empty summary — the recording may be too short or the content unclear.');
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
  const taskInstruction = promptDef.user('[See audio above]', '');

  const requestBody = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Audio } },
        {
          text: `${promptDef.system}\n\nFirst, produce a full verbatim transcript of the audio enclosed in <transcript>...</transcript> tags.\nThen, provide the following structured analysis:\n\n${taskInstruction}`,
        },
      ],
    }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  };

  const geminiRes = await fetchWithRetry(
    `${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) },
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

// ─── Task Extraction (Phase 1: The Scribe) ──────────────────────────────────

/**
 * Extracts structured tasks from a transcript + observer log.
 * Returns { takusTasks, meTasks } — both arrays may be empty.
 *
 * @param {string} transcript
 * @param {{ consoleErrors: Array, networkErrors: Array, actions: Array }} observerLog
 * @param {string} type  recording type
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 */
export async function extractTasks(transcript, observerLog, type, apiKey, provider) {
  if (!apiKey || !transcript) return { takusTasks: [], meTasks: [] };

  const errorContext = _buildErrorContext(observerLog);
  const prompt = _buildTaskPrompt(transcript, errorContext, type);

  let rawJson = '';
  try {
    if (provider === 'gemini') {
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

function _buildTaskPrompt(transcript, errorContext, type) {
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
  };

  const instructions = typeInstructions[type] || typeInstructions.screen;

  return `You are an AI task extractor. Analyse the following recording transcript and extract actionable tasks.

Recording type: ${type}
${instructions}

${errorContext ? `\n--- Technical Context ---\n${errorContext}\n---\n` : ''}

Return ONLY a valid JSON object with this exact shape (no markdown fences, no extra text):
{
  "takusTasks": [
    {
      "id": "t-001",
      "action": "CREATE_BUG_REPORT | LOG_DECISION | DRAFT_SHARE_MESSAGE | UPDATE_TICKET | DRAFT_SLACK_MESSAGE | CREATE_CALENDAR_EVENT",
      "title": "short human-readable title",
      "payload": { "any": "relevant fields" },
      "contextTimestamp": "MM:SS or null",
      "dependsOn": ["t-002"] or null,
      "sequence": 1,
      "integrations": ["jira", "slack"]
    }
  ],
  "meTasks": [
    {
      "id": "m-001",
      "note": "what the person said they would do",
      "contextTimestamp": "MM:SS or null",
      "urgency": "normal | high",
      "dependsOn": ["m-002"] or null,
      "sequence": 1
    }
  ]
}

Rules:
- Return at most 5 takusTasks and 5 meTasks.
- If there are no tasks of a type, return an empty array.
- contextTimestamp should be the approximate timestamp where the commitment was made (MM:SS format), or null if unknown.
- Do not invent tasks not supported by the transcript.
- dependsOn: If task B cannot start until task A completes, set task B's dependsOn to ["<id of task A>"]. Use null if no dependency.
- sequence: Assign integer ordering (1, 2, 3...) if tasks should be done in a specific order. Use null if order doesn't matter.
- integrations: For takusTasks, suggest which integrations could handle the task. Valid values: slack, github, linear, jira, notion, calendar, email, drive. Use an empty array if none apply.

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
        { role: 'system', content: 'You are a precise task extractor. Output only valid JSON.' },
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
    `${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
      // Phase 15: Rich status model (plain data — no getters)
      status: 'pending',
      output: null,
      ignoredReason: null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(d => typeof d === 'string') : null,
      sequence: typeof t.sequence === 'number' ? t.sequence : null,
      integrations: Array.isArray(t.integrations)
        ? t.integrations.filter(ig => VALID_INTEGRATIONS.includes(ig))
        : [],
      doneAt: null,
      ignoredAt: null,
    }));

    const meTasks = (parsed.meTasks || []).slice(0, 5).map((t, i) => ({
      id: t.id || `m-${String(i + 1).padStart(3, '0')}`,
      note: t.note || '',
      contextTimestamp: t.contextTimestamp || null,
      urgency: t.urgency === 'high' ? 'high' : 'normal',
      // Phase 15: Rich status model
      status: 'pending',
      output: null,
      ignoredReason: null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(d => typeof d === 'string') : null,
      sequence: typeof t.sequence === 'number' ? t.sequence : null,
      doneAt: null,
      ignoredAt: null,
    }));

    return { takusTasks, meTasks };
  } catch {
    return { takusTasks: [], meTasks: [] };
  }
}

/**
 * Migrate a legacy task (with `done: boolean`) to the Phase 15 status model.
 * Safe to call on already-migrated tasks — idempotent.
 * @param {object} task  Task object from IndexedDB
 * @returns {object}     Same task reference, with `status` field guaranteed
 */
export function migrateTask(task) {
  if (task.status) return task; // already migrated
  task.status = task.done ? 'done' : 'pending';
  if (task.done && !task.doneAt) task.doneAt = Date.now();
  if (task.output === undefined) task.output = null;
  if (task.ignoredReason === undefined) task.ignoredReason = null;
  if (task.dependsOn === undefined) task.dependsOn = null;
  if (task.sequence === undefined) task.sequence = null;
  if (task.integrations === undefined) task.integrations = [];
  if (task.doneAt === undefined) task.doneAt = null;
  if (task.ignoredAt === undefined) task.ignoredAt = null;
  return task;
}

// ─── Answer Generation (Phase 2: Ask) ───────────────────────────────────────

/**
 * Generate a natural-language answer to `query` grounded in the provided
 * transcript chunks.  Returns the raw text from the LLM.
 *
 * @param {string} query
 * @param {Array<{chunk:{text:string}, recordingId:string, score:number}>} contextChunks  top-k results from semanticSearch()
 * @param {Array<{id:string,title:string,date:number}>} recordings  full recording objects for metadata
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<string>}
 */
export async function generateAnswer(query, contextChunks, recordings, apiKey, provider) {
  const context = contextChunks.map((r, i) => {
    const rec   = recordings.find(rec => rec.id === r.recordingId);
    const title = rec?.title || 'Unknown recording';
    const date  = rec ? new Date(rec.date).toLocaleDateString() : '';
    return `[Source ${i + 1}: "${title}" (${date})]\n${r.chunk.text}`;
  }).join('\n\n');

  const prompt = `You are a helpful AI assistant answering questions about recorded meetings and screen sessions.

Answer the user's question in 2–4 concise sentences based ONLY on the provided context excerpts.
If the context does not contain enough information to answer confidently, say so honestly.
After your answer, on a new line cite which sources you used: e.g. [Source 1], [Source 2].

Question: ${query}

Context:
${context}`;

  if (provider === 'gemini') {
    const res = await fetchWithRetry(
      `${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents:         [{ parts: [{ text: prompt }] }],
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
        { role: 'system', content: 'You are a helpful AI that answers questions about recorded meetings and screen sessions.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.2,
      max_tokens:  512,
    }),
  }, 60_000);
  if (!res.ok) throw new Error(`Answer API error: ${res.status}`);
  const data = await res.json();
  return data.choices[0]?.message?.content || '';
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
  // Don't use Date — its UTC hour wraps at 24, mangling long recordings.
  const total = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
