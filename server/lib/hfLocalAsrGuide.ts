/** Shown when a Hub-only model is chosen but local Python ASR is not configured. */
export const LOCAL_ASR_ADMIN_GUIDE = `Hub-only models (no serverless inference route) can run locally via Python Transformers.

1) Install a recent Python 3.10+ and:
   pip install "transformers[torch]" torch torchaudio soundfile accelerate

2) For some checkpoints (e.g. NVIDIA Parakeet) the Hub card may require NeMo or another stack instead of transformers.pipeline — follow that card if the script fails at load.

3) In your .env set:
   HF_ASR_LOCAL_PYTHON=/path/to/python3
   (optional) HF_ASR_LOCAL_SCRIPT=/path/to/server/scripts/hf_local_asr.py

4) Ensure HF_TOKEN is set if the model is gated.

5) Smoke-test:
   HF_ASR_LOCAL_PYTHON python3 server/scripts/hf_local_asr.py --model YOUR_ORG/YOUR_MODEL --audio /path/to/16k_mono.wav

With this set, the server will run that script automatically for Hub-only models (first run may download multi-GB weights).`;
