import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Decodes any container ffmpeg understands (mp4/m4a/webm/mp3/…) to 16 kHz mono
 * PCM WAV so ASR backends (Whisper, wav2vec, third-party routers) get a consistent format.
 */
export async function transcodeFileToWavForAsr(inputPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'wav',
      'pipe:1',
    ]);
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    let err = '';
    ff.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    ff.on('error', (e) =>
      reject(
        new Error(
          `ffmpeg not available (${(e as NodeJS.ErrnoException).code ?? e}). Install ffmpeg and add it to PATH.`,
        ),
      ),
    );
    ff.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(
        new Error(
          `ffmpeg transcoding failed (${code}): ${err.trim() || 'no stderr'}`,
        ),
      );
    });
  });
}

/**
 * Writes a buffer to a temp file with the given extension (helps ffmpeg probe), transcodes to WAV, removes temp input.
 */
export async function transcodeBufferToWavForAsr(
  input: Buffer,
  extWithDot: string,
): Promise<Buffer> {
  const tmp = os.tmpdir();
  const id = randomUUID();
  const ext = extWithDot.startsWith('.') ? extWithDot : `.${extWithDot}`;
  const safeExt = /^\.[a-zA-Z0-9]+$/.test(ext) ? ext : '.bin';
  const inPath = path.join(tmp, `va-asr-in-${id}${safeExt}`);
  try {
    await fs.writeFile(inPath, input);
    return await transcodeFileToWavForAsr(inPath);
  } finally {
    await fs.unlink(inPath).catch(() => {});
  }
}
