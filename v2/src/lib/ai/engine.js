// Ported from v1 src/lib/ai-engine.js — identical logic, module path only change

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

async function fetchWithRetry(url, options, timeoutMs, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      const isTransient = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (isTransient && attempt < maxRetries) continue;
      return res;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
    }
  }
}

const PROMPTS = {
  meeting: {
    system: 'You are a concise, professional meeting assistant. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert meeting assistant. Below is the transcript of a recorded meeting.

Provide a structured response with these sections:
## Summary
2–3 paragraphs covering the key points and decisions made.

## Action Items
Bulleted list of concrete next steps or tasks (if none, write "None identified").

## Key Decisions
Bulleted list of decisions reached during the meeting (if none, write "None recorded").

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

## Purpose & Outcome
One paragraph describing the goal of this session and what was achieved.

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

## Structure & Sections
Bulleted list of the main sections or topics covered, in order.

## Audience Takeaways
Bulleted list of what the audience should remember or act on after watching.
${truncationNote}
Transcript:
${transcript}`,
  },
  update: {
    system: 'You are a concise async-update summarizer. Use clear markdown formatting.',
    user: (transcript, truncationNote) => `You are an expert at distilling async video updates. Below is the transcript of a recorded update.

Provide a structured response with these sections:
## TL;DR
3 bullet points, max 150 words total.

## Details
Key context and background covered in the update.

## Next Steps
Any actions or follow-ups mentioned.
${truncationNote}
Transcript:
${transcript}`,
  },
};

/**
 * Main entry point.
 * provider='openai'  — Whisper STT + GPT-4o-mini summary
 * provider='gemini'  — Gemini 2.0 Flash for both STT and summary
 */
export async function generateTranscriptionAndSummary(audioBlob, apiKey, type = 'screen', provider = 'openai') {
  if (!apiKey) throw new Error('API key is required. Add one in Settings → AI Provider.');
  if (provider === 'gemini') return _geminiFlow(audioBlob, apiKey, type);
  return _openaiFlow(audioBlob, apiKey, type);
}

async function _openaiFlow(audioBlob, apiKey, type) {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const whisperRes = await fetchWithRetry(WHISPER_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
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

  const vtt = _generateVTT(whisperData.segments || []);

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
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
  return { transcript, summary, vtt };
}

async function _geminiFlow(audioBlob, apiKey, type) {
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

  const transcriptMatch = rawText.match(/<transcript>([\s\S]*?)<\/transcript>/i);
  const transcript = transcriptMatch ? transcriptMatch[1].trim() : rawText.split('\n').slice(0, 10).join('\n');
  const summary = rawText.replace(/<transcript>[\s\S]*?<\/transcript>/i, '').trim();
  return { transcript, summary, vtt: null };
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function _generateVTT(segments) {
  if (!segments || segments.length === 0) return null;
  let vtt = 'WEBVTT\n\n';
  for (const seg of segments) {
    if (typeof seg.start !== 'number' || typeof seg.end !== 'number') continue;
    const text = (seg.text || '').replace(/[\r\n]+/g, ' ').trim();
    if (!text) continue;
    const start = _formatVTTTime(seg.start);
    const end = _formatVTTTime(Math.max(seg.end, seg.start + 0.001));
    vtt += `${start} --> ${end}\n${text}\n\n`;
  }
  return vtt;
}

function _formatVTTTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
