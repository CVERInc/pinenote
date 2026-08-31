#!/usr/bin/env python3
"""How much of what the array hears arrives from one direction?

Two microphones hearing the same plane wave record the same thing, shifted.
Two microphones in a reverberant field record partly the same thing and partly
their own share of the reflections. Magnitude-squared coherence measures which
of the two this is, and it is the number that decides whether a steered null
can work at all: a null removes one direction, and everything not coming from
one direction stays.
"""
import sys, wave, array
import numpy as np

D_M = 0.063          # ch0 to ch3, three 21 mm gaps


def load(p):
    w = wave.open(p); n, fr = w.getnchannels(), w.getframerate()
    d = array.array("h"); d.frombytes(w.readframes(w.getnframes()))
    return np.array(d, dtype=float).reshape(-1, n)[int(fr * 0.4):], fr


def coherence(a, b, fr, frame=2048):
    win = np.hanning(frame)
    frames = len(a) // frame
    Saa = Sbb = Sab = 0
    for i in range(frames):
        A = np.fft.rfft(a[i*frame:(i+1)*frame] * win)
        B = np.fft.rfft(b[i*frame:(i+1)*frame] * win)
        Saa = Saa + np.abs(A)**2
        Sbb = Sbb + np.abs(B)**2
        Sab = Sab + A * np.conj(B)
    f = np.fft.rfftfreq(frame, 1/fr)
    C = np.abs(Sab)**2 / np.maximum(Saa * Sbb, 1e-30)
    return f, C


for path in sys.argv[1:]:
    x, fr = load(path)
    f, C = coherence(x[:, 0], x[:, 3], fr)
    print(f"\n{path.split('/')[-1]}")
    for lo, hi in ((300, 800), (800, 2000), (2000, 5000)):
        sel = (f >= lo) & (f < hi)
        c = C[sel].mean()
        # 🔴 Do not read this as direct-to-diffuse with c/(1-c). That assumes a
        #    diffuse field is incoherent, which is false for microphones this
        #    close together: a diffuse field's coherence is sinc^2(2*pi*f*d/c),
        #    which is 0.89 at 500 Hz for a 63 mm spacing. Comparing against that
        #    baseline is the only way to say anything.
        fc = (lo + hi) / 2
        k = 2 * np.pi * fc * D_M / 343.0
        diffuse = (np.sin(k) / k) ** 2 if k > 1e-9 else 1.0
        verdict = "directional" if c > diffuse + 0.15 else "diffuse-like"
        print(f"  {lo:5d}-{hi:5d} Hz   coherence {c:.2f}   "
              f"a diffuse field would give {diffuse:.2f}   {verdict}")
