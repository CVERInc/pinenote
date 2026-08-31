#!/usr/bin/env python3
"""Does the tablet's own body shadow sound arriving from behind it?

The four microphones are a straight line, and a straight line can only measure
the angle between the source and itself -- every direction on the cone at that
angle is identical to it. Front and back are on that cone, so time differences
can never separate them.

Body shadowing is a different cue and would be complementary: sound from behind
has to get past the tablet, which should cost it level, and cost the high
frequencies more than the low ones, because a 25 cm slab is many wavelengths
across at 4 kHz and less than one at 200 Hz.

Method: keep the talker still and turn the tablet around. Distance, voice and
room stay fixed; the only thing that changes is whether the body is in the path.
Recording front and back at different positions instead would confound the
measurement with distance, which is the larger effect.
"""
import sys, wave, array
import numpy as np

LOW = (200, 1000)
HIGH = (2000, 6000)


def load(path):
    w = wave.open(path)
    n, fr = w.getnchannels(), w.getframerate()
    d = array.array("h"); d.frombytes(w.readframes(w.getnframes()))
    x = np.array(d, dtype=np.float64).reshape(-1, n)
    return x[int(fr * 0.4):], fr          # drop the PDM settling transient


def bands(sig, fr):
    """Mean energy in the two bands, from an averaged periodogram."""
    N = 2048
    frames = len(sig) // N
    if frames < 2:
        return 0.0, 0.0
    w = np.hanning(N)
    acc = np.zeros(N // 2 + 1)
    for i in range(frames):
        seg = sig[i * N:(i + 1) * N] * w
        acc += np.abs(np.fft.rfft(seg)) ** 2
    acc /= frames
    f = np.fft.rfftfreq(N, 1 / fr)
    lo = acc[(f >= LOW[0]) & (f < LOW[1])].mean()
    hi = acc[(f >= HIGH[0]) & (f < HIGH[1])].mean()
    return lo, hi


def db(x):
    return 10 * np.log10(max(x, 1e-12))


def describe(path):
    x, fr = load(path)
    mono = x.mean(axis=1)
    rms = np.sqrt((mono ** 2).mean())
    lo, hi = bands(mono, fr)
    return {
        "seconds": len(mono) / fr,
        "rms_db": 20 * np.log10(max(rms, 1e-9) / 32768),
        "tilt_db": db(hi) - db(lo),
        "per_channel_db": [20 * np.log10(max(np.sqrt((x[:, c] ** 2).mean()), 1e-9) / 32768)
                           for c in range(x.shape[1])],
    }


def main(front, back):
    f, b = describe(front), describe(back)
    print(f"  {'':10s} {'level':>10s} {'HF-LF tilt':>12s}   per-channel level")
    for name, d in (("front", f), ("back", b)):
        chans = " ".join(f"{v:6.1f}" for v in d["per_channel_db"])
        print(f"  {name:10s} {d['rms_db']:9.1f}dB {d['tilt_db']:11.1f}dB   {chans}")
    dl = b["rms_db"] - f["rms_db"]
    dt = b["tilt_db"] - f["tilt_db"]
    print(f"\n  back minus front:  level {dl:+.1f} dB,  tilt {dt:+.1f} dB")
    print()
    # Measured on a PineNote v1.2 with white noise on the screen's axis, three
    # pairs: level -5.7/-4.5/-4.8 dB, tilt -9.6/-11.1/-11.4 dB, against controls
    # of the same orientation twice that moved 1.2 dB at most. The thresholds
    # below sit well inside that gap rather than at the edge of it -- an earlier
    # single measurement landed at exactly -3.0 dB against a -3 dB threshold,
    # which is the least informative place a number can land.
    if dl < -3 and dt < -2:
        print("  Shadowed: quieter and duller from behind. Front and back are")
        print("  separable by level and colour, which time differences cannot do.")
    elif dl < -3:
        print("  Quieter from behind but no duller. Level alone is a weak cue --")
        print("  it moves with distance and with how loudly someone speaks.")
    elif dt < -2:
        print("  Duller from behind but no quieter. Colour is the more robust half,")
        print("  since it survives a talker changing volume; worth a second run.")
    else:
        print("  No shadow worth using. The body is not in the way enough at these")
        print("  frequencies, and front/back stays ambiguous for this array.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: shadow.py <front.wav> <back.wav>")
    main(sys.argv[1], sys.argv[2])
