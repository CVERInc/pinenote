#!/usr/bin/env python3
"""Steer a null at one direction and see how much of it goes away.

The array is too small to point at anything: 68 mm of aperture is a fifth of a
wavelength at 1 kHz, so there is no main lobe to speak of in the speech band.
Placing a null is a different problem and does not need aperture -- align the
channels so the unwanted direction arrives identically in all four, then apply
weights that sum to zero, and that direction cancels exactly while others do
not.

The alignment has to be sub-sample. At 21 mm spacing and 16 kHz, a source 45
degrees off broadside puts 0.7 of a sample between neighbouring microphones, so
integer shifts cannot express it. Doing it as a phase ramp per frequency bin is
not sophistication, it is the minimum that works.

The angle sweep is the check on the arithmetic: the deepest suppression has to
land where the delays say the source is. Nothing sets that -- if the maths is
wrong the minimum lands somewhere else, or nowhere.
"""
import sys, wave, array
import numpy as np

SPACING_M = 0.021
C = 343.0


def load(p):
    w = wave.open(p)
    n, fr = w.getnchannels(), w.getframerate()
    d = array.array("h"); d.frombytes(w.readframes(w.getnframes()))
    return np.array(d, dtype=float).reshape(-1, n)[int(fr * 0.4):], fr


def steer(X, f, fr, tau_unit, weights):
    """Apply a per-microphone delay as a phase ramp, then weight and sum."""
    out = np.zeros(X.shape[0], dtype=complex)
    for m in range(X.shape[1]):
        out += weights[m] * X[:, m] * np.exp(2j * np.pi * f * m * tau_unit)
    return out


def energy(x, fr, band=(300, 5000)):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / fr)
    sel = (f >= band[0]) & (f < band[1])
    return float((np.abs(X[sel]) ** 2).sum())


def analyse(path, frame=4096):
    x, fr = load(path)
    nmic = x.shape[1]
    frames = len(x) // frame
    f = np.fft.rfftfreq(frame, 1 / fr)
    band = (f >= 300) & (f < 5000)

    # tau_unit is the delay between neighbouring microphones, in seconds. A
    # source at angle t from broadside gives d*sin(t)/c; sweeping tau directly
    # covers every angle the array can express, ends included.
    tau_max = SPACING_M / C
    taus = np.linspace(-tau_max, tau_max, 61)

    w_sum = np.ones(nmic) / nmic
    w_null = np.array([1.0, -1.0, -1.0, 1.0]) / 2   # sums to zero

    e_sum = 0.0
    e_null = np.zeros(len(taus))
    win = np.hanning(frame)
    for i in range(frames):
        seg = x[i * frame:(i + 1) * frame] * win[:, None]
        X = np.fft.rfft(seg, axis=0)
        e_sum += float((np.abs((X * w_sum).sum(axis=1))[band] ** 2).sum())
        for k, tau in enumerate(taus):
            y = steer(X, f, fr, tau, w_null)
            e_null[k] += float((np.abs(y)[band] ** 2).sum())

    best = int(np.argmin(e_null))
    tau_best = taus[best]
    sin_t = np.clip(tau_best * C / SPACING_M, -1, 1)
    angle = np.degrees(np.arcsin(sin_t))
    supp = 10 * np.log10(e_null[best] / e_sum)

    print(f"  frames {frames} x {frame}   plain sum energy = {10*np.log10(e_sum):.1f} dB")
    print(f"  deepest null at {angle:+.0f} deg from broadside, "
          f"{supp:+.1f} dB against the plain sum\n")
    print("  angle   suppression")
    for k in range(0, len(taus), 4):
        s = np.clip(taus[k] * C / SPACING_M, -1, 1)
        a = np.degrees(np.arcsin(s))
        d = 10 * np.log10(e_null[k] / e_sum)
        bar = "#" * max(0, int(30 + d))
        print(f"  {a:+5.0f}  {d:+6.1f} dB {bar}")


if __name__ == "__main__":
    analyse(sys.argv[1] if len(sys.argv) > 1 else "/tmp/bf-src.wav")
