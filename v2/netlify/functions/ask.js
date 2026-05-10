/**
 * POST /api/ask
 *
 * RAG query over recording history using Supabase pgvector similarity search.
 *
 * Request body:
 * { "query": string, "limit": number }  // limit default 5
 *
 * Response:
 * {
 *   "answer": string,
 *   "sources": [{ "recordingId": string, "title": string, "timestampMs": number }]
 * }
 *
 * Pipeline (Phase 5):
 *   1. Embed query via Supabase Edge Function (text-embedding-3-small or Gemini)
 *   2. pgvector similarity search: match_recordings(query_embedding, match_count)
 *   3. Build Gemini prompt with retrieved chunks
 *   4. Return grounded answer + source citations
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   GEMINI_API_KEY
 */

export default async function handler(req) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { query, limit = 5 } = await req.json();

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return Response.json({ error: 'query is required and must be a non-empty string.' }, { status: 400 });
    }

    // ── Phase 5: implement RAG pipeline here ────────────────────────────────
    // const embedding = await embedQuery(query);
    // const chunks = await supabaseVectorSearch(embedding, limit);
    // const answer = await geminiGrounded(query, chunks);
    // return Response.json({ answer, sources: chunks.map(toSource) });

    return Response.json({
      answer: 'RAG pipeline not yet implemented — coming in Phase 5.',
      sources: [],
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error in ask function.' }, { status: 500 });
  }
}

export const config = {
  path: '/api/ask',
};
