/**
 * POST /api/process-recording
 *
 * Main AI processing pipeline. Orchestrates:
 *   1. Fetch recording blob from Netlify Blobs
 *   2. Transcribe with OpenAI Whisper
 *   3. Analyze with Gemini 2.0 Flash (type-specific prompt)
 *   4. Store artifacts in Supabase (+ pgvector embedding)
 *   5. Stream NDJSON progress events back to client
 *
 * Request body:
 * {
 *   blobKey: string,          // e.g. "recordings/rec_1234567890.webm"
 *   type: 'meeting' | 'screen' | 'presentation' | 'update',
 *   title: string,
 *   durationMs: number,
 *   artifacts: {
 *     domSnapshots: object[],
 *     consoleLog: object[],
 *     networkHar: object[],
 *   },
 *   integrations: {
 *     calendarEventId?: string,
 *   }
 * }
 *
 * Response: NDJSON stream
 *   {"event":"progress","step":"transcribing","pct":20}
 *   {"event":"progress","step":"analyzing","pct":60}
 *   {"event":"complete","artifacts":{...}}    ← see agent output schemas in CLAUDE.md
 *   {"event":"error","message":"..."}
 *
 * Env vars required:
 *   OPENAI_API_KEY
 *   GEMINI_API_KEY  (or use Netlify AI Gateway: NETLIFY_AI_GATEWAY_KEY)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        const body = await req.json();
        const { blobKey, type, title, durationMs, artifacts: inputArtifacts, integrations } = body;

        if (!blobKey || !type) {
          send({ event: 'error', message: 'blobKey and type are required.' });
          controller.close();
          return;
        }

        // ── Phase 3: implement each step below ──────────────────────────────

        send({ event: 'progress', step: 'fetching', pct: 10 });
        // TODO: const blob = await getBlob(blobKey);  // Netlify Blobs

        send({ event: 'progress', step: 'transcribing', pct: 25 });
        // TODO: const { transcript, vtt } = await transcribeWithWhisper(blob, process.env.OPENAI_API_KEY);

        send({ event: 'progress', step: 'analyzing', pct: 60 });
        // TODO: const agentOutput = await analyzeWithGemini({ transcript, type, title, ...inputArtifacts });

        send({ event: 'progress', step: 'storing', pct: 85 });
        // TODO: await storeInSupabase({ blobKey, type, title, durationMs, transcript, agentOutput });

        send({ event: 'progress', step: 'done', pct: 100 });

        // Stub response — replace with real agentOutput in Phase 4
        send({
          event: 'complete',
          artifacts: {
            transcript: '[Transcription — Phase 3]',
            summary: '[AI summary — Phase 4]',
            vtt: null,
            chapters: null,
          },
        });
      } catch (err) {
        send({ event: 'error', message: err.message || 'Unknown error in process-recording function.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const config = {
  path: '/api/process-recording',
};
