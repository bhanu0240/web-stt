import fs from 'node:fs/promises';
import path from 'node:path';
import { cosineSimilarity, embedQuery } from './hfEmbed.js';

export type KeywordHit = {
  assetId: string;
  file: string;
  line: number;
  snippet: string;
};

export type SearchChunkRow = {
  assetId: string;
  startMs: number;
  endMs: number;
  text: string;
  embedding: number[];
  embeddingModelId: string;
};

export type HybridHit = KeywordHit & {
  kind?: string;
  rank?: number;
  chunk?: number;
  score?: number;
  rrf?: number;
};

/**
 * Keyword search: scans transcript.md and runs/*.md under LIBRARY_ROOT for substring `q`.
 */
export async function keywordSearch(
  libRoot: string,
  q: string,
): Promise<KeywordHit[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const base = path.join(libRoot);
  let dirs;
  try {
    dirs = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const hits: KeywordHit[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const assetId = d.name;
    const files = [
      path.join(base, assetId, 'transcript.md'),
      ...(await listRunMarkdowns(path.join(base, assetId, 'runs'))),
    ];
    for (const file of files) {
      let content: string;
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const lower = content.toLowerCase();
      if (!lower.includes(needle)) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({
            assetId,
            file: path.relative(base, file),
            line: i + 1,
            snippet: lines[i].slice(0, 200),
          });
        }
      }
    }
  }
  return hits.slice(0, 200);
}

async function listRunMarkdowns(runsDir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(runsDir);
    return names
      .filter((n) => n.endsWith('.md'))
      .map((n) => path.join(runsDir, n));
  } catch {
    return [];
  }
}

/** Loads all chunks.jsonl from library into memory for semantic scan. */
export async function loadAllChunks(libRoot: string): Promise<SearchChunkRow[]> {
  const base = path.join(libRoot);
  let dirs;
  try {
    dirs = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const all: SearchChunkRow[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const assetId = d.name;
    const jsonlPath = path.join(base, assetId, 'search', 'chunks.jsonl');
    let raw: string;
    try {
      raw = await fs.readFile(jsonlPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Partial<SearchChunkRow>;
        if (
          row.embedding &&
          Array.isArray(row.embedding) &&
          row.text &&
          row.assetId
        ) {
          all.push(row as SearchChunkRow);
        }
      } catch {
        /* skip bad line */
      }
    }
  }
  return all;
}

/** RRF merge: ranks are 1-based positions. */
export function reciprocalRankFusion(
  lists: HybridHit[][],
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  const keyOf = (h: HybridHit) =>
    `${h.assetId}::${h.file ?? ''}::${h.line ?? h.chunk ?? 0}`;

  for (const list of lists) {
    list.forEach((item, idx) => {
      const key = keyOf(item);
      const prev = scores.get(key) ?? 0;
      scores.set(key, prev + 1 / (k + idx + 1));
    });
  }
  return scores;
}

export type HybridSearchArgs = {
  libRoot: string;
  q: string;
  semantic: boolean;
  hfToken: string;
  embedModel: string;
};

export type HybridSearchResult = {
  keyword: KeywordHit[];
  semantic: HybridHit[];
  merged: HybridHit[];
};

/**
 * Hybrid search: keyword always; if `semantic` and HF token, embed query and scan chunks.
 */
export async function hybridSearch({
  libRoot,
  q,
  semantic,
  hfToken,
  embedModel,
}: HybridSearchArgs): Promise<HybridSearchResult> {
  const kw = await keywordSearch(libRoot, q);
  const kwRanked: HybridHit[] = kw.map((h, i) => ({
    ...h,
    kind: 'keyword',
    rank: i,
  }));

  if (!semantic || !hfToken || !embedModel) {
    return { keyword: kw, semantic: [], merged: kwRanked };
  }

  const queryVec = await embedQuery({
    token: hfToken,
    model: embedModel,
    text: q,
  });
  const chunks = await loadAllChunks(libRoot);
  const scored: HybridHit[] = chunks
    .map((c, i) => ({
      assetId: c.assetId,
      file: 'search/chunks.jsonl',
      chunk: i,
      snippet: c.text.slice(0, 200),
      score: cosineSimilarity(queryVec, c.embedding),
      kind: 'semantic',
      line: i + 1,
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 50);

  const rrf = reciprocalRankFusion([kwRanked, scored]);
  const merged = [...kwRanked, ...scored]
    .map((item) => {
      const key = `${item.assetId}::${item.file ?? ''}::${item.line ?? item.chunk ?? 0}`;
      return { ...item, rrf: rrf.get(key) ?? 0 };
    })
    .sort((a, b) => (b.rrf ?? 0) - (a.rrf ?? 0))
    .slice(0, 80);

  return { keyword: kw, semantic: scored, merged };
}
