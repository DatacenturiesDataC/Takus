// Takus — Vector Utilities
// Shared vector operations used across the platform.
// Extracted from recording-pipeline.js, autonomy-engine.js, and document-adapter.js
// to eliminate the 3× duplication of _meanVector().

/**
 * Compute the mean (centroid) of a set of embedding chunks.
 * Used to create a single representative vector for a recording/document
 * from its multiple chunk embeddings.
 *
 * @param {Array<{embedding: number[]}>} chunks - Embedding chunks
 * @returns {Float32Array|null} Mean vector, or null if no valid embeddings
 */
export function meanVector(chunks) {
  const valid = chunks.filter(c => c.embedding?.length > 0);
  if (!valid.length) return null;
  const dim = valid[0].embedding.length;
  const mean = new Float32Array(dim);
  for (const c of valid) {
    for (let i = 0; i < dim; i++) mean[i] += c.embedding[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= valid.length;
  return mean;
}

/**
 * Compute the average of a set of raw embedding arrays (not chunk objects).
 * Variant used by autonomy-engine where chunks are already filtered.
 *
 * @param {Array<{embedding: number[]}>} chunks - Chunks with embedding arrays
 * @returns {number[]|null} Average embedding, or null if no valid data
 */
export function averageEmbedding(chunks) {
  const embeddings = chunks.filter(c => c.embedding?.length > 0).map(c => c.embedding);
  if (embeddings.length === 0) return null;
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return avg;
}
