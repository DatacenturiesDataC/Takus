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
 * Retries on 429 (rate-limited) and 5xx (server error) with linear backoff.
 * Client errors (4xx except 429) are returned immediately without retry.
 */
async function fetchWithRetry(url, options, timeoutMs, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 2000 * attempt)); // 2 s, then 4 s
    }
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      const isTransient = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (isTransient && attempt < maxRetries) continue;
      return res;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      // Network/timeout error — retry
    }
  }
}

export async function generateTranscriptionAndSummary(audioBlob, apiKey) {
  if (!apiKey) throw new Error('OpenAI API Key is required');

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

  // Generate WebVTT
  const vtt = generateVTT(whisperData.segments || []);

  // 2. Generate summary with GPT-4o-mini
  // Truncate transcript to ~50K chars (≈12K tokens) to stay within context limits
  const MAX_TRANSCRIPT_CHARS = 50_000;
  let truncatedTranscript = transcript;
  let truncationNote = '';
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    truncatedTranscript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    truncationNote = `\n\n[Note: Transcript truncated from ${transcript.length} to ${MAX_TRANSCRIPT_CHARS} characters.]`;
  }

  const prompt = `You are an expert meeting assistant. Below is the transcript of a recorded meeting or screen session.

Provide a structured response with these sections:
## Summary
2–3 paragraphs covering the key points and decisions made.

## Action Items
Bulleted list of concrete next steps or tasks (if none, write "None identified").

## Sentiment
One sentence describing the overall tone (e.g. collaborative, tense, informational).
${truncationNote}
Transcript:
${truncatedTranscript}`;

  // GPT summary should complete well within 60 s; retry up to 2× on transient errors
  const chatRes = await fetchWithRetry(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a concise, professional meeting assistant. Use clear markdown formatting.' },
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
