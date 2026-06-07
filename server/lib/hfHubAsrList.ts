import { listModels } from '@huggingface/hub';
import type { ShowcaseModel } from './hfShowcaseModels.js';

/** Short label from a Hub model id for combobox display. */
function labelFromModelId(id: string): string {
  const repo = id.includes('/') ? id.split('/').slice(1).join(' / ') : id;
  return repo.replace(/-/g, ' ');
}

/** True when Hub returns a non-empty inference provider map (serverless routing). */
function hasHostedInferenceRouting(
  m: ModelEntryWithInference,
): boolean {
  const map = m.inferenceProviderMapping;
  if (!map || typeof map !== 'object') return false;
  return Object.keys(map as object).length > 0;
}

type ModelEntryWithInference = {
  name: string;
  downloads: number;
  inferenceProviderMapping?: Record<string, unknown>;
};

/**
 * Lists popular ASR models from the Hub via @huggingface/hub (`listModels`),
 * expanding the UI beyond the tiny `inference=warm` REST filter.
 */
export async function fetchHubAsrModelsForUi(opts: {
  accessToken?: string;
  limit?: number;
}): Promise<ShowcaseModel[]> {
  const limit = opts.limit ?? 150;
  const out: ShowcaseModel[] = [];
  for await (const m of listModels({
    ...(opts.accessToken ? { accessToken: opts.accessToken } : {}),
    search: { task: 'automatic-speech-recognition' },
    sort: 'downloads',
    limit,
    additionalFields: ['inferenceProviderMapping'],
  })) {
    const row = m as ModelEntryWithInference;
    out.push({
      id: row.name,
      label: labelFromModelId(row.name),
      hostedInference: hasHostedInferenceRouting(row),
      downloads: row.downloads,
    });
  }
  return out;
}
