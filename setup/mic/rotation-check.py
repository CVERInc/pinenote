#!/usr/bin/env python3
"""Did the tablet actually get turned between takes?

A rotation of 180 degrees reverses the microphones' order relative to a fixed
source, so the delay between the outer two channels must change sign. Levels
alone cannot show this -- and a null result from a tablet that never moved
looks exactly like a null result from a tablet with no shadowing.
"""
import sys, wave, array
import numpy as np


def load(p):
    w = wave.open(p)
    n, fr = w.getnchannels(), w.getframerate()
    d = array.array("h"); d.frombytes(w.readframes(w.getnframes()))
    return np.array(d, dtype=float).reshape(-1, n)[int(fr * 0.4):], fr


def lag(a, b, fr, span=2.0, maxlag=40):
    a = a[:int(fr * span)]; b = b[:int(fr * span)]
    a = a - a.mean(); b = b - b.mean()
    c = np.correlate(a, b, "full")
    mid = len(b) - 1
    lo, hi = mid - maxlag, mid + maxlag + 1
    return int(np.argmax(c[lo:hi]) - maxlag)


def main(paths):
    print("%-9s %-36s %s" % ("file", "per-channel dBFS", "lag ch0-ch3"))
    for p in paths:
        x, fr = load(p)
        lv = [20 * np.log10(max(np.sqrt((x[:, c] ** 2).mean()), 1e-9) / 32768)
              for c in range(x.shape[1])]
        L = lag(x[:, 0], x[:, 3], fr)
        print("%-9s %s   %+6d" % (p.split("/")[-1],
                                  " ".join("%7.1f" % v for v in lv), L))


if __name__ == "__main__":
    main(sys.argv[1:])
