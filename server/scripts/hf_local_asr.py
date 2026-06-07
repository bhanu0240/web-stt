#!/usr/bin/env python3
"""
Local ASR for the Node server: Transformers ASR pipeline on a WAV file, JSON to stdout.
Install: pip install "transformers[torch]" torch torchaudio soundfile accelerate
Some Hub models need extra deps or --trust-remote-code (see model card).
"""
from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--audio", required=True, help="Path to WAV (16 kHz mono recommended)")
    parser.add_argument("--language", default="", help="Hint e.g. en; empty or auto skips")
    parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="trust_remote_code=True for pipeline()",
    )
    args = parser.parse_args()

    import numpy as np
    import soundfile as sf
    from transformers import pipeline

    audio, sr = sf.read(args.audio, always_2d=True)
    audio = audio.mean(axis=1).astype(np.float32)

    pipe_kw: dict = {}
    if args.trust_remote_code:
        pipe_kw["trust_remote_code"] = True

    pipe = pipeline(
        "automatic-speech-recognition",
        model=args.model,
        **pipe_kw,
    )

    inputs = {"raw": audio, "sampling_rate": int(sr)}
    gen_kw: dict = {}
    if args.language and args.language not in ("auto", "hinglish"):
        gen_kw["language"] = args.language

    extra: dict = {}
    if gen_kw:
        extra["generate_kwargs"] = gen_kw

    out = None
    try:
        out = pipe(inputs, return_timestamps=True, **extra)
    except TypeError:
        try:
            out = pipe(inputs, return_timestamps="chunk", **extra)
        except TypeError:
            try:
                out = pipe(inputs, **extra)
            except TypeError:
                out = pipe(inputs)

    if not isinstance(out, dict):
        out = {"text": str(out)}
    print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e), "stage": "run"}), file=sys.stderr)
        sys.exit(1)
