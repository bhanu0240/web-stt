import type { ShowcaseModel } from './hfShowcaseModels.js';

/** Builds a short display label from a Hub model id. */
function labelFromModelId(id: string): string {
  const parts = id.split('/');
  const repo = parts.slice(1).join('/') || id;
  return repo.replace(/-/g, ' ');
}

/**
 * Merges several ASR showcase lists by `id`, preferring `hostedInference: true`,
 * then higher `downloads`, for ordering.
 */
export function mergeAsrShowcaseRich(lists: ShowcaseModel[][]): ShowcaseModel[] {
  const byId = new Map<string, ShowcaseModel>();
  for (const list of lists) {
    for (const m of list) {
      const prev = byId.get(m.id);
      if (!prev) {
        byId.set(m.id, { ...m });
        continue;
      }
      const hosted =
        prev.hostedInference === true || m.hostedInference === true
          ? true
          : prev.hostedInference === false || m.hostedInference === false
            ? false
            : undefined;
      byId.set(m.id, {
        id: m.id,
        label: (m.label?.length ?? 0) > (prev.label?.length ?? 0) ? m.label : prev.label,
        hostedInference: hosted,
        downloads: Math.max(prev.downloads ?? 0, m.downloads ?? 0),
      });
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ha = a.hostedInference === true ? 1 : 0;
    const hb = b.hostedInference === true ? 1 : 0;
    if (hb !== ha) return hb - ha;
    return (b.downloads ?? 0) - (a.downloads ?? 0);
  });
}

/**
 * Fetches ASR models Hugging Face exposes with serverless inference routing
 * (`inference=warm`). Returns an empty array if the API responds with no rows.
 */
export async function fetchWarmAsrShowcaseModels(): Promise<ShowcaseModel[]> {
  const sp = new URLSearchParams({
    pipeline_tag: 'automatic-speech-recognition',
    inference: 'warm',
    limit: '100',
  });
  const url = `https://huggingface.co/api/models?${sp.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HF Hub models API returned ${res.status}`);
  }
  const rows = (await res.json()) as {
    id: string;
    likes?: number;
    downloads?: number;
  }[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  const sorted = [...rows].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  return sorted.map((m) => ({
    id: m.id,
    label: labelFromModelId(m.id),
    hostedInference: true,
    downloads: m.downloads,
  }));
}
