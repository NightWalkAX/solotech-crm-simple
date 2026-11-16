#!/usr/bin/env python3
"""Long-lived transcriber: reads one audio path per line on stdin, writes one JSON line per file on stdout.
Keeps the Whisper model loaded between voice notes. Run with ~/.venvs/whisper/bin/python (faster-whisper)."""
import json
import os
import sys

from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8')
print(json.dumps({'ready': True}), flush=True)

for line in sys.stdin:
    path = line.strip()
    if not path:
        continue
    try:
        segments, info = model.transcribe(path, beam_size=1, vad_filter=True)
        segs = [[round(s.start, 1), s.text.strip()] for s in segments if s.text.strip()]
        text = ' '.join(t for _, t in segs)
        print(json.dumps({'path': path, 'text': text, 'segments': segs, 'language': info.language, 'duration': round(info.duration, 1)}), flush=True)
    except Exception as e:  # one bad file must not kill the worker
        print(json.dumps({'path': path, 'error': str(e)}), flush=True)
