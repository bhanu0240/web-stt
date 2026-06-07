import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { loadConfig } from './config.js';
import { assetPaths, modelSlug } from './lib/paths.js';
import { atomicWriteText } from './lib/atomicWrite.js';
import {
  parseTranscriptMarkdown,
  serializeTranscriptMarkdown,
  patchFrontmatter,
  type TranscriptSegment,
} from './lib/transcript.js';
import { readJobState, patchJobState } from './lib/jobs.js';
import { transcribeWithHuggingFace } from './lib/hfAsr.js';
import { embedPassage } from './lib/hfEmbed.js';
import { hybridSearch } from './lib/search.js';
import {
  HF_ASR_FALLBACK_MODELS,
  HF_EMBED_SHOWCASE_MODELS,
} from './lib/hfShowcaseModels.js';
import {
  fetchWarmAsrShowcaseModels,
  mergeAsrShowcaseRich,
} from './lib/hfWarmAsrCatalog.js';
import { fetchHubAsrModelsForUi } from './lib/hfHubAsrList.js';
import { prefetchAsrModelSnapshot } from './lib/hfLocalAsrPrefetch.js';
import { getHostedAsrInferenceRoute } from './lib/hfModelHostedCheck.js';
import { transcribeWithLocalPythonPipeline } from './lib/hfLocalAsrTranscribe.js';
import { LOCAL_ASR_ADMIN_GUIDE } from './lib/hfLocalAsrGuide.js';

const cfg = loadConfig();
const app = express();

/** Express v5 params can be string | string[]; coerce to string. */
function param(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}
const upload = multer({ dest: path.join(cfg.LIBRARY_ROOT, '.uploads') });

app.use(express.json());

/**
 * Zero-byte files make `send` (used by express.static) throw RangeNotSatisfiableError
 * when browsers send Range headers for <audio>. Skip static for those paths.
 */
async function guardNonEmptyLibraryFile(
  libRoot: string,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const raw = (req.url ?? '/').split('?')[0] ?? '/';
  const rel = raw.replace(/^\/+/, '');
  if (!rel) {
    next();
    return;
  }
  const abs = path.resolve(libRoot, rel);
  const base = path.resolve(libRoot);
  const relFromBase = path.relative(base, abs);
  if (relFromBase.startsWith('..') || path.isAbsolute(relFromBase)) {
    res.status(403).end();
    return;
  }
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    next();
    return;
  }
  if (st.isFile() && st.size === 0) {
    res.status(404).type('text/plain').send('Empty file');
    return;
  }
  next();
}

/** Serve audio/export files so the SPA player can access them. */
app.use('/api/audio', (req, res, next) =>
  guardNonEmptyLibraryFile(cfg.LIBRARY_ROOT, req, res, next),
);
app.use(
  '/api/audio',
  express.static(cfg.LIBRARY_ROOT, { fallthrough: true }),
);

// ──────────────────── Health ────────────────────

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, libraryRoot: cfg.LIBRARY_ROOT });
});

/** Hugging Face models for the UI: ASR from Hub SDK + warm REST + static fallback. */
app.get('/api/hf/models', async (_req: Request, res: Response) => {
  const warm = await fetchWarmAsrShowcaseModels().catch(() => []);
  const hub = await fetchHubAsrModelsForUi({
    accessToken: cfg.HF_TOKEN || undefined,
    limit: 150,
  }).catch(() => []);
  const asr = mergeAsrShowcaseRich([warm, hub, HF_ASR_FALLBACK_MODELS]);
  res.json({
    defaultAsrModel: cfg.HF_ASR_MODEL,
    defaultEmbedModel: cfg.HF_EMBED_MODEL,
    defaultAsrRuntime: cfg.HF_ASR_RUNTIME,
    embedding: HF_EMBED_SHOWCASE_MODELS,
    asr,
    asrCatalogNote:
      'Expanded via @huggingface/hub listModels (ASR, by downloads). “Serverless” = Hub inference mapping. “Hub only” models transcribe locally when HF_ASR_LOCAL_PYTHON is set (Transformers script; first run downloads weights).',
    localAsrAdminGuide: LOCAL_ASR_ADMIN_GUIDE,
  });
});

// ──────────────────── List assets ────────────────────

app.get('/api/assets', async (_req: Request, res: Response) => {
  try {
    await fs.mkdir(cfg.LIBRARY_ROOT, { recursive: true });
    const dirs = await fs.readdir(cfg.LIBRARY_ROOT, { withFileTypes: true });
    const assets = [];
    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      const p = assetPaths(cfg.LIBRARY_ROOT, d.name);
      try {
        const md = await fs.readFile(p.transcript, 'utf8');
        const { frontmatter, segments } = parseTranscriptMarkdown(md);
        const jobs = await readJobState(p.jobsState);
        assets.push({
          id: d.name,
          ...frontmatter,
          segmentCount: segments.length,
          jobs,
        });
      } catch {
        assets.push({ id: d.name, status: 'unknown' });
      }
    }
    res.json(assets);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────── Upload ────────────────────

app.post(
  '/api/assets',
  upload.array('files'),
  async (req: Request, res: Response) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      if (!files.length) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }
      for (const file of files) {
        try {
          const st = await fs.stat(file.path);
          if (!st.isFile() || st.size === 0) {
            throw new Error('empty');
          }
        } catch {
          await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
          res.status(400).json({
            error: `Invalid or empty upload: ${file.originalname}`,
          });
          return;
        }
      }

      const ids: string[] = [];
      for (const file of files) {
        const id = randomUUID();
        const p = assetPaths(cfg.LIBRARY_ROOT, id);
        await fs.mkdir(p.runsRawDir, { recursive: true });
        await fs.mkdir(p.jobsDir, { recursive: true });
        await fs.mkdir(p.searchDir, { recursive: true });

        const ext = path.extname(file.originalname) || '.wav';
        const audioPath = `${p.audioPrefix}${ext}`;
        await fs.rename(file.path, audioPath);

        const frontmatter: Record<string, unknown> = {
          title: file.originalname,
          sourceFilename: file.originalname,
          status: 'uploaded',
          languageHint:
            (req.body?.languageHint as string | undefined) ?? 'auto',
          durationMs: null,
          canonicalRun: null,
          createdAt: new Date().toISOString(),
        };
        await atomicWriteText(
          p.transcript,
          serializeTranscriptMarkdown(frontmatter, []),
        );
        ids.push(id);
      }
      res.json({ ids });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

// ──────────────────── Get asset ────────────────────

app.get('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    const id = param(req.params.id);
    const p = assetPaths(cfg.LIBRARY_ROOT, id);
    const md = await fs.readFile(p.transcript, 'utf8');
    const { frontmatter, segments } = parseTranscriptMarkdown(md);
    const jobs = await readJobState(p.jobsState);

    const audioFiles = (await fs.readdir(p.root)).filter((f) =>
      f.startsWith('audio'),
    );
    const audioFile = audioFiles[0] ?? null;
    let audioUrl: string | null = null;
    if (audioFile) {
      try {
        const ap = path.join(p.root, audioFile);
        const ast = await fs.stat(ap);
        if (ast.isFile() && ast.size > 0) {
          audioUrl = `/api/audio/${id}/${audioFile}`;
        }
      } catch {
        audioUrl = null;
      }
    }

    res.json({
      id,
      ...frontmatter,
      segments,
      jobs,
      audioUrl,
    });
  } catch {
    res.status(404).json({ error: 'Asset not found' });
  }
});

// ──────────────────── Patch metadata ────────────────────

app.patch('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    const p = assetPaths(cfg.LIBRARY_ROOT, param(req.params.id));
    const md = await fs.readFile(p.transcript, 'utf8');
    const { frontmatter, segments } = parseTranscriptMarkdown(md);
    const updated = patchFrontmatter(
      frontmatter,
      req.body as Record<string, unknown>,
    );
    await atomicWriteText(
      p.transcript,
      serializeTranscriptMarkdown(updated, segments),
    );
    res.json({ ok: true, frontmatter: updated });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────── Patch transcript body ────────────────────

app.patch(
  '/api/assets/:id/transcript',
  async (req: Request, res: Response) => {
    try {
      const p = assetPaths(cfg.LIBRARY_ROOT, param(req.params.id));
      const md = await fs.readFile(p.transcript, 'utf8');
      const { frontmatter } = parseTranscriptMarkdown(md);

      const newSegments = (req.body as { segments: TranscriptSegment[] })
        .segments;
      if (!Array.isArray(newSegments)) {
        res.status(400).json({ error: 'body.segments must be an array' });
        return;
      }
      await atomicWriteText(
        p.transcript,
        serializeTranscriptMarkdown(frontmatter, newSegments),
      );
      res.json({ ok: true, segmentCount: newSegments.length });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

function looksLikeNoInferenceProvider(err: unknown): boolean {
  const s = String(err instanceof Error ? err.message : err);
  return /inference provider|InferenceClientInputError|no inference provider/i.test(
    s,
  );
}

// ──────────────────── Transcribe ────────────────────

app.post(
  '/api/assets/:id/jobs/transcribe',
  async (req: Request, res: Response) => {
    const assetId = param(req.params.id);
    const p = assetPaths(cfg.LIBRARY_ROOT, assetId);
    const body = req.body as {
      strategies?: { model: string; provider?: string }[];
    };
    const strategies = body.strategies ?? [{ model: cfg.HF_ASR_MODEL }];

    res.json({
      ok: true,
      strategies: strategies.map((s) => ({
        model: s.model,
        provider: s.provider ?? cfg.HF_ASR_PROVIDER,
      })),
    });

    for (const strategy of strategies) {
      const slug = modelSlug(strategy.model);
      try {
        await patchJobState(p.jobsState, 'transcribe', {
          status: 'running',
          error: null,
        });

        const audioFiles = (await fs.readdir(p.root)).filter((f) =>
          f.startsWith('audio'),
        );
        if (!audioFiles.length) throw new Error('No audio file found');
        const audioName = audioFiles[0];
        const audioPath = path.join(p.root, audioName);
        const audioBuffer = cfg.HF_ASR_TRANSCODE
          ? undefined
          : await fs.readFile(audioPath);

        const mdRaw = await fs.readFile(p.transcript, 'utf8');
        const { frontmatter } = parseTranscriptMarkdown(mdRaw);
        const lang = (frontmatter.languageHint as string) ?? 'auto';
        const durationMs = (frontmatter.durationMs as number) ?? undefined;

        const maybePrefetchSnapshot = async () => {
          if (!cfg.HF_TOKEN) return;
          await prefetchAsrModelSnapshot({
            modelId: strategy.model,
            accessToken: cfg.HF_TOKEN,
            cacheDir: cfg.HF_LOCAL_MODEL_CACHE,
          }).catch(() => {});
        };

        const runLocalPythonAsr = async () => {
          if (!cfg.HF_ASR_LOCAL_PYTHON) {
            throw new Error(
              `${LOCAL_ASR_ADMIN_GUIDE}\n\n(No HF_ASR_LOCAL_PYTHON — cannot run Hub-only model: ${strategy.model})`,
            );
          }
          await maybePrefetchSnapshot();
          return transcribeWithLocalPythonPipeline({
            modelId: strategy.model,
            audioFilePath: audioPath,
            audioFilename: audioName,
            languageHint: lang,
            durationMs,
            transcodeForAsr: cfg.HF_ASR_TRANSCODE,
            pythonBin: cfg.HF_ASR_LOCAL_PYTHON,
            scriptPath: cfg.HF_ASR_LOCAL_SCRIPT,
            trustRemoteCode: cfg.HF_ASR_TRUST_REMOTE_CODE,
          });
        };

        const runHostedAsr = async () => {
          if (!cfg.HF_TOKEN) {
            throw new Error('HF_TOKEN is not set (required for hosted ASR)');
          }
          return transcribeWithHuggingFace({
            token: cfg.HF_TOKEN,
            model: strategy.model,
            audioBuffer,
            audioFilePath: audioPath,
            audioFilename: audioName,
            languageHint: lang,
            durationMs,
            provider: strategy.provider ?? cfg.HF_ASR_PROVIDER,
            transcodeForAsr: cfg.HF_ASR_TRANSCODE,
          });
        };

        let transcribeResult: { segments: TranscriptSegment[]; raw: unknown };

        if (cfg.HF_ASR_RUNTIME === 'local') {
          if (!cfg.HF_ASR_LOCAL_PYTHON) {
            throw new Error(
              'HF_ASR_RUNTIME=local requires HF_ASR_LOCAL_PYTHON (python3 with transformers). GET /api/hf/models includes localAsrAdminGuide.',
            );
          }
          transcribeResult = await runLocalPythonAsr();
        } else {
          const route = await getHostedAsrInferenceRoute({
            modelId: strategy.model,
            accessToken: cfg.HF_TOKEN || undefined,
          });

          if (route === true) {
            transcribeResult = await runHostedAsr();
          } else if (route === false) {
            transcribeResult = await runLocalPythonAsr();
          } else {
            try {
              transcribeResult = await runHostedAsr();
            } catch (e) {
              if (cfg.HF_ASR_LOCAL_PYTHON && looksLikeNoInferenceProvider(e)) {
                transcribeResult = await runLocalPythonAsr();
              } else {
                throw e;
              }
            }
          }
        }

        const { segments, raw } = transcribeResult;

        await atomicWriteText(
          path.join(p.runsRawDir, `${slug}.json`),
          JSON.stringify(raw, null, 2),
        );
        await atomicWriteText(
          path.join(p.runsDir, `${slug}.md`),
          serializeTranscriptMarkdown(
            {
              model: strategy.model,
              createdAt: new Date().toISOString(),
            },
            segments,
          ),
        );

        await patchJobState(p.jobsState, 'transcribe', {
          status: 'done',
          error: null,
        });

        if (!frontmatter.canonicalRun) {
          await promoteRun(p, slug, segments);
        }
      } catch (e) {
        await patchJobState(p.jobsState, 'transcribe', {
          status: 'failed',
          error: String(e),
        }).catch(() => {});
        console.error(`[transcribe] ${assetId}/${slug} failed:`, e);
      }
    }
  },
);

// ──────────────────── List runs ────────────────────

app.get(
  '/api/assets/:id/transcription-runs',
  async (req: Request, res: Response) => {
    try {
      const p = assetPaths(cfg.LIBRARY_ROOT, param(req.params.id));
      const files = await fs.readdir(p.runsDir).catch(() => [] as string[]);
      const runs = files
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({
          slug: f.replace(/\.md$/, ''),
          file: f,
        }));
      const jobs = await readJobState(p.jobsState);
      res.json({ runs, jobs });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

// ──────────────────── Get one run ────────────────────

app.get(
  '/api/assets/:id/transcription-runs/:slug',
  async (req: Request, res: Response) => {
    try {
      const slug = param(req.params.slug);
      const p = assetPaths(cfg.LIBRARY_ROOT, param(req.params.id));
      const runPath = path.join(p.runsDir, `${slug}.md`);
      const md = await fs.readFile(runPath, 'utf8');
      const { frontmatter, segments } = parseTranscriptMarkdown(md);
      res.json({ slug, ...frontmatter, segments });
    } catch {
      res.status(404).json({ error: 'Run not found' });
    }
  },
);

// ──────────────────── Promote run ────────────────────

app.post(
  '/api/assets/:id/transcription-runs/:slug/promote',
  async (req: Request, res: Response) => {
    try {
      const p = assetPaths(cfg.LIBRARY_ROOT, param(req.params.id));
      const slug = param(req.params.slug);
      const runPath = path.join(p.runsDir, `${slug}.md`);
      const md = await fs.readFile(runPath, 'utf8');
      const { segments } = parseTranscriptMarkdown(md);

      await promoteRun(p, slug, segments);
      res.json({ ok: true, canonicalRun: slug });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

/** Copies run segments into transcript.md and sets canonicalRun. */
async function promoteRun(
  p: ReturnType<typeof assetPaths>,
  slug: string,
  segments: TranscriptSegment[],
) {
  const md = await fs.readFile(p.transcript, 'utf8');
  const { frontmatter } = parseTranscriptMarkdown(md);
  const updated = patchFrontmatter(frontmatter, {
    canonicalRun: slug,
    status: 'ready',
  });
  await atomicWriteText(
    p.transcript,
    serializeTranscriptMarkdown(updated, segments),
  );
}

// ──────────────────── Search ────────────────────

app.get('/api/library/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '');
    const semantic = req.query.semantic === 'true';
    const results = await hybridSearch({
      libRoot: cfg.LIBRARY_ROOT,
      q,
      semantic,
      hfToken: cfg.HF_TOKEN,
      embedModel: cfg.HF_EMBED_MODEL,
    });
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────── Reindex (build chunks.jsonl) ────────────────────

app.post(
  '/api/assets/:id/jobs/reindex',
  async (req: Request, res: Response) => {
    const assetId = param(req.params.id);
    const p = assetPaths(cfg.LIBRARY_ROOT, assetId);

    res.json({ ok: true });

    try {
      await patchJobState(p.jobsState, 'embed', {
        status: 'running',
        error: null,
      });

      const md = await fs.readFile(p.transcript, 'utf8');
      const { segments } = parseTranscriptMarkdown(md);

      const CHUNK_SIZE = 5;
      const lines: string[] = [];
      for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
        const chunk = segments.slice(i, i + CHUNK_SIZE);
        const text = chunk.map((s) => s.text).join(' ');
        const startMs = chunk[0].startMs;
        const endMs = chunk[chunk.length - 1].endMs;

        const embedding = await embedPassage({
          token: cfg.HF_TOKEN,
          model: cfg.HF_EMBED_MODEL,
          text,
        });

        lines.push(
          JSON.stringify({
            assetId,
            startMs,
            endMs,
            text,
            embedding,
            embeddingModelId: cfg.HF_EMBED_MODEL,
            updatedAt: new Date().toISOString(),
          }),
        );
      }

      await atomicWriteText(p.chunksJsonl, lines.join('\n') + '\n');
      await patchJobState(p.jobsState, 'embed', {
        status: 'done',
        error: null,
      });
    } catch (e) {
      await patchJobState(p.jobsState, 'embed', {
        status: 'failed',
        error: String(e),
      }).catch(() => {});
      console.error(`[reindex] ${assetId} failed:`, e);
    }
  },
);

// ──────────────────── Export clip (FFmpeg) ────────────────────

app.post('/api/assets/:id/export', async (req: Request, res: Response) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);

  const assetId = param(req.params.id);
  const p = assetPaths(cfg.LIBRARY_ROOT, assetId);
  const { startMs, endMs, format } = req.body as {
    startMs: number;
    endMs: number;
    format?: string;
  };
  const ext = format === 'mp3' ? 'mp3' : 'wav';

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    res.status(400).json({ error: 'endMs must be greater than startMs' });
    return;
  }

  try {
    const audioFiles = (await fs.readdir(p.root)).filter((f) =>
      f.startsWith('audio'),
    );
    if (!audioFiles.length) {
      res.status(400).json({ error: 'No audio file' });
      return;
    }
    const inputPath = path.join(p.root, audioFiles[0]);

    await fs.mkdir(p.exportsDir, { recursive: true });
    const outName = `clip_${startMs}-${endMs}.${ext}`;
    const outPath = path.join(p.exportsDir, outName);

    const startSec = (startMs / 1000).toFixed(3);
    const durationSec = ((endMs - startMs) / 1000).toFixed(3);

    await execFileP('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-ss',
      startSec,
      '-t',
      durationSec,
      '-map',
      'a',
      outPath,
    ]);

    await patchJobState(p.jobsState, 'export', {
      status: 'done',
      error: null,
      lastFile: outName,
    });

    res.json({
      ok: true,
      downloadUrl: `/api/audio/${assetId}/exports/${outName}`,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────── Start ────────────────────

app.listen(cfg.PORT, () => {
  console.log(`[server] http://localhost:${cfg.PORT}`);
  console.log(`[server] LIBRARY_ROOT=${cfg.LIBRARY_ROOT}`);
});
