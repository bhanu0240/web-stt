# Contributing to web-stt

Thanks for your interest in contributing. This guide covers local setup, project layout, and expectations for changes.

## Prerequisites

- **Node.js** ≥ 20
- **ffmpeg** on your PATH (audio transcoding for ASR)
- A **Hugging Face token** with access to the models you plan to use ([create one](https://huggingface.co/settings/tokens))

For **local ASR** (run models via Python Transformers on your machine, not HF Inference API), see [docs/local-asr.md](docs/local-asr.md). In short:

- Python 3.10+ with `transformers`, `torch`, `torchaudio`, `soundfile`, `accelerate`
- `HF_ASR_LOCAL_PYTHON` pointing at that interpreter
- Optional `HF_ASR_RUNTIME=local` to always use local inference

## Local setup

1. Fork and clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment template and add your token:

   ```bash
   cp .env.example .env
   ```

   Set at least `HF_TOKEN`. See `.env.example` for ASR runtime, embedding model, library path, and other options. For local (non–Inference API) transcription, follow [docs/local-asr.md](docs/local-asr.md).

4. Start the dev stack (Vite UI + Express API):

   ```bash
   npm start
   ```

   - UI: http://localhost:5173
   - API: http://localhost:8787 (proxied from the UI as `/api`)

## Project layout

| Path | Role |
|------|------|
| `src/` | Browser UI (Vite, vanilla JS) |
| `server/` | Express API, Hugging Face integration, transcript library |
| `server/lib/` | Shared server modules (transcripts, ASR, search, jobs) |
| `server/scripts/` | Python helpers (e.g. local ASR) |
| `docs/` | Requirements and UI design notes |
| `data/library/` | Runtime transcript and asset storage (gitignored) |

The server reads `.env` from the project root. Do not commit `.env` or tokens.

## Development workflow

| Command | Purpose |
|---------|---------|
| `npm start` | Run UI and API together |
| `npm run dev` | Vite dev server only |
| `npm run dev:server` | Express API with watch reload |
| `npm run build` | Production UI build |
| `npm run build:server` | Compile server TypeScript |
| `npm run test:server` | Run server unit tests |

When changing server code, run `npm run test:server` before opening a pull request. Add or update tests in `server/lib/*.test.ts` when you change behavior in the corresponding module.

## Code conventions

- **TypeScript (server):** ESM modules (`.js` extensions in import paths). Match existing naming and file organization under `server/lib/`.
- **JavaScript (UI):** Keep changes in `src/` consistent with current patterns; no new framework unless discussed first.
- **New functions and classes:** Add a short comment describing their purpose and responsibility.
- **Transcripts:** Stored as Markdown with YAML front matter and timed segment lines. See `server/lib/transcript.ts` for the format and parsers.
- **Atomic writes:** Use `atomicWriteText` when persisting library files.
- **Secrets:** Never commit API keys, tokens, or local paths from your machine.

## UI changes

Follow the [Blend design system](docs/design.md): soft elevation instead of borders, warm neutrals, light typography, and gentle transitions. New UI work should feel consistent with the existing calm, minimal aesthetic.

## Submitting changes

1. Create a branch from `main` with a descriptive name.
2. Keep pull requests focused—one logical change per PR when possible.
3. In the PR description, include:
   - What changed and why
   - How you tested it (commands run, manual steps)
   - Any new env vars or setup steps
4. Ensure tests pass and the app runs with a fresh `.env` based on `.env.example`.

There is no issue template or CI gate yet; clear descriptions and test notes help reviewers.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project: [GNU General Public License v3.0](LICENSE.md).
