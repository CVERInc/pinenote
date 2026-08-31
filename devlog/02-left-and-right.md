# Left and right, yes. Front and back, no.

A line of four microphones can tell you one thing about a sound: the angle
between it and the line. That is not a limitation of the maths. It is what a
line *is*.

Every direction sharing that angle lies on a cone around the array axis, and
every direction on that cone produces identical delays. Front and back sit on
that cone. So does up and down. No amount of arithmetic on arrival times
separates them, and turning the tablet does not help — it only changes which
real-world directions get confused. Upright, the screen's front with the
tablet's back. Flat on a desk, the far side of the table with your own side.

Left and right, though, work: they lie *along* the axis, and that is the one
axis a line resolves. On this array, one sample of delay at 48 kHz is 7.1 mm of
path difference, which is plenty.

So the interesting question is whether anything *else* about the tablet breaks
the front/back tie. There is an obvious candidate: the tablet itself. Sound
from behind has to get past 25 cm of glass and metal, which is several
wavelengths across at 4 kHz and less than one at 200 Hz. It should arrive
quieter, and duller.

That is a cue of a completely different kind from timing, which makes it
worth testing.

## The first measurement said yes, and meant nothing

Talker sits still, speaks; turn the tablet around; speak again. Compare.

```
back minus front:  level -3.0 dB,  tilt -2.6 dB
```

Shadowed, apparently. Except the verdict threshold in my own script was
"level below −3 dB and tilt below −2 dB", and the result landed at −3.0 and
−2.6. A number that just clears a line you drew yourself is the least
informative place a number can land.

Worse: the two takes were a person speaking twice. Speaking 3 dB quieter the
second time is not unusual — it is the *expected* variation. The measurement
could not tell shadowing from someone being slightly tired of counting to five.

So: fix the source. A phone playing white noise at a fixed position, and only
the tablet moves. Same distance, same spectrum, same room. And record the same
orientation twice as a control, because without knowing the measurement's own
noise floor, no difference means anything.

## Two rounds of beautifully clean nothing

The results came back flat. Front and back differed by less than front differed
from itself. Textbook null result.

> **Claude**
> Three short beeps means turn the tablet, one long beep means recording
> starts. About fifty seconds total.

> **cver**
> 白噪音太吵我沒聽到你的指揮，我快笑死

> **cver**
> 我自己轉如何？

The cue was a *sound*. Played through the tablet's speaker. Competing with the
loud noise the experiment existed to measure. I did this twice.

A tablet that never moved produces exactly the same data as a tablet with no
shadowing, and the second version is the one you were hoping to find. That is
what makes it dangerous: the wrong answer arrives looking like a clean result,
with controls and everything.

What caught it was not suspicion. It was a check that costs one line: **a 180°
turn reverses the microphones' order, so the delay between the outer channels
must change sign.** −1 before, +1 after. Physics guarantees it; nobody's
judgement is involved.

```
f1.wav   -58.6  -58.8  -59.1  -60.0   lag -1
b1.wav   -64.6  -64.5  -65.1  -65.4   lag +1
```

That check now lives in the repository as its own tool. It has a blind spot
worth knowing: a source directly on the array's symmetry axis has no delay to
reverse, so the check says nothing. Put the source slightly off to one side.

## With the tablet actually turning

| | level | HF−LF tilt |
|---|---|---|
| back − front | −5.7, −4.5, −4.8 dB | −9.6, −11.1, −11.4 dB |
| same side twice (control) | +0.1, +1.0 dB | +0.6, −1.2 dB |

Three independent pairs, agreeing, against controls that move at most 1.2 dB.
The body takes about 11 dB of treble off sound arriving from behind and leaves
the bass alone, which is exactly what a slab that size should do.

Tilt is the half worth having. Level moves with distance and with how loudly
someone speaks; colour does not. That is what the −3.0 dB fiasco was really
about.

## Then speech happened

Same experiment, recorded speech instead of white noise:

| | level | HF−LF tilt |
|---|---|---|
| back − front | −1.9, −4.0, +0.6 dB | +0.6, −6.1, −2.1 dB |
| same side twice (control) | −1.3, +1.2 dB | **+4.0**, +1.4 dB |

Two takes of the same side, nothing moved, differ by 4.0 dB of tilt — more than
two of the three front/back pairs, one of which has the wrong sign entirely.

Five seconds of speech is not a stable spectrum. Whether a sibilant happens to
fall inside the window moves the 2–6 kHz band further than the tablet does.
White noise has energy everywhere; a voice has energy where the words put it.

The physics did not go anywhere. The measurement did.

## The part that actually kills it

Even a perfect measurement would not build the feature, and this took me
embarrassingly long to notice: **a real system never gets to compare two
recordings.** It gets one utterance and has to say which side it came from,
which requires knowing how bright that person sounds when nothing is in the
way. That varies by speaker and by sentence, by more than the shadow is worth.

Comparing front against back is a luxury of the laboratory. The application
does not have it.

## Where that leaves the array

Left and right: yes, from the delays, reliably.

Front and back: no. Not from level, not from colour, not without a reference
recording of the same voice from a known side.

And the answer is not an algorithm — it is furniture. Put everyone who matters
on one side of the tablet and the ambiguity has nothing to be ambiguous about.
That is not settling for less; it is how arrays this size are actually used.

The tools are all in the repository, including the two that exist only because
of failures: `rotation-check.py`, and the self-test that proves the summing
recovers its 6 dB before anyone trusts it to.

*[github.com/CVERInc/pinenote](https://github.com/CVERInc/pinenote), `setup/mic/`.*
