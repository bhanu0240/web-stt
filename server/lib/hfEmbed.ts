import { HfInference } from '@huggingface/inference';

/** L2-normalizes a 1D vector. */
export function normalizeVector(vec: number[]): number[] {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  return vec.map((x) => x / n);
}

function toNumberArray(data: unknown): number[] {
  if (data instanceof Float32Array || data instanceof Float64Array) {
    return Array.from(data);
  }
  if (Array.isArray(data) && data.length && typeof data[0] === 'number') {
    return data as number[];
  }
  if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
    const rows = data as number[][];
    const dim = rows[0].length;
    const flat = new Array(dim).fill(0);
    for (const row of rows) {
      for (let j = 0; j < dim; j++) flat[j] += row[j];
    }
    for (let j = 0; j < dim; j++) flat[j] /= rows.length;
    return flat;
  }
  if (Array.isArray(data)) {
    return toNumberArray(data.flat(Infinity));
  }
  throw new Error('Unexpected embedding tensor shape');
}

/** Mean-pools token embeddings from HF feature-extraction output into one sentence vector. */
export function meanPoolEmbedding(tensor: unknown): number[] {
  const flat = toNumberArray(tensor);
  return normalizeVector(flat);
}

export type EmbedTextArgs = {
  token: string;
  model: string;
  text: string;
};

/** Embeds one text for retrieval (E5-style prefix). */
export async function embedPassage({
  token,
  model,
  text,
}: EmbedTextArgs): Promise<number[]> {
  const hf = new HfInference(token);
  const prefixed = text.startsWith('passage:') ? text : `passage: ${text}`;
  const out = await hf.featureExtraction({
    model,
    inputs: prefixed,
  });
  return meanPoolEmbedding(out);
}

/** Embeds search query (E5-style prefix). */
export async function embedQuery({
  token,
  model,
  text,
}: EmbedTextArgs): Promise<number[]> {
  const hf = new HfInference(token);
  const prefixed = text.startsWith('query:') ? text : `query: ${text}`;
  const out = await hf.featureExtraction({
    model,
    inputs: prefixed,
  });
  return meanPoolEmbedding(out);
}

/** Cosine similarity between two normalized vectors (dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
