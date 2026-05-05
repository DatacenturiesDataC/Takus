// Takus — AI Engine (OpenAI Integration)

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';

export async function generateTranscriptionAndSummary(audioBlob, apiKey) {
  if (!apiKey) throw new Error('OpenAI API Key is required');

  // 1. Transcribe audio with Whisper (requesting verbose_json for timestamps)
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const whisperRes = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!whisperRes.ok) {
    const err = await whisperRes.json().catch(()=>({}));
    throw new Error(err.error?.message || `Whisper API failed: ${whisperRes.status}`);
  }

  const whisperData = await whisperRes.json();
  const transcript = whisperData.text;

  if (!transcript || transcript.trim().length < 10) {
    throw new Error('Transcription too short or empty');
  }

  // Generate WebVTT
  const vtt = generateVTT(whisperData.segments || []);

  // 2. Generate summary with GPT-4o-mini
  const prompt = `You are a highly skilled AI meeting assistant. Below is the transcript of a meeting/screen recording.
Please provide:
1. A concise summary of the key points discussed (2-3 paragraphs).
2. A bulleted list of actionable items (if any).
3. The overall sentiment/tone.

Transcript:
${transcript}`;

  const chatRes = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful meeting assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    })
  });

  if (!chatRes.ok) {
    const err = await chatRes.json().catch(()=>({}));
    throw new Error(err.error?.message || `Chat API failed: ${chatRes.status}`);
  }

  const chatData = await chatRes.json();
  const summary = chatData.choices[0].message.content;

  return { transcript, summary, vtt };
}

// Helper: Convert Whisper segments to WebVTT format
function generateVTT(segments) {
  if (!segments || segments.length === 0) return null;
  
  let vtt = 'WEBVTT\n\n';
  for (const seg of segments) {
    const start = formatVTTTime(seg.start);
    const end = formatVTTTime(seg.end);
    vtt += `${start} --> ${end}\n${seg.text.trim()}\n\n`;
  }
  return vtt;
}

function formatVTTTime(seconds) {
  const date = new Date(seconds * 1000);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}
