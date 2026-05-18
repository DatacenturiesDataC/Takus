// Takus — Embedding engine for Knowledge OS (semantic search across all content)

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const GEMINI_EMBEDDING_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

const CHUNK_SIZE    = 400; // characters per chunk
const CHUNK_OVERLAP = 80;  // characters of overlap between chunks
const EMBEDDING_TIMEOUT_MS = 30_000; // 30 seconds per API call

/**
 * Fetch with an AbortController timeout. Throws a clear message on timeout.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function _fetchWithTimeout(url, options, timeoutMs = EMBEDDING_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Embedding API timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
    // If we've reached the end of the text, stop
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
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
    // Gemini's text-embedding-004 only accepts one text per request.
    // Limit concurrency to 4 parallel requests to prevent burst 429s.
    const MAX_CONCURRENT = 4;
    const results = new Array(texts.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < texts.length) {
        const idx = cursor++;
        const text = texts[idx];
        const res = await _fetchWithTimeout(
          GEMINI_EMBEDDING_URL,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              model:   'models/text-embedding-004',
              content: { parts: [{ text }] },
            }),
          },
        );
        if (!res.ok) throw new Error(`Gemini embedding error: ${res.status}`);
        const data = await res.json();
        results[idx] = data.embedding?.values || [];
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, texts.length) }, () => worker()),
    );
    return results;
  }

  // OpenAI supports batch input — more efficient
  const res = await _fetchWithTimeout(OPENAI_EMBEDDINGS_URL, {
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
 * Chunk text content and generate embeddings for all chunks.
 * Batches in groups of 20 to stay within API limits.
 *
 * @param {string} text - Text content to embed (transcript, document, etc.)
 * @param {string} contentId - ID of the source content entry
 * @param {string} apiKey
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<Array<{text,start,end,contentId,chunkIdx,embedding:number[]}>>}
 */
export async function embedTranscript(text, contentId, apiKey, provider) {
  const chunks = chunkTranscript(text);
  if (!chunks.length) return [];

  try {
    const BATCH = 20;
    const embedded = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch   = chunks.slice(i, i + BATCH);
      const vectors = await _fetchEmbeddings(batch.map(c => c.text), apiKey, provider);
      for (let j = 0; j < batch.length; j++) {
        embedded.push({ ...batch[j], embedding: vectors[j] });
      }
    }

    return embedded.map((c, idx) => ({ ...c, contentId, chunkIdx: idx }));
  } catch (e) {
    console.warn('[Embeddings] embedTranscript failed:', e.message);
    return [];
  }
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
 * @param {Array<{contentId:string, chunks:Array}>} allEmbeddings  — from getAllEmbeddings()
 * @param {string}  apiKey
 * @param {'openai'|'gemini'} provider
 * @param {number}  topK
 * @returns {Promise<Array<{chunk, contentId, score}>>}
 */
export async function semanticSearch(query, allEmbeddings, apiKey, provider, topK = 5) {
  try {
    const [queryVec] = await _fetchEmbeddings([query], apiKey, provider);
    if (!queryVec?.length) return [];

    // Keyword pre-filter: extract significant words (≥3 chars, skip stop words)
    const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'was', 'has', 'had', 'but', 'not', 'you', 'all', 'can', 'her', 'his', 'how', 'its', 'our', 'out', 'who', 'did', 'get', 'let', 'say', 'she', 'too', 'use', 'what', 'when', 'where', 'which', 'will', 'with', 'this', 'that', 'from', 'have', 'been', 'they', 'than', 'more', 'also', 'about']);
    const keywords = query.toLowerCase().split(/\W+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    // Collect all chunks, optionally pre-filtered by keyword match
    let candidates = [];
    for (const { contentId, chunks } of allEmbeddings) {
      for (const chunk of chunks) {
        if (!chunk.embedding?.length) continue;
        candidates.push({ chunk, contentId });
      }
    }

    // If we have keywords, pre-filter to chunks containing at least one keyword
    if (keywords.length > 0 && candidates.length > topK * 3) {
      const filtered = candidates.filter(({ chunk }) => {
        const lower = chunk.text.toLowerCase();
        return keywords.some(kw => lower.includes(kw));
      });
      // Only use filtered set if it has enough candidates; otherwise fall back to full scan
      if (filtered.length >= topK) {
        candidates = filtered;
      }
    }

    // Score remaining candidates by cosine similarity
    const scored = candidates.map(({ chunk, contentId }) => ({
      chunk,
      contentId,
      score: cosineSimilarity(queryVec, chunk.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (e) {
    console.warn('[Embeddings] semanticSearch failed:', e.message);
    return [];
  }
}
