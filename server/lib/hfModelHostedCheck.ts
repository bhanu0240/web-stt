import { modelInfo } from '@huggingface/hub';

export type HostedAsrRoute = true | false | 'unknown';

/**
 * Whether Hub lists serverless inference routing for this ASR model
 * (`inferenceProviderMapping` non-empty). Returns `unknown` if the Hub call fails.
 */
export async function getHostedAsrInferenceRoute(opts: {
  modelId: string;
  accessToken?: string;
}): Promise<HostedAsrRoute> {
  try {
    const info = await modelInfo({
      name: opts.modelId,
      ...(opts.accessToken ? { accessToken: opts.accessToken } : {}),
      additionalFields: ['inferenceProviderMapping'],
    });
    const mapping = (info as { inferenceProviderMapping?: Record<string, unknown> })
      .inferenceProviderMapping;
    const hasRoute = Boolean(mapping && Object.keys(mapping).length > 0);
    return hasRoute ? true : false;
  } catch {
    return 'unknown';
  }
}
