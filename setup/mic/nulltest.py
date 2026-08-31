#!/usr/bin/env python3
"""Prove the null lands where it is told, before believing where it lands.

Builds four channels carrying one source at a chosen angle, with the sub-sample
delays that angle implies, and sweeps the null across every angle. If the
arithmetic is right the deepest suppression is at the angle used to build the
signal. If it is not, nothing measured on real audio means anything.
"""
import subprocess, sys, wave, array
import numpy as np

SPACING_M, C, FR = 0.021, 343.0, 16000


def synth(path, angle_deg, seconds=3.0, diffuse_db=None):
    n = int(FR * seconds)
    rng = np.random.default_rng(5)
    src = rng.normal(0, 3000, n + 64)
    tau = SPACING_M * np.sin(np.radians(angle_deg)) / C
    S = np.fft.rfft(src)
    f = np.fft.rfftfreq(len(src), 1 / FR)
    chans = []
    for m in range(4):
        c = np.fft.irfft(S * np.exp(-2j * np.pi * f * m * tau), len(src))[:n]
        if diffuse_db is not None:
            amp = 10 ** (diffuse_db / 20) * np.sqrt((src[:n] ** 2).mean())
            c = c + rng.normal(0, amp, n)      # independent per channel
        chans.append(c)
    d = array.array("h")
    for i in range(n):
        for m in range(4):
            d.append(int(max(-32768, min(32767, chans[m][i]))))
    w = wave.open(path, "wb")
    w.setnchannels(4); w.setsampwidth(2); w.setframerate(FR)
    w.writeframes(d.tobytes()); w.close()


def run(path):
    out = subprocess.run([sys.executable, "nullsteer.py", path],
                         capture_output=True, text=True).stdout
    for line in out.splitlines():
        if "deepest null" in line:
            return line.strip()
    return "(no result)"


if __name__ == "__main__":
    for ang in (-45, 0, 30):
        synth("/tmp/syn.wav", ang)
        print(f"  built at {ang:+3d} deg, clean      -> {run('/tmp/syn.wav')}")
    for rev in (-6, 0):
        synth("/tmp/syn.wav", -45, diffuse_db=rev)
        print(f"  built at -45 deg, diffuse {rev:+d} dB -> {run('/tmp/syn.wav')}")
