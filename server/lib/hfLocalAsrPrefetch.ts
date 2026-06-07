import { snapshotDownload } from '@huggingface/hub';

/**
 * Downloads a model repo snapshot into `cacheDir` (weights on disk for a future local runner).
 * Used when `HF_ASR_RUNTIME=local`; inference still requires `HF_ASR_LOCAL_CMD` or similar.
 */
export async function prefetchAsrModelSnapshot(opts: {
  modelId: string;
  accessToken: string;
  cacheDir: string;
}): Promise<string> {
  const folder = await snapshotDownload({
    repo: opts.modelId,
    accessToken: opts.accessToken,
    cacheDir: opts.cacheDir,
  });
  return folder;
}
