#!/usr/bin/env python3
"""Recover the microphone array's geometry from claps.

The four holes above the screen are a PDM microphone array. Nothing published
says how far apart they are, which way they face, or whether they resolve
direction at all -- and those are the first three things anyone writing
beamforming needs. This measures them from the signal itself, with no
teardown and no datasheet.

Ambient noise cannot answer it. Room noise is diffuse: it arrives from every
direction at once, so all four microphones hear it simultaneously and the
time-of-arrival differences collapse to zero. A clap is transient and comes
from one place, so it reaches the near microphone first. At 48 kHz one sample
of delay is 7.1 mm of path difference.

    tdoa.py --selftest        prove the ruler on signals with known delays
    tdoa.py <wav>             measure a real recording

Use `clap-survey` to record one; it prompts on the tablet's own screen.

The self-test is not decoration. An earlier version of the correlator indexed
past the end of its window on negative lags, and it only crashed once a real
recording contained a real clap arriving in the wrong order -- after someone
had already clapped twelve times for nothing. Synthetic signals with known
delays cost nothing and catch that before a person is involved.
"""
import argparse
import array
import math
import random
import sys
import wave

SPEED_MM_S = 343000.0


def load(path):
    w = wave.open(path)
    n, fr = w.getnchannels(), w.getframerate()
    d = array.array("h")
    d.frombytes(w.readframes(w.getnframes()))
    ch = [list(d[c::n]) for c in range(n)]
    # The first ~0.3s after opening a PDM device is a settling transient that
    # pins several channels to full scale. Dropping it is not optional: left in,
    # it looks exactly like four broken microphones.
    skip = int(fr * 0.4)
    ch = [c[skip:] for c in ch]
    for c in ch:
        m = sum(c) / len(c)
        for i in range(len(c)):
            c[i] -= m
    return ch, fr


def transients(ref, fr, win=0.01, thresh=6.0, gap=0.25):
    """Positions where energy jumps well above the median -- i.e. claps."""
    W = int(fr * win)
    energy = [sum(x * x for x in ref[i:i + W]) / W
              for i in range(0, len(ref) - W, W)]
    med = sorted(energy)[len(energy) // 2] or 1.0
    hits, last = [], -1e9
    for k, e in enumerate(energy):
        t = k * W
        if e > med * thresh and t - last > fr * gap:
            hits.append(t)
            last = t
    return hits


def lag(a, b, centre, fr, span=0.03, maxlag=30):
    """The shift that best aligns a with b, in a window around `centre`."""
    W = int(fr * span)
    s = max(0, centre - W // 4)
    A, B = a[s:s + W], b[s:s + W]
    na = math.sqrt(sum(x * x for x in A)) or 1
    nb = math.sqrt(sum(x * x for x in B)) or 1
    best = (0, -2.0)
    # Both directions need their bounds. The version before this one wrote the
    # negative branch as B[i - L] with i running to len(A), which walks off the
    # end -- and only on a recording that actually contained a clap arriving in
    # that order, which is the worst possible time to find out.
    for L in range(-maxlag, maxlag + 1):
        k = abs(L)
        if k >= len(A):
            continue
        if L >= 0:
            acc = sum(A[i + L] * B[i] for i in range(len(A) - L))
        else:
            acc = sum(A[i] * B[i + k] for i in range(len(A) - k))
        r = acc / (na * nb)
        if r > best[1]:
            best = (L, r)
    return best


def report(path):
    ch, fr = load(path)
    n = len(ch)
    hits = transients(ch[0], fr)
    print(f"{len(ch[0]) / fr:.1f}s x {n} channels, {len(hits)} transients\n")
    if not hits:
        print("No claps found. Clap harder, or closer to the tablet.")
        return 1

    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    print("  time   " + "  ".join(f"ch{i}-ch{j}" for i, j in pairs))
    rows = []
    for h in hits[:12]:
        row = [lag(ch[i], ch[j], h, fr)[0] for i, j in pairs]
        rows.append(row)
        print(f"  {h / fr:5.2f}s  " + "  ".join(f"{L:+4d}   " for L in row))

    if len(rows) > 1:
        med = [sorted(r[k] for r in rows)[len(rows) // 2] for k in range(len(pairs))]
        print("\n  median " + "  ".join(f"{L:+4d}   " for L in med))
        print("  as mm  " + "  ".join(
            f"{abs(L) * SPEED_MM_S / fr:5.1f}mm" for L in med))
    print("\nClaps from one side should agree with each other, and the whole row"
          "\nshould change sign when you clap from the other. Claps from directly"
          "\nabove or below should collapse to nearly zero -- a line of microphones"
          "\nis equidistant from those, which is a second, independent check on the"
          "\ngeometry the sideways claps imply.")
    return 0


def selftest():
    """Build four channels with delays we chose, and see if we get them back."""
    fr, dur = 48000, 3.0
    N = int(fr * dur)
    random.seed(7)
    base = [random.gauss(0, 60) for _ in range(N)]
    for k in range(600):
        base[int(fr * 0.5) + k] += 12000 * math.exp(-k / 90) * math.sin(k * 0.7)

    true = [0, 3, -2, 5]
    chans = []
    for L in true:
        c = [0] * N
        for i in range(N):
            j = i - L
            c[i] = int(base[j]) if 0 <= j < N else 0
        chans.append(c)

    pairs = [(i, j) for i in range(4) for j in range(i + 1, 4)]
    expect = {(i, j): true[j] - true[i] for i, j in pairs}
    hit = int(fr * 0.5) - int(fr * 0.4)
    ok = True
    print("channel pair   expected   measured")
    for i, j in pairs:
        got = lag(chans[i][int(fr * 0.4):], chans[j][int(fr * 0.4):], hit, fr)[0]
        want = -expect[(i, j)]
        mark = "ok" if got == want else "MISMATCH"
        if got != want:
            ok = False
        print(f"  ch{i}-ch{j}        {want:+4d}       {got:+4d}   {mark}")
    print("\nself-test", "passed" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("wav", nargs="?")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if not a.wav:
        ap.error("give a wav, or --selftest")
    sys.exit(report(a.wav))
