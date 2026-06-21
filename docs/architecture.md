# Architecture

This document describes how **web-stt** is structured, how its pieces interact, and the main design decisions behind those choices. For setup and env vars, see the [README](../README.md). For UI aesthetics, see [design.md](design.md). For local ASR setup, see [local-asr.md](local-asr.md).

## Overview

web-stt is a speech-to-text library UI: upload or record audio, transcribe with Hugging Face models (hosted or local Python), edit timed transcripts, search across recordings, and export audio clips.

The app is intentionally small and file-backed. There is no database, job queue, or auth layer. A Vite dev server serves the browser UI; an Express API owns the transcript library and long-running work.

## System diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (src/)                                                 │
│  · Hash routing (#/, #/asset/:id)                               │
│  · Web Speech API + MediaRecorder (live captions)               │
│  · fetch → /api/* (proxied to Express in dev)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼────────────────────────────────────┐
│  Express API (server/app.ts)                                    │
│  · REST endpoints for assets, jobs, search, export              │
│  · Serves audio/exports from LIBRARY_ROOT via /api/audio        │
└─────┬───────────────────┬───────────────────┬───────────────────┘
      │                   │                   │
      ▼                   ▼                   ▼
┌─────────────┐   ┌───────────────┐   ┌───────────────────────────┐
│ LIBRARY_ROOT│   │ HF Inference  │   │ External tools            │
│ (filesystem)│   │ API + Hub SDK │   │ ffmpeg, python3 (local ASR)│
└─────────────┘   └───────────────┘   └───────────────────────────┘
```

## Dev and production layout

| Layer | Technology | Role |
|-------|------------|------|
| UI | Vite + vanilla JS (`src/`) | SPA shell, no framework |
| API | Express 5 + TypeScript (`server/`) | Library CRUD, ASR, search, export |
| Config | `.env` at project root | Loaded by Node in `server/config.ts` (not by Vite alone) |
| Dev | `npm start` | `concurrently` runs Vite (5173) and `tsx watch server/app.ts` (8787) |
| Proxy | `vite.config.js` | `/api` → `http://localhost:8787` |

**Design decision:** Keep the UI framework-free. The surface area is two routes (library list and asset detail) with imperative DOM rendering. That avoids build complexity and keeps the client easy to read alongside the server.

**Design decision:** Split UI and API processes in development. The API can be restarted independently, and the UI hot-reloads without touching server state. In production you would typically build the UI (`npm run build`) and either serve static files from Express or deploy UI and API separately with the same `/api` contract.

## Frontend architecture

### Entry and routing

- `index.html` mounts `#app` and loads `src/main.js`.
- Routing uses the URL hash: `#/` for the library, `#/asset/:uuid` for one recording.
- `render()` switches views on `hashchange`; there is no client-side router library.

### Modules

| File | Responsibility |
|------|----------------|
| `src/main.js` | Views, event wiring, live browser ASR, polling for server jobs |
| `src/api.js` | Thin `fetch` wrappers for every `/api` endpoint |
| `src/style.css` | [Blend design system](design.md) tokens and components |

### Live browser transcription

The library view offers **Browser (live)**: `SpeechRecognition` for interim/final captions and `MediaRecorder` on the same mic stream. After stop, the user can download the blob or upload it to the server library for HF ASR.

**Design decision:** Browser live transcription and server ASR are separate paths. Live captions are best-effort and browser-dependent (Chrome/Edge); server transcription is the durable, model-backed path. Upload from live recording reuses the language hint from the upload section.

### Server job polling

Transcription and reindex jobs run asynchronously on the server. The asset view polls `GET /api/assets/:id` every 2s while `jobs.transcribe` or `jobs.embed` is `running`, then re-renders when idle.

**Design decision:** Poll instead of WebSockets or SSE. Job duration is seconds to minutes, traffic is low, and the implementation stays simple for a local-first tool.

## Backend architecture

### Entry point

`server/app.ts` loads config, registers Express middleware and routes, and listens on `API_PORT` (default 8787). Business logic lives in `server/lib/`; the app file orchestrates HTTP and filesystem I/O.

### Library modules

| Module | Purpose |
|--------|---------|
| `config.ts` | Resolves env into typed `AppConfig` |
| `paths.ts` | Per-asset directory layout (`assetPaths`, `modelSlug`) |
| `transcript.ts` | Parse/serialize Markdown + YAML transcripts |
| `jobs.ts` | `jobs/state.yaml` read/write for job status |
| `atomicWrite.ts` | Temp file + rename for safe writes |
| `hfAsr.ts` | Hosted ASR via `@huggingface/inference` |
| `hfLocalAsrTranscribe.ts` | Spawns `server/scripts/hf_local_asr.py` |
| `hfEmbed.ts` | Query/passage embeddings for search |
| `search.ts` | Keyword scan + optional semantic hybrid search |
| `transcodeForAsr.ts` | ffmpeg → 16 kHz mono WAV |
| `hfHubAsrList.ts`, `hfWarmAsrCatalog.ts`, `hfShowcaseModels.ts` | ASR model catalog for the UI |
| `hfModelHostedCheck.ts` | Whether a model has a serverless inference route |
| `hfLocalAsrPrefetch.ts` | Optional Hub snapshot prefetch for local ASR |

## Data model: filesystem library

Each asset is a UUID directory under `LIBRARY_ROOT` (default `data/library/`). Nothing is stored in a DB; the directory tree is the source of truth.

```
{LIBRARY_ROOT}/{assetId}/
├── audio.{ext}              # uploaded source
├── transcript.md            # canonical transcript + metadata (YAML front matter)
├── runs/
│   ├── {modelSlug}.md       # per-model transcription run
│   └── raw/{modelSlug}.json # raw ASR API / pipeline output
├── search/
│   └── chunks.jsonl         # embedding chunks for semantic search
├── jobs/
│   └── state.yaml           # transcribe / embed / export job status
└── exports/                 # ffmpeg clip outputs
```

**Design decision:** File-backed storage keeps the project portable, debuggable, and git-friendly (except runtime data under `data/`, which is gitignored). Users can inspect or back up `transcript.md` directly.

**Design decision:** Separate **canonical transcript** (`transcript.md`) from **transcription runs** (`runs/`). Multiple ASR models can be tried; one run is promoted to canonical via `canonicalRun` in front matter. Raw JSON preserves provider output for debugging or future tooling.

### Transcript format

Defined in `server/lib/transcript.ts`:

- YAML front matter between `---` delimiters (title, status, languageHint, canonicalRun, etc.).
- Body lines: `[startMs-endMs] text` or `[startMs-endMs] Speaker> text`.

This format is human-readable, diff-friendly, and parseable without extra dependencies beyond a small YAML subset parser for front matter.

### Job state

`jobs/state.yaml` tracks three job types: `transcribe`, `embed`, `export`. Each has `status` (`idle` | `running` | `done` | `failed`), optional `error`, and `updatedAt`.

**Design decision:** Jobs are fire-and-forget from the HTTP handler’s perspective. The handler responds immediately with `{ ok: true }` and continues work in the same Node process. There is no queue worker; acceptable for single-user local use. Failed jobs record the error string on disk for the UI badge tooltip.

## ASR pipeline

Two backends produce the same `TranscriptSegment[]` shape:

### Hosted (default)

- `@huggingface/inference` `automaticSpeechRecognition` with `return_timestamps: true`.
- Default provider `hf-inference` (avoids fal-ai data-URL limits on binary audio).
- Optional ffmpeg transcode to 16 kHz mono WAV before upload (`HF_ASR_TRANSCODE`, default on).

### Local Python

- `server/scripts/hf_local_asr.py` via Transformers ASR pipeline.
- Triggered when `HF_ASR_RUNTIME=local`, when Hub reports no serverless route, or when hosted fails with “no inference provider” and `HF_ASR_LOCAL_PYTHON` is set.
- Model weights downloaded from Hub; inference runs on the machine (see [local-asr.md](local-asr.md)).

**Design decision:** Dual runtime with automatic fallback. Hosted is fast to try and needs no GPU setup; local unlocks Hub-only models and avoids Inference API limits. Routing logic is centralized in the transcribe handler in `app.ts`.

**Design decision:** Python runs out-of-process. Node stays lightweight; users bring their own torch/transformers stack. Model IDs are validated before spawn to reduce subprocess injection risk.

After a successful run, if no `canonicalRun` exists yet, the server auto-promotes that run into `transcript.md`.

## Search and embeddings

1. **Reindex** (`POST .../jobs/reindex`): chunks transcript segments (5 segments per chunk), calls HF embeddings API for each chunk, writes `search/chunks.jsonl`.
2. **Search** (`GET /api/library/search`):
   - Always runs keyword substring scan over `transcript.md` and `runs/*.md`.
   - With `semantic=true` and `HF_TOKEN`, embeds the query and scores chunks by cosine similarity.
   - Merges lists with reciprocal rank fusion (RRF).

**Design decision:** Embeddings are precomputed per asset, not at query time across the whole library text. Query-time work is one embedding call plus in-memory similarity over loaded chunks—fine for personal libraries, not built for huge corpora.

**Design decision:** Hybrid search defaults to keyword-only unless the user checks “Semantic”. That avoids HF API calls for simple greps.

## Export

Clip export uses ffmpeg on the server: `-ss` / `-t` from user-selected millisecond range, output to `exports/`, served under `/api/audio/{id}/exports/...`.

## API surface (summary)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness + library root |
| GET | `/api/hf/models` | ASR/embed catalog for UI |
| GET/POST | `/api/assets` | List / upload |
| GET/PATCH | `/api/assets/:id` | Read / patch metadata |
| PATCH | `/api/assets/:id/transcript` | Replace segments |
| POST | `/api/assets/:id/jobs/transcribe` | Start ASR (async) |
| GET | `/api/assets/:id/transcription-runs` | List runs |
| GET | `/api/assets/:id/transcription-runs/:slug` | One run |
| POST | `/api/assets/:id/transcription-runs/:slug/promote` | Set canonical |
| POST | `/api/assets/:id/jobs/reindex` | Build embeddings (async) |
| POST | `/api/assets/:id/export` | ffmpeg clip |
| GET | `/api/library/search` | Keyword / hybrid search |
| GET | `/api/audio/*` | Static files from library |

## Configuration

All server config comes from environment variables (see `.env.example`). Notable defaults:

| Variable | Default | Notes |
|----------|---------|-------|
| `HF_ASR_MODEL` | `openai/whisper-large-v3` | Default when UI leaves model blank |
| `HF_ASR_RUNTIME` | `hosted` | `local` forces Python path |
| `HF_ASR_TRANSCODE` | `true` | ffmpeg before ASR |
| `HF_EMBED_MODEL` | `intfloat/multilingual-e5-small` | Search embeddings |
| `LIBRARY_ROOT` | `./data/library` | Asset storage |

`OPENAI_API_KEY` and `OPENAI_REFINE_MODEL` are defined in config for planned LLM transcript refinement (see [REQUIREMENTS.md](REQUIREMENTS.md)); that flow is not implemented yet.

## Security and trust boundaries

- Intended as a **local dev tool**: no authentication, no multi-tenant isolation.
- Uploads land under `LIBRARY_ROOT`; `/api/audio` static serving validates paths stay inside the library root.
- Local ASR validates Hub model ID format before passing to Python.
- Secrets (`HF_TOKEN`, etc.) live in `.env` only; never commit them.

## UI design

Visual and interaction rules live in [design.md](design.md) (Blend: soft elevation, no borders, warm neutrals). The architecture doc does not duplicate palette tokens; UI changes should follow that guide.

## Testing

Server unit tests live beside modules (e.g. `server/lib/transcript.test.ts`). Run with `npm run test:server`. Prefer tests on pure parsers and format logic; full ASR paths are integration-heavy and documented for manual smoke tests in [local-asr.md](local-asr.md).

## Related documents

| Document | Contents |
|----------|----------|
| [REQUIREMENTS.md](REQUIREMENTS.md) | Product goals (including future LLM refine) |
| [design.md](design.md) | Blend UI system |
| [local-asr.md](local-asr.md) | Python ASR setup and runtime matrix |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Dev workflow and conventions |
