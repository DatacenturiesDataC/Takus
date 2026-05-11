// Takus — Embedding engine for Video-RAG (Phase 2: Ask)

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const GEMINI_EMBEDDING_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

const CHUNK_SIZE    = 400; // characters per chunk
const CHUNK_OVERLAP = 80;  // characters of overlap between chunks

/**
 * Split plain text into overlapping character-level chunks.
 * @param {string} text
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function chunkTranscript(text) {
  if (!text || text.length < 20) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    // Merge a tiny trailing fragment into the previous chunk rather than creating a stub
    if (end - start < 50 && chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      prev.end  = end;
      prev.text = text.slice(prev.start, end);
      break;
    }
    chunks.push({ text: text.slice(start, end), start, end });
    start = end - CHUNK_OVERLAP;
    if (start >= end) break;
  }
  return chunks;
}

/**
 * Call the embedding API for an array of text strings.
 * Returns a parallel array of number[] vectors.
 * @param {string[]} texts
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<number[][]>}
 */
async function _fetchEmbeddings(texts, apiKey, provider) {
  if (provider === 'gemini') {
    // Gemini's text-embedding-004 only accepts one text per request
    const results = await Promise.all(texts.map(async (text) => {
      const res = await fetch(
        `${GEMINI_EMBEDDING_URL}?key=${encodeURIComponent(apiKey)}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:   'models/text-embedding-004',
            content: { parts: [{ text }] },
          }),
        },
      );
      if (!res.ok) throw new Error(`Gemini embedding error: ${res.status}`);
      const data = await res.json();
      return data.embedding?.values || [];
    }));
    return results;
  }

  // OpenAI supports batch input — more efficient
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

/**
 * Chunk a transcript and generate embeddings for all chunks.
 * Batches in groups of 20 to stay within API limits.
 *
 * @param {string} transcript
 * @param {string} recordingId
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<Array<{text,start,end,recordingId,chunkIdx,embedding:number[]}>>}
 */
export async function embedTranscript(transcript, recordingId, apiKey, provider) {
  const chunks = chunkTranscript(transcript);
  if (!chunks.length) return [];

  const BATCH = 20;
  const embedded = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch   = chunks.slice(i, i + BATCH);
    const vectors = await _fetchEmbeddings(batch.map(c => c.text), apiKey, provider);
    for (let j = 0; j < batch.length; j++) {
      embedded.push({ ...batch[j], embedding: vectors[j] });
    }
  }

  return embedded.map((c, idx) => ({ ...c, recordingId, chunkIdx: idx }));
}

/**
 * Cosine similarity between two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}  in [-1, 1]
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Embed a query then rank all stored chunks by cosine similarity.
 *
 * @param {string}  query
 * @param {Array<{recordingId:string, chunks:Array}>} allEmbeddings  — from getAllEmbeddings()
 * @param {string}  apiKey
 * @param {'openai'|'gemini'} provider
 * @param {number}  topK
 * @returns {Promise<Array<{chunk, recordingId, score}>>}
 */
export async function semanticSearch(query, allEmbeddings, apiKey, provider, topK = 5) {
  const [queryVec] = await _fetchEmbeddings([query], apiKey, provider);
  if (!queryVec?.length) return [];

  const scored = [];
  for (const { recordingId, chunks } of allEmbeddings) {
    for (const chunk of chunks) {
      if (!chunk.embedding?.length) continue;
      scored.push({ chunk, recordingId, score: cosineSimilarity(queryVec, chunk.embedding) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
