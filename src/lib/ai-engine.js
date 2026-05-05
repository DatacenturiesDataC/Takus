// Takus — AI Engine (OpenAI Integration)

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';

export async function generateTranscriptionAndSummary(audioBlob, apiKey) {
  if (!apiKey) throw new Error('OpenAI API Key is required');

  // 1. Transcribe audio with Whisper
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp3');
  formData.append('model', 'whisper-1');

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

  const { text: transcript } = await whisperRes.json();

  if (!transcript || transcript.trim().length < 10) {
    throw new Error('Transcription too short or empty');
  }

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

  return { transcript, summary };
}
