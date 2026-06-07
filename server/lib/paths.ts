import path from 'node:path';

export type AssetPaths = {
  root: string;
  /** Prefix path for uploaded audio files (e.g. `audio.mp3`). */
  audioPrefix: string;
  transcript: string;
  runsDir: string;
  runsRawDir: string;
  searchDir: string;
  chunksJsonl: string;
  jobsDir: string;
  jobsState: string;
  exportsDir: string;
  notes: string;
};

/** Builds standard paths under one asset directory. */
export function assetPaths(libRoot: string, assetId: string): AssetPaths {
  const root = path.join(libRoot, assetId);
  return {
    root,
    audioPrefix: path.join(root, 'audio'),
    transcript: path.join(root, 'transcript.md'),
    runsDir: path.join(root, 'runs'),
    runsRawDir: path.join(root, 'runs', 'raw'),
    searchDir: path.join(root, 'search'),
    chunksJsonl: path.join(root, 'search', 'chunks.jsonl'),
    jobsDir: path.join(root, 'jobs'),
    jobsState: path.join(root, 'jobs', 'state.yaml'),
    exportsDir: path.join(root, 'exports'),
    notes: path.join(root, 'notes.md'),
  };
}

/** Slug for filenames from HF model id (e.g. openai/whisper-large-v3). */
export function modelSlug(modelId: string): string {
  return modelId.replace(/\//g, '__').replace(/[^a-zA-Z0-9._-]/g, '_');
}
