// Takus — Vector Math Web Worker
// Offloads cosine similarity and mean vector computation to a background thread.
// The main thread sends vector data; this worker returns computed results.

self.onmessage = function(e) {
  const { type, payload, id } = e.data;

  switch (type) {
    case 'cosine-similarity': {
      // payload: { a: number[], b: number[] }
      const { a, b } = payload;
      const result = cosineSimilarity(a, b);
      self.postMessage({ id, result });
      break;
    }

    case 'batch-similarity': {
      // payload: { target: number[], candidates: { id: string, embedding: number[] }[] }
      const { target, candidates, threshold = 0.70 } = payload;
      const results = [];
      for (const c of candidates) {
        const score = cosineSimilarity(target, c.embedding);
        if (score >= threshold) {
          results.push({ id: c.id, score });
        }
      }
      results.sort((a, b) => b.score - a.score);
      self.postMessage({ id, result: results });
      break;
    }

    case 'mean-vector': {
      // payload: { vectors: number[][] }
      const { vectors } = payload;
      if (!vectors.length) {
        self.postMessage({ id, result: [] });
        break;
      }
      const dim = vectors[0].length;
      const mean = new Float64Array(dim);
      for (const v of vectors) {
        for (let i = 0; i < dim; i++) mean[i] += v[i];
      }
      for (let i = 0; i < dim; i++) mean[i] /= vectors.length;
      self.postMessage({ id, result: Array.from(mean) });
      break;
    }

    case 'rank-chunks': {
      // payload: { queryVec: number[], chunks: { contentId, chunkIdx, embedding, text }[], topK: number }
      const { queryVec, chunks, topK = 5 } = payload;
      const scored = [];
      for (const chunk of chunks) {
        if (!chunk.embedding?.length) continue;
        scored.push({
          contentId: chunk.contentId,
          chunkIdx: chunk.chunkIdx,
          text: chunk.text,
          score: cosineSimilarity(queryVec, chunk.embedding),
        });
      }
      scored.sort((a, b) => b.score - a.score);
      self.postMessage({ id, result: scored.slice(0, topK) });
      break;
    }

    default:
      self.postMessage({ id, error: `Unknown message type: ${type}` });
  }
};

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
