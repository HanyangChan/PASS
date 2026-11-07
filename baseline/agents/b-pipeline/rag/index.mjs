// In-memory vector index: cosine similarity over precomputed vectors. No dependencies.
const cosine = (a, b) => {
  if (a.length !== b.length || !a.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : null;
};

/** entries: [{id, vector:number[]}]. search() ignores entries whose dimension differs instead of throwing. */
export function createRagIndex(entries) {
  const rows = entries.map(e => ({ id: e.id, vector: [...e.vector] }));
  return {
    size: rows.length,
    search(vector, { minCosine = 0, limit = 3 } = {}) {
      return rows.map(r => ({ id: r.id, score: cosine(vector, r.vector) }))
        .filter(r => r.score !== null && r.score >= minCosine)
        .sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}
