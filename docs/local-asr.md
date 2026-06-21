# Local ASR (without HF Inference API)

By default, upload/record transcription uses Hugging Face **serverless Inference API** when a model supports it. You can instead run models **on your machine** via a Python [Transformers](https://huggingface.co/docs/transformers) ASR pipeline (`server/scripts/hf_local_asr.py`). Weights are still downloaded from the Hub; only inference runs locally (no HF Inference API calls for ASR).

## When local ASR is used

| Setup | Behavior |
|-------|----------|
| `HF_ASR_RUNTIME=local` | Always use the Python script (never HF Inference API for ASR). |
| `HF_ASR_RUNTIME=hosted` (default) | Use HF Inference API when the model has a serverless route; otherwise use Python if `HF_ASR_LOCAL_PYTHON` is set. Hosted failures with “no inference provider” also fall back to Python when configured. |

Library **embeddings** still use the HF API unless you change that separately. `HF_TOKEN` remains useful for gated models, prefetch, and search.

## Prerequisites

- **Python 3.10+**
- **ffmpeg** on PATH (audio is transcoded to 16 kHz mono WAV before ASR by default)
- Enough RAM/VRAM for the model (large Whisper checkpoints are heavy on CPU)

Install Python dependencies (prefer a virtualenv):

```bash
pip install "transformers[torch]" torch torchaudio soundfile accelerate
```

Some Hub checkpoints (e.g. NVIDIA Parakeet) need NeMo or another stack instead of `transformers.pipeline` — follow the model card if the script fails at load.

## Configure `.env`

Minimum for local transcription:

```env
HF_ASR_LOCAL_PYTHON=/absolute/path/to/python3
HF_TOKEN=hf_your_token_here
```

To **always** use local inference (skip HF Inference API for ASR):

```env
HF_ASR_RUNTIME=local
HF_ASR_LOCAL_PYTHON=/absolute/path/to/python3
```

Optional:

| Variable | Purpose |
|----------|---------|
| `HF_ASR_MODEL` | Default model (default: `openai/whisper-large-v3`) |
| `HF_ASR_LOCAL_SCRIPT` | Path to the helper script (default: `./server/scripts/hf_local_asr.py`) |
| `HF_ASR_TRUST_REMOTE_CODE=1` | Pass `--trust-remote-code` for models that need custom Hub code |
| `HF_LOCAL_MODEL_CACHE` | Cache dir for `snapshotDownload` when prefetching weights (default: `./data/.hf-cache/models`) |
| `HF_ASR_TRANSCODE` | Set `false` to skip ffmpeg normalization (default: `true`) |

Restart the server after changing `.env` (`npm start`).

## Smoke-test

Verify Python and the model before using the UI:

```bash
/path/to/python3 server/scripts/hf_local_asr.py \
  --model openai/whisper-large-v3 \
  --audio /path/to/16k_mono.wav
```

Successful runs print JSON to stdout. The first run may download multi-gigabyte weights.

With `HF_ASR_TRUST_REMOTE_CODE=1` in `.env`, add `--trust-remote-code` to the command for the same behavior.

## Runtime flow

1. Express transcodes the asset to WAV (unless `HF_ASR_TRANSCODE=false`).
2. Node spawns `hf_local_asr.py` with `--model`, `--audio`, and optional `--language` / `--trust-remote-code`.
3. The script loads the model via Transformers, runs ASR, and prints JSON.
4. The server maps that JSON into timed transcript segments.

The API also exposes this guide at `GET /api/hf/models` under `localAsrAdminGuide` when local Python is not configured.
