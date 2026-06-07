import path from 'node:path';
import { HfInference, type InferenceProviderOrPolicy } from '@huggingface/inference';
import { formatSegmentLine, type TranscriptSegment } from './transcript.js';
import {
  transcodeBufferToWavForAsr,
  transcodeFileToWavForAsr,
} from './transcodeForAsr.js';

export type TranscribeArgs = {
  token: string;
  model: string;
  audioBuffer?: Buffer | Uint8Array;
  languageHint: string | undefined;
  durationMs: number | undefined;
  /** Stored filename (e.g. `audio.mp3`); used so the Blob gets a correct `type` for routers like fal-ai. */
  audioFilename?: string;
  /** Overrides MIME when the filename does not carry a reliable extension. */
  audioMimeType?: string;
  /** Inference provider; `hf-inference` sends binary to HF API (fal-ai rejects data URLs). */
  provider?: InferenceProviderOrPolicy | string;
  /** Absolute path to source audio (preferred when transcoding — avoids copying large mp4 into RAM twice). */
  audioFilePath?: string;
  /** When true, decode to 16 kHz mono WAV via ffmpeg before calling the model. */
  transcodeForAsr?: boolean;
};

export type TranscribeResult = {
  segments: TranscriptSegment[];
  raw: unknown;
};

/** Maps file extension to an audio/* MIME type for ASR request bodies. */
export function audioMimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.m4a': 'audio/m4a',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.opus': 'audio/opus',
    '.wma': 'audio/x-ms-wma',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Guesses audio MIME from leading bytes when the filename is ambiguous. */
function sniffAudioMimeType(buffer: Buffer | Uint8Array): string | null {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (b.length < 12) return null;
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (b.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  if (b.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (b.length >= 8 && b.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'audio/m4a';
  }
  return null;
}

/**
 * Runs Hugging Face automatic speech recognition with timestamps when supported.
 * Returns segments in milliseconds and raw payload for disk.
 */
export async function transcribeWithHuggingFace({
  token,
  model,
  audioBuffer,
  languageHint,
  durationMs,
  audioFilename,
  audioMimeType,
  provider = 'hf-inference',
  audioFilePath,
  transcodeForAsr = true,
}: TranscribeArgs): Promise<TranscribeResult> {
  if (!token) {
    throw new Error('HF_TOKEN is not set');
  }

  if (
    transcodeForAsr &&
    !audioFilePath &&
    (!audioBuffer || audioBuffer.byteLength === 0)
  ) {
    throw new Error('transcoding requires audioFilePath or non-empty audioBuffer');
  }
  if (
    !transcodeForAsr &&
    (!audioBuffer || audioBuffer.byteLength === 0)
  ) {
    throw new Error('audioBuffer required when HF_ASR_TRANSCODE is false');
  }

  const hf = new HfInference(token);
  const parameters: Record<string, unknown> = { return_timestamps: true };
  if (languageHint && languageHint !== 'auto' && languageHint !== 'hinglish') {
    parameters.language = languageHint;
  }

  let payload: Buffer | Uint8Array;
  let blobType: string;

  if (transcodeForAsr) {
    const ext = audioFilename ? path.extname(audioFilename) : '.wav';
    payload = audioFilePath
      ? await transcodeFileToWavForAsr(audioFilePath)
      : await transcodeBufferToWavForAsr(
          Buffer.from(audioBuffer!),
          ext || '.wav',
        );
    blobType = 'audio/wav';
  } else {
    const buf = Buffer.isBuffer(audioBuffer!)
      ? audioBuffer!
      : Buffer.from(audioBuffer!);
    payload = buf;
    const mime =
      audioMimeType?.trim() ||
      (audioFilename ? audioMimeTypeFromFilename(audioFilename) : '') ||
      '';
    const fromExt = mime && mime !== 'application/octet-stream' ? mime : '';
    const fromSniff = sniffAudioMimeType(buf);
    const rawType = fromExt || fromSniff || 'audio/wav';
    blobType = rawType === 'audio/mp4' ? 'audio/m4a' : rawType;
  }

  const blob = new Blob([payload], { type: blobType });

  let out;
  try {
    out = await hf.automaticSpeechRecognition({
      provider: provider as InferenceProviderOrPolicy,
      inputs: blob,
      model,
      parameters,
    });
  } catch (e) {
    try {
      out = await hf.automaticSpeechRecognition({
        provider: provider as InferenceProviderOrPolicy,
        inputs: blob,
        model,
      });
    } catch {
      throw e;
    }
  }

  const raw = out;
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

  return { segments, raw };
}
