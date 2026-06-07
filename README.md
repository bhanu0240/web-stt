# web-stt

UI for speech-to-text transcription.

## Features

- Live transcribe via browser Speech Recognition API
- Upload/record audio and transcribe with Hugging Face models (hosted or local Python)
- Edit transcripts and search your library with HF embeddings

## Quickstart

1. `npm install`
2. `cp .env.example .env` - set `HF_TOKEN` ([HF token](https://huggingface.co/settings/tokens))
3. `npm start` → http://localhost:5173 (UI proxies `/api` to Express on 8787)

**Requires:** Node ≥ 20, [ffmpeg](https://ffmpeg.org/) on PATH. For hub-only/local models, also set `HF_ASR_LOCAL_PYTHON` and install deps listed in `.env.example`.

## Configuration

Server reads `.env` from the project root. See `.env.example` for all options. Main variables:

| Variable | Purpose |
|----------|---------|
| `HF_TOKEN` | Required for hosted ASR and embeddings |
| `HF_ASR_MODEL` | Default model (default: `openai/whisper-large-v3`) |
| `HF_ASR_RUNTIME` | `hosted` or `local` |
| `HF_ASR_LOCAL_PYTHON` | Python for local/hub-only ASR |
| `HF_EMBED_MODEL` | Embedding model for library search |
| `LIBRARY_ROOT` | Where assets and transcripts are stored |
| `API_PORT` | API port (default: 8787) |

## License

[GNU General Public License v3.0](LICENSE.md) (GPL-3.0).
