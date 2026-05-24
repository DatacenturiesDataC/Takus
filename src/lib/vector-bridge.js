// Takus — Vector Worker Bridge
// Provides an async API for offloading vector math to a Web Worker.
// Falls back to synchronous main-thread computation if Workers are unavailable.

let _worker = null;
let _msgId = 0;
const _pending = new Map();

/**
 * Initialize the vector worker (lazy, singleton).
 * @returns {Worker|null}
 */
function _getWorker() {
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./vector-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const cb = _pending.get(id);
      if (cb) {
        _pending.delete(id);
        if (error) cb.reject(new Error(error));
        else cb.resolve(result);
      }
    };
    _worker.onerror = () => {
      // Worker failed to load — disable and fall back to main thread
      _worker = null;
    };
  } catch {
    _worker = null;
  }
  return _worker;
}

/**
 * Send a message to the worker and await the result.
 * @param {string} type
 * @param {object} payload
 * @returns {Promise<any>}
 */
function _postMessage(type, payload) {
  const worker = _getWorker();
  if (!worker) return null; // Caller falls back to sync

  const id = ++_msgId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    worker.postMessage({ type, payload, id });
    // Safety timeout: 30s
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        reject(new Error('Vector worker timed out'));
      }
    }, 30_000);
  });
}

/**
 * Compute batch cosine similarity between a target vector and candidates.
 * Returns candidates scoring above the threshold, sorted by score desc.
 *
 * @param {number[]} target
 * @param {{ id: string, embedding: number[] }[]} candidates
 * @param {number} threshold
 * @returns {Promise<{ id: string, score: number }[]>}
 */
export async function batchSimilarity(target, candidates, threshold = 0.70) {
  const result = await _postMessage('batch-similarity', { target, candidates, threshold });
  if (result !== null) return result;

  // Fallback: main thread
  const { cosineSimilarity } = await import('./embeddings.js');
  const results = [];
  for (const c of candidates) {
    const score = cosineSimilarity(target, c.embedding);
    if (score >= threshold) results.push({ id: c.id, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Compute the mean (centroid) of a set of vectors.
 *
 * @param {number[][]} vectors
 * @returns {Promise<number[]>}
 */
export async function meanVector(vectors) {
  if (!vectors.length) return [];
  const result = await _postMessage('mean-vector', { vectors });
  if (result !== null) return result;

  // Fallback: main thread
  const dim = vectors[0].length;
  const mean = new Float64Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= vectors.length;
  return Array.from(mean);
}

/**
 * Rank chunks by cosine similarity to a query vector.
 *
 * @param {number[]} queryVec
 * @param {Array} chunks - Each with { contentId, chunkIdx, embedding, text }
 * @param {number} topK
 * @returns {Promise<Array<{ contentId, chunkIdx, text, score }>>}
 */
export async function rankChunks(queryVec, chunks, topK = 5) {
  const result = await _postMessage('rank-chunks', { queryVec, chunks, topK });
  if (result !== null) return result;

  // Fallback: main thread
  const { cosineSimilarity } = await import('./embeddings.js');
  const scored = chunks
    .filter(c => c.embedding?.length)
    .map(c => ({
      contentId: c.contentId,
      chunkIdx: c.chunkIdx,
      text: c.text,
      score: cosineSimilarity(queryVec, c.embedding),
    }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Terminate the worker (e.g., on app shutdown).
 */
export function terminateVectorWorker() {
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _pending.clear();
  }
}
