import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
import os from 'node:os';
import path from 'node:path';
import { transcodeFileToWavForAsr } from './transcodeForAsr.js';
import { formatSegmentLine, type TranscriptSegment } from './transcript.js';

const HUB_MODEL_ID_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?\/[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/** Rejects shell metacharacters in Hub model ids passed to a subprocess. */
export function assertSafeHubModelIdForLocalAsr(modelId: string): void {
  if (!HUB_MODEL_ID_RE.test(modelId)) {
    throw new Error(
      `Refusing local ASR: model id must match Hub org/name pattern, got: ${modelId}`,
    );
  }
}

/** Maps Transformers ASR pipeline JSON (text / chunks) into transcript segments. */
function segmentsFromLocalPipelineJson(
  out: { text?: string; chunks?: Array<{ text?: string; timestamp?: unknown }> },
  durationMs: number | undefined,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const chunks = out?.chunks;
  if (Array.isArray(chunks) && chunks.length > 0) {
    for (const ch of chunks) {
      const ts = ch.timestamp;
      let startMs = 0;
      let endMs = durationMs ?? 0;
      if (Array.isArray(ts) && ts.length >= 2) {
        startMs = Math.round(Number(ts[0]) * 1000);
        endMs = Math.round(Number(ts[1]) * 1000);
      }
      const text = (ch.text ?? '').trim();
      if (!text) continue;
      segments.push({ startMs, endMs, speaker: null, text, raw: '' });
    }
  } else {
    const text = (out?.text ?? '').trim();
    const end = durationMs ?? (text ? 60_000 : 0);
    if (text) {
      segments.push({
        startMs: 0,
        endMs: end,
        speaker: null,
        text,
        raw: '',
      });
    }
  }
  for (const seg of segments) {
    seg.raw = formatSegmentLine(seg);
  }
  return segments;
}

export type LocalPythonAsrArgs = {
  modelId: string;
  /** Original asset audio path (any format ffmpeg accepts when transcode is on). */
  audioFilePath: string;
  audioFilename: string;
  languageHint: string | undefined;
  durationMs: number | undefined;
  transcodeForAsr: boolean;
  pythonBin: string;
  scriptPath: string;
  /** When true, passes --trust-remote-code to the script (HF_ASR_TRUST_REMOTE_CODE=1). */
  trustRemoteCode: boolean;
};

/**
 * Runs `server/scripts/hf_local_asr.py` (Transformers) on 16 kHz mono WAV derived from the asset.
 */
export async function transcribeWithLocalPythonPipeline(
  args: LocalPythonAsrArgs,
): Promise<{ segments: TranscriptSegment[]; raw: unknown }> {
  assertSafeHubModelIdForLocalAsr(args.modelId);

  await fs.access(args.scriptPath);

  let wavPath: string;
  let wavCleanup: string | null = null;
  if (args.transcodeForAsr) {
    const buf = await transcodeFileToWavForAsr(args.audioFilePath);
    wavPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'local-asr-')),
      'in.wav',
    );
    wavCleanup = path.dirname(wavPath);
    await fs.writeFile(wavPath, buf);
  } else {
    wavPath = args.audioFilePath;
  }

  const pyArgs = [
    args.scriptPath,
    '--model',
    args.modelId,
    '--audio',
    wavPath,
    '--language',
    args.languageHint ?? '',
  ];
  if (args.trustRemoteCode) pyArgs.push('--trust-remote-code');

  try {
    const { stdout, stderr } = await execFile(args.pythonBin, pyArgs, {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 1_800_000,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error(`Local ASR produced no stdout. stderr: ${stderr || '(empty)'}`);
    }
    let out: { error?: string; text?: string; chunks?: unknown[] };
    try {
      out = JSON.parse(trimmed) as {
        error?: string;
        text?: string;
        chunks?: unknown[];
      };
    } catch {
      throw new Error(
        `Local ASR stdout is not JSON. First 500 chars: ${trimmed.slice(0, 500)}`,
      );
    }
    if (out.error) {
      throw new Error(`Local ASR (Python): ${out.error}`);
    }
    const segments = segmentsFromLocalPipelineJson(out, args.durationMs);
    return { segments, raw: out };
  } catch (e) {
    let detail = e instanceof Error ? e.message : String(e);
    if (typeof e === 'object' && e !== null && 'stderr' in e) {
      const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
      if (stderr) detail += ` | stderr: ${stderr}`;
    }
    throw new Error(
      `Local ASR failed for ${args.modelId}: ${detail}. Check Python deps and the model card on the Hub.`,
    );
  } finally {
    if (wavCleanup) {
      await fs.rm(wavCleanup, { recursive: true, force: true }).catch(() => {});
    }
  }
}
