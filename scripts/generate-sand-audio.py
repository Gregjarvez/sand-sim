"""Create an original, seamless dry-sand friction texture (no sampled recordings)."""
import math
from pathlib import Path
import random
import struct
import wave

RATE = 32000
LENGTH = RATE * 12
FADE = RATE // 4
rng = random.Random(731)
samples = []
low = body = flutter = envelope = 0.0
metal_a = metal_b = 0.0
radius = math.exp(-1 / (RATE * 0.009))
resonance = 2 * radius * math.cos(2 * math.pi * 2900 / RATE)
for i in range(LENGTH + FADE):
    white = rng.uniform(-1, 1)
    low += 0.48 * (white - low)
    body += 0.025 * (low - body)
    flutter += 0.0015 * (rng.uniform(-1, 1) - flutter)
    # Dense, tiny grain contacts riding on broad, softly filtered friction.
    contact = rng.random() < 100 / RATE
    impulse = rng.uniform(-1, 1) if contact else 0.0
    envelope = max(envelope * 0.983, abs(impulse))
    metal = resonance * metal_a - radius * radius * metal_b + impulse
    metal_b, metal_a = metal_a, metal
    friction = (low - body) * (0.55 + envelope * 0.45 + flutter * 3)
    # A heavily damped metallic edge, without a sustained ring or obvious tone.
    samples.append(friction + metal * 0.009)

# Join through a crossfade, with continuous samples on both sides of the wrap.
for i in range(FADE):
    t = i / FADE
    samples[i] = samples[LENGTH + i] * (1 - t) + samples[i] * t
samples = samples[:LENGTH]
mean = sum(samples) / LENGTH
samples = [x - mean for x in samples]
rms = math.sqrt(sum(x*x for x in samples) / LENGTH)
gain = min(0.12 / rms, 0.8 / max(abs(x) for x in samples))
pcm = [round(x * gain * 32767) for x in samples]
output = Path(__file__).resolve().parents[1] / 'assets/audio/sand-scrape.wav'
with wave.open(str(output), 'wb') as audio:
    audio.setparams((1, 2, RATE, LENGTH, 'NONE', 'not compressed'))
    audio.writeframes(struct.pack(f'<{LENGTH}h', *pcm))
print(f'{output.name}: 12 seconds, mono, {RATE} Hz, peak {max(abs(x) for x in pcm) / 32767:.3f}')
