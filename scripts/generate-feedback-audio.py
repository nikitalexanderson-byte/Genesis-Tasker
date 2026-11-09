"""Author the original GENESIS feedback cues. Deterministic, offline, no samples.

Soft attacks and tails, pentatonic intervals, a quiet water/breath texture and
stereo echoes give the three families a common organic identity. No speech.
Run from any directory; WAVs are used unchanged by web and Android.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/feedback-audio"
RATE = 24000
EVENTS = {
    "completion": [0, 7],
    "daily-goal": [0, 7, 12],
    "perfect-day": [0, 4, 7, 12],
    "rank-up": [-5, 0, 7, 12, 16],
    "achievement": [7, 12, 16],
    "quest": [0, 5, 7, 12],
}


def render(scheme, event, intervals):
    rng = random.Random(f"genesis-feedback-v1/{scheme}/{event}")
    base, spacing, tail = {"calm": (392, .067, .34),
                           "epic": (293.665, .072, .40),
                           "futuristic": (440, .055, .32)}[scheme]
    duration = (len(intervals) - 1) * spacing + tail + .15
    count = math.ceil(duration * RATE)
    left, right = [0.] * count, [0.] * count
    for index, semitones in enumerate(intervals):
        frequency = base * 2 ** (semitones / 12)
        start = .012 + spacing * index
        phase = rng.random() * math.tau
        pan = .32 + .36 * (index % 2)
        for frame in range(int(tail * RATE)):
            t = frame / RATE
            envelope = (1 - math.exp(-t / .009)) * math.exp(-t / (tail / 5))
            envelope *= min(1., (tail - t) / .025)
            carrier = math.tau * frequency * t
            if scheme == "calm":
                # Rounded wooden/water chime with an almost imperceptible bird glide.
                voice = math.sin(carrier + .16 * math.exp(-t * 18) * math.sin(carrier * 1.5))
                voice += .17 * math.sin(carrier * 2.003 + phase) * math.exp(-t * 15)
            elif scheme == "epic":
                # Warm open fifths, without brassy transients or bass impacts.
                voice = .75 * math.sin(carrier) + .24 * math.sin(carrier * .5)
                voice += .16 * math.sin(carrier * 1.5) + .07 * math.sin(carrier * 2)
            else:
                # Soft FM crystal and a subtle downward droplet pitch bend.
                voice = math.sin(carrier + .65 * math.exp(-t * 12) * math.sin(carrier * 2))
                voice += .12 * math.sin(carrier * 1.005 + phase)
            breath = rng.uniform(-1, 1) * .012 * math.exp(-t * 35)
            sample = (voice + breath) * envelope * .18
            position = round(start * RATE) + frame
            for delay, gain, swap in [(0, 1., False), (.047, .17, True), (.103, .07, False)]:
                at = position + round(delay * RATE)
                if at < count:
                    p = 1 - pan if swap else pan
                    left[at] += sample * math.sqrt(1 - p)
                    right[at] += sample * math.sqrt(p)
    pcm = array.array("h")
    for a, b in zip(left, right):
        pcm.extend((round(max(-1, min(1, a)) * 32767), round(max(-1, min(1, b)) * 32767)))
    if sys.byteorder != "little":
        pcm.byteswap()
    path = OUT / f"{scheme}-{event}.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
        wav.writeframes(pcm.tobytes())
    peak = max(abs(v) for v in pcm) / 32768
    rms = math.sqrt(sum((v / 32768) ** 2 for v in pcm) / len(pcm))
    return {"file": path.name, "seconds": round(duration, 3), "peak": round(peak, 5),
            "rms": round(rms, 5), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    files = [render(scheme, event, intervals) for scheme in ("calm", "epic", "futuristic")
             for event, intervals in EVENTS.items()]
    (OUT / "manifest.json").write_text(json.dumps({"version": 1, "sampleRate": RATE,
        "license": "Original GENESIS procedural compositions; no third-party recordings.",
        "files": files}, indent=2) + "\n", encoding="utf-8")
    print(f"Authored {len(files)} cues; longest {max(f['seconds'] for f in files):.3f}s")
