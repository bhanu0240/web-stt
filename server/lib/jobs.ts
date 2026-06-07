import fs from 'node:fs/promises';
import YAML from 'yaml';
import { atomicWriteText } from './atomicWrite.js';

export type JobSlice = {
  status: string;
  error: string | null;
  updatedAt: string | null;
  lastFile?: string | null;
};

export type JobState = {
  transcribe: JobSlice;
  embed: JobSlice;
  export: JobSlice;
};

const defaultState: JobState = {
  transcribe: { status: 'idle', error: null, updatedAt: null },
  embed: { status: 'idle', error: null, updatedAt: null },
  export: { status: 'idle', error: null, updatedAt: null, lastFile: null },
};

function mergeJobState(parsed: unknown): JobState {
  if (!parsed || typeof parsed !== 'object') return { ...defaultState };
  const o = parsed as Record<string, unknown>;
  return {
    transcribe: {
      ...defaultState.transcribe,
      ...(typeof o.transcribe === 'object' && o.transcribe !== null
        ? (o.transcribe as JobSlice)
        : {}),
    },
    embed: {
      ...defaultState.embed,
      ...(typeof o.embed === 'object' && o.embed !== null
        ? (o.embed as JobSlice)
        : {}),
    },
    export: {
      ...defaultState.export,
      ...(typeof o.export === 'object' && o.export !== null
        ? (o.export as JobSlice)
        : {}),
    },
  };
}

/** Reads jobs/state.yaml or returns defaults. */
export async function readJobState(statePath: string): Promise<JobState> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const data = YAML.parse(raw);
    return mergeJobState(data);
  } catch {
    return { ...defaultState };
  }
}

/** Persists full job state object. */
export async function writeJobState(
  statePath: string,
  state: JobState,
): Promise<void> {
  const yaml = YAML.stringify(state, { lineWidth: 120 });
  await atomicWriteText(statePath, yaml);
}

/** Patches one job key (e.g. transcribe) and writes atomically. */
export async function patchJobState(
  statePath: string,
  key: keyof JobState,
  partial: Partial<JobSlice>,
): Promise<JobState> {
  const cur = await readJobState(statePath);
  cur[key] = {
    ...cur[key],
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  await writeJobState(statePath, cur);
  return cur;
}
