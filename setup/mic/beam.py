#!/usr/bin/env python3
"""Sum the array's four channels into the one channel whisper wants.

The array is a straight line and a person speaking to a tablet is in front of
it, so every microphone is very nearly the same distance from the mouth and the
steering delays are zero. Summing is therefore the whole beamformer: coherent
speech adds as N, incoherent room noise adds as sqrt(N), which is 6 dB for four
microphones. Steering only becomes interesting for a talker off to one side,
and that is not how anyone holds this thing.

Also resamples 48k -> 16k, which is what whisper wants. The decimation needs
its anti-alias filter: speech lives below 4 kHz but the room does not, and
folding 8-24 kHz down on top of the voice would undo the 6 dB we just gained.
"""
import argparse, array, math, sys, wave

def load(path):
    w = wave.open(path)
    n, fr = w.getnchannels(), w.getframerate()
    d = array.array("h"); d.frombytes(w.readframes(w.getnframes()))
    # The first ~0.3s after opening a PDM device is a settling transient that
    # pins channels to full scale. It is not signal; summing it in would clip.
    skip = int(fr * 0.4)
    return [list(d[c::n])[skip:] for c in range(n)], fr

def lowpass(x, fr, cut, taps=63):
    """Windowed-sinc FIR, applied before decimation."""
    m = (taps - 1) / 2
    fc = cut / fr
    h = []
    for i in range(taps):
        k = i - m
        s = 2 * fc if k == 0 else math.sin(2 * math.pi * fc * k) / (math.pi * k)
        h.append(s * (0.54 - 0.46 * math.cos(2 * math.pi * i / (taps - 1))))
    g = sum(h)
    h = [v / g for v in h]
    out = [0.0] * len(x)
    for i in range(len(x)):
        acc = 0.0
        for j, hv in enumerate(h):
            k = i - j + int(m)
            if 0 <= k < len(x):
                acc += x[k] * hv
        out[i] = acc
    return out

def selftest():
    """Build four channels with a shared signal and independent noise, and
    check the sum recovers the 6 dB it is supposed to.

    Worth keeping because the first version of this measurement said +4.0 dB
    and the beamformer was not at fault: the reference it compared against was
    reconstructed by nearest-sample indexing, and once the noise dropped that
    reconstruction error became most of what was left. Measured at the source
    rate, against the exact signal, it is +6.0. A tool that quietly under-reads
    its own gain is worse than no tool.
    """
    import random, tempfile, os
    fr, N = 48000, 96000
    random.seed(11)
    sig = [3000 * math.sin(2 * math.pi * 300 * i / fr) *
           (0.5 + 0.5 * math.sin(2 * math.pi * 3 * i / fr)) for i in range(N)]
    d = array.array("h")
    chans = [[sig[i] + random.gauss(0, 3000) for i in range(N)] for _ in range(4)]
    for i in range(N):
        for c in range(4):
            d.append(max(-32768, min(32767, int(chans[c][i]))))
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "synth.wav")
    w = wave.open(src, "wb")
    w.setnchannels(4); w.setsampwidth(2); w.setframerate(fr)
    w.writeframes(d.tobytes()); w.close()

    skip = int(fr * 0.4)

    def snr(path):
        ww = wave.open(path); n = ww.getnchannels()
        a = array.array("h"); a.frombytes(ww.readframes(ww.getnframes()))
        x = list(a[0::n])
        ref = sig[skip:skip + len(x)]
        g = sum(p * q for p, q in zip(x, ref)) / (sum(q * q for q in ref) or 1)
        ps = sum((g * q) ** 2 for q in ref)
        pn = sum((p - g * q) ** 2 for p, q in zip(x, ref)) or 1
        return 10 * math.log10(ps / pn)

    out = {}
    for chan, label in ((0, "one microphone"), (None, "sum of four")):
        ch, _ = load(src)
        mono = ([float(v) for v in ch[chan]] if chan is not None
                else [sum(c[i] for c in ch) / len(ch)
                      for i in range(min(len(c) for c in ch))])
        dst = os.path.join(tmp, f"{label.split()[0]}.wav")
        ww = wave.open(dst, "wb")
        ww.setnchannels(1); ww.setsampwidth(2); ww.setframerate(fr)
        ww.writeframes(array.array("h", [max(-32768, min(32767, int(v)))
                                         for v in mono]).tobytes())
        ww.close()
        out[label] = snr(dst)
        print(f"  {label:15s} SNR = {out[label]:+.1f} dB")
    gain = out["sum of four"] - out["one microphone"]
    ok = 5.5 <= gain <= 6.5
    print(f"\n  gain = {gain:+.1f} dB (expect +6.0)   self-test",
          "passed" if ok else "FAILED")
    return 0 if ok else 1


def modulation(x, fr, ms=30):
    """How much the energy moves about, as p90 over median frame RMS.

    Speech is syllables: loud and quiet in turn. Room noise is flat. That is a
    difference in shape rather than in level, so it survives being carried into
    a quieter or louder room, which a plain RMS threshold does not. Measured
    here: silence 1.38, a spoken sentence 2.75.

    The gate this feeds is deliberately timid. Refusing to transcribe something
    that was actually said is a person talking to a tablet that ignores them;
    transcribing silence only costs time. So it only fires well below anything
    yet seen from speech.
    """
    W = int(fr * ms / 1000)
    e = sorted(math.sqrt(sum(v * v for v in x[i:i + W]) / W)
               for i in range(0, len(x) - W, W))
    if len(e) < 4:
        return 99.0
    med = e[len(e) // 2] or 1e-9
    return e[int(len(e) * 0.9)] / med


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?"); ap.add_argument("dst", nargs="?")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--gate", type=float, default=None,
                    help="exit 3 without writing if modulation is below this")
    ap.add_argument("--rate", type=int, default=16000)
    ap.add_argument("--channel", type=int, default=None,
                    help="use one microphone instead of the sum, to compare")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not (a.src and a.dst):
        ap.error("give src and dst, or --selftest")

    ch, fr = load(a.src)
    if a.channel is not None:
        mono = [float(v) for v in ch[a.channel]]
        how = f"channel {a.channel} alone"
    else:
        n = min(len(c) for c in ch)
        mono = [sum(c[i] for c in ch) / len(ch) for i in range(n)]
        how = f"sum of {len(ch)} channels"

    if fr != a.rate:
        assert fr % a.rate == 0, f"{fr} is not a whole multiple of {a.rate}"
        step = fr // a.rate
        mono = lowpass(mono, fr, a.rate * 0.45)[::step]

    peak = max(abs(v) for v in mono) or 1.0
    rms = math.sqrt(sum(v * v for v in mono) / len(mono))
    mod = modulation(mono, a.rate)
    print(f"{how}: {len(mono)/a.rate:.1f}s @ {a.rate} Hz "
          f"peak={peak:.0f} rms={rms:.1f} modulation={mod:.2f}")

    if a.gate is not None and mod < a.gate:
        print(f"  nothing said (modulation {mod:.2f} < {a.gate})")
        return 3

    w = wave.open(a.dst, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(a.rate)
    w.writeframes(array.array("h", [max(-32768, min(32767, int(v))) for v in mono]).tobytes())
    w.close()

if __name__ == "__main__":
    sys.exit(main())
