import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/loadEnvFile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Node does not read `.env` by itself (unlike Vite). Load repo `.env`, then cwd (override).
loadEnvFile(path.join(projectRoot, '.env'), false);
loadEnvFile(path.join(process.cwd(), '.env'), true);

export type AppConfig = {
  projectRoot: string;
  LIBRARY_ROOT: string;
  PORT: number;
  HF_TOKEN: string;
  HF_ASR_MODEL: string;
  /** Routing for ASR (`auto` = HF dashboard order; `hf-inference` avoids fal-ai data URL limits). */
  HF_ASR_PROVIDER: string;
  /** When true, ffmpeg normalizes input to 16 kHz mono WAV before ASR (mp4/m4a/webm/…). */
  HF_ASR_TRANSCODE: boolean;
  /** `hosted` = @huggingface/inference serverless; `local` = snapshot weights via Hub only (no in-process ASR yet). */
  HF_ASR_RUNTIME: 'hosted' | 'local';
  /** Cache directory for `snapshotDownload` when `HF_ASR_RUNTIME=local`. */
  HF_LOCAL_MODEL_CACHE: string;
  /** Absolute path to `python3` (or venv) for Hub-only ASR via `server/scripts/hf_local_asr.py`. */
  HF_ASR_LOCAL_PYTHON: string;
  /** Path to the local ASR helper script (Transformers pipeline). */
  HF_ASR_LOCAL_SCRIPT: string;
  /** When true, passes `--trust-remote-code` to the local ASR script. */
  HF_ASR_TRUST_REMOTE_CODE: boolean;
  HF_EMBED_MODEL: string;
  OPENAI_API_KEY: string;
  OPENAI_REFINE_MODEL: string;
};

/** Resolved server configuration from environment. */
export function loadConfig(): AppConfig {
  const LIBRARY_ROOT = path.resolve(
    process.env.LIBRARY_ROOT ?? path.join(projectRoot, 'data', 'library'),
  );
  const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
  const HF_TOKEN = process.env.HF_TOKEN ?? '';
  const HF_ASR_MODEL =
    process.env.HF_ASR_MODEL ?? 'openai/whisper-large-v3';
  const HF_ASR_PROVIDER = process.env.HF_ASR_PROVIDER ?? 'hf-inference';
  const HF_ASR_TRANSCODE = process.env.HF_ASR_TRANSCODE !== 'false';
  const HF_ASR_RUNTIME: 'hosted' | 'local' =
    process.env.HF_ASR_RUNTIME === 'local' ? 'local' : 'hosted';
  const HF_LOCAL_MODEL_CACHE = path.resolve(
    process.env.HF_LOCAL_MODEL_CACHE ??
      path.join(projectRoot, 'data', '.hf-cache', 'models'),
  );
  const HF_ASR_LOCAL_PYTHON = (process.env.HF_ASR_LOCAL_PYTHON ?? '').trim();
  const HF_ASR_LOCAL_SCRIPT = path.resolve(
    process.env.HF_ASR_LOCAL_SCRIPT ??
      path.join(projectRoot, 'server', 'scripts', 'hf_local_asr.py'),
  );
  const HF_ASR_TRUST_REMOTE_CODE =
    process.env.HF_ASR_TRUST_REMOTE_CODE === 'true' ||
    process.env.HF_ASR_TRUST_REMOTE_CODE === '1';
  const HF_EMBED_MODEL =
    process.env.HF_EMBED_MODEL ?? 'intfloat/multilingual-e5-small';
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
  const OPENAI_REFINE_MODEL = process.env.OPENAI_REFINE_MODEL ?? 'gpt-4o-mini';

  return {
    projectRoot,
    LIBRARY_ROOT,
    PORT,
    HF_TOKEN,
    HF_ASR_MODEL,
    HF_ASR_PROVIDER,
    HF_ASR_TRANSCODE,
    HF_ASR_RUNTIME,
    HF_LOCAL_MODEL_CACHE,
    HF_ASR_LOCAL_PYTHON,
    HF_ASR_LOCAL_SCRIPT,
    HF_ASR_TRUST_REMOTE_CODE,
    HF_EMBED_MODEL,
    OPENAI_API_KEY,
    OPENAI_REFINE_MODEL,
  };
}
