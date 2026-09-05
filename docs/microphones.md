# The microphones nobody uses

Part of [pinenote](../README.md).

Four holes sit above the screen. They are a PDM microphone array, ALSA
enumerates them as `hw:0,1` alongside the rk817 codec on `hw:0,0`, and as far
as anything published goes that is where the knowledge stops. Nobody has said
how many of them work, how far apart they are, or whether they resolve
direction — which are the first three things anyone writing beamforming needs.

**They are invisible to the audio stack, and the reason is dull.** This card
ships no UCM profile, so ALSA falls back to a generic stereo configuration that
describes device 0 and nothing else. Every application sees one stereo source.
The array is not hidden or broken; nothing ever told the stack it was there —
and neither was the codec's own capture input, which the fallback drops too.

`setup.sh` [17] installs a UCM2 profile for the card, in `setup/mic/ucm2/`. A
PipeWire drop-in can paper over this per machine, and one did while the array
was being measured, but the profile is the layer that owns the question: it
describes the card once, for every application and session manager, and it is
the same file that would fix this for every PineNote if upstream took it. See
`setup/mic/ucm2/UPSTREAM.md`.

It was checked by removal rather than by appearance. Anything can be made to
show up by adding another mechanism; the test that means something is taking
the old one away. With the drop-in moved aside and PipeWire restarted, the
array still arrives as a 4-channel source, the codec's microphone arrives
beside it, and the default source stays the codec rather than being taken over
by four channels nobody asked for.

## What they actually are

Measured, not read off a datasheet — there isn't one.

| | |
|---|---|
| Channels | 4, all live. `hw:0,1` accepts 2–6 |
| Noise floor | about −54 dBFS in a quiet room |
| Pairwise correlation | 0.33–0.50 |
| Spacing | ~21 mm, ~21 mm, ~25 mm |
| Aperture | ~68 mm |
| Arrangement | one line, horizontal |

Correlation between channels is the interesting number. At 1.0 they would be
copies of one microphone; near 0 they would be hearing noise rather than a
room. Between those, the part that does not correlate is the spatial
information — the reason there are four of them.

The geometry comes from claps. Ambient noise cannot give it: room noise is
diffuse, arrives from everywhere at once, and the time-of-arrival differences
collapse to zero — which is exactly what a first attempt with ambient noise
produced, and it looks like a failed measurement rather than a wrong question.
A clap is transient and comes from one place. At 48 kHz one sample of delay is
7.1 mm of path difference.

Clapping to the left and then to the right inverts the entire set of six
inter-channel delays, repeatably, three claps a side:

```
              left    right
  ch0-ch1      -3      +3
  ch0-ch2   +2..+5     -3
  ch0-ch3   -5..-8   +6..+7
  ch2-ch3   -4..-8  +9..+10
```

Solving those for arrival order puts the microphones at −3, 0, +3 and +6.5
samples across, and all six pairs agree with that layout rather than only the
three it was fitted to. The check that matters is the one that was not used to
fit anything: claps from directly above and below collapse to ±1 sample. A line
of microphones is equidistant from those directions, so a straight line is what
the sideways claps and the vertical ones agree on independently.

## Steering a null, which works perfectly and then does not

Summing cannot reject a point source, but a *steered* array can: align the four
channels so the unwanted direction arrives identically in all of them, apply
weights that sum to zero, and that direction cancels while others survive.
Placing a null needs no aperture, which is the one thing this array does not
have -- 68 mm is a fifth of a wavelength at 1 kHz, so there is no beam to point.

The alignment has to be sub-sample. At 21 mm and 16 kHz a source 45° off
broadside puts 0.7 of a sample between neighbours, so it is done as a phase
ramp per frequency bin.

On synthetic plane waves it is exact:

```
built at -45°   deepest null at -44°,  -72.6 dB
built at   0°   deepest null at   0°,  -inf dB
built at +30°   deepest null at +30°,  -78.2 dB
```

In the room, with a phone playing a podcast at 45°, the same code manages
**-6.4 dB, and puts the null in the wrong place** -- at broadside rather than
at the source.

The first explanation was reverberation, and it was wrong. Coherence between
the outer microphones says the field is strongly directional where it matters:

| band | measured | a diffuse field would give |
|---|---|---|
| 300--800 Hz | 0.94 | 0.87 |
| 800--2000 Hz | 0.73 | 0.38 |
| 2000--5000 Hz | 0.68 | 0.04 |

(That table needed its own correction. Coherence was first read as
direct-to-diffuse through `c/(1-c)`, which assumes a diffuse field is
incoherent — false for microphones 63 mm apart, where a diffuse field alone
gives 0.87 at 500 Hz. The baseline is `sinc²(2πfd/c)` and comparing against it
is the only thing the number can support.)

So the energy is directional and the null still fails, which points at the
weights rather than the room: `[1,-1,-1,1]` places exactly **one** null, and a
room hands you several coherent arrivals — the direct path, the desk, the wall.
The sweep then finds the angle that minimises the sum of what it cannot cancel,
which is a compromise and lands nowhere useful. Four microphones have three
degrees of freedom and could carry three nulls, or adaptive weights that find
the coherent components themselves. That is the next thing to build, and the
tools to judge it are already here.

```sh
setup/mic/nulltest.py       # prove the null lands where it is told
setup/mic/nullsteer.py f.wav  # sweep it across a real recording
setup/mic/coherence.py f.wav  # is there anything directional to null?
```

## What summing the four channels is worth, and what it is not

`beam.py` sums the four microphones, and against a synthetic signal with
independent noise on each channel it recovers exactly the 6 dB the arithmetic
predicts. That number is real, and it is narrower than it sounds.

Summing an unsteered array helps against noise that arrives **incoherently** --
fans, hiss, traffic, a room's own floor. It does nothing against a point
source. A phone playing a podcast reaches all four microphones coherently, so
summing lifts it by exactly as much as it lifts the talker, and the ratio does
not move.

Measured, with a podcast as the interferer at three levels, transcribing the
same recording twice -- once summed, once from one microphone:

```
level 2, summed      6、マスタイトルというか、サタイトルの話について…
level 2, one mic     というスタイトルというか、サタイトルも放送されて…
```

Both transcribed the podcast rather than the person, and both failed the same
way at every level. The array cannot help here because the problem is not
signal to noise: whisper has no notion of which voice was wanted, and 6 dB of
nothing-in-particular does not tell it.

Rejecting an interferer needs the array to be **steered** -- delays chosen to
put a null in its direction -- which is a different thing from summing and is
not implemented here. Summing stays because diffuse noise is what a quiet room
mostly has, and it costs nothing.

(The protocol for that measurement had a flaw worth admitting: the recording
window started the moment the prompt appeared, so the talker's reply landed at
the end and was clipped. That ruins any comparison *between* the three levels.
It leaves the comparison that mattered untouched, since summed and single come
from one recording and are clipped identically.)

## Front and back, which the geometry cannot answer

A straight line measures one thing: the angle between the source and itself.
Every direction on the cone at that angle gives identical delays, and front and
back sit on that cone, so no amount of arithmetic on arrival times separates
them. Turning the tablet does not fix this. It only changes which real
directions get confused -- upright, the screen's front with the tablet's back;
flat on a desk, the far side of the table with your own side.

The body is a second, independent cue, and it works. With white noise on the
screen's axis, three pairs of takes, turning the tablet between them:

| | level | HF−LF tilt |
|---|---|---|
| back − front | −5.7, −4.5, −4.8 dB | −9.6, −11.1, −11.4 dB |
| same side twice (control) | +0.1, +1.0 dB | +0.6, −1.2 dB |

About 25 cm of tablet is several wavelengths across at 4 kHz and less than one
at 200 Hz, so it takes the treble and passes the bass. **Tilt is the cue worth
using, not level**: level moves with distance and with how loudly someone
speaks, colour does not. An earlier single measurement said −3.0 dB of level
against a −3 dB threshold and meant nothing at all -- the talker had simply
spoken more quietly the second time.

One limit is geometric: this was measured on the axis, where the body is
squarely in the path. A source 45° to one side is not shadowed by anything.

The other limit was measured afterwards, and it is the one that matters. Repeat
the experiment with recorded speech instead of white noise and the cue does not
survive:

| | level | HF−LF tilt |
|---|---|---|
| back − front | −1.9, −4.0, +0.6 dB | +0.6, −6.1, −2.1 dB |
| same side twice (control) | −1.3, +1.2 dB | **+4.0**, +1.4 dB |

Two takes of the same side, same distance, nothing moved, differ by 4.0 dB of
tilt — more than two of the three front/back pairs, one of which has the wrong
sign. Five seconds of speech is not a stable spectrum: whether a sibilant
happened to fall inside the window moves the 2--6 kHz band further than the
tablet does.

The physics has not gone anywhere; the body still takes the treble. What fails
is the measurement, and then the application, which is worse. A real system
never gets to compare two recordings — it gets one utterance and has to say
which side it came from, which needs to know how bright that person is when
nothing is in the way. That varies by speaker and by sentence, by more than the
shadow is worth.

So: **left and right, yes, from the delays. Front and back, no** — not from
level, not from colour, not without a reference recording of the same voice
from a known side. Placement remains the answer: put everyone who matters on
one side of the tablet, and the ambiguity has nothing to be ambiguous about.

```sh
setup/mic/shadow.py front.wav back.wav     # level and tilt, with a verdict
setup/mic/rotation-check.py *.wav          # did the tablet actually turn?
```

The second one is not a convenience. Two full rounds of this experiment
produced clean null results because the cue to turn the tablet was inaudible
over the noise being measured, and a tablet that never moved looks exactly like
a tablet with no shadowing. A 180° turn reverses the microphones' order, so the
delay between the outer channels must change sign: −1 before, +1 after. That
line is the difference between a measurement and a story.

## What follows for speech

A 68 mm aperture with 21 mm spacing puts spatial aliasing near 8 kHz, and
speech lives below 4 kHz, so the useful band is entirely inside the clean one.
Four microphones summed with the right delays are worth about 6 dB of signal to
noise against diffuse room noise. The array cannot separate up from down — it
is a line — but a person talking to a tablet is in front of it, and that is the
axis that carries nothing anyway.

That fits this device better than it first sounds. Everything else in this
repository is about typing on a panel that takes 450 ms to change its mind.
Speech is the one input where the panel's weakness does not apply: nothing has
to redraw while you talk.

## Tools

```sh
setup/mic/clap-survey            # prompts on the tablet, records, reports
setup/mic/tdoa.py --selftest     # prove the correlator against known delays
setup/mic/tdoa.py <wav>          # or measure a recording you already have
```

Two things this cost, written down so they cost nothing next time. The first
0.3 s after opening a PDM device is a settling transient that pins several
channels to full scale; left in, it reads as four broken microphones. And the
correlator indexed past its window on negative lags — which surfaced only on a
recording that contained a clap arriving in that order, after someone had
clapped twelve times for nothing. `--selftest` builds channels with delays we
chose and checks they come back, which is cheaper than a person's hands.

# Speaking to it

The array is now a usable capture source, so `setup/mic/dictate` records a
sentence, sums the four channels, and transcribes it on the device with
whisper.cpp. Nothing leaves the tablet.

```sh
setup/mic/dictate            # ten seconds, then the text
setup/mic/beam.py --selftest # prove the summing recovers its 6 dB
```

## What the numbers decided

Eleven seconds of speech, four threads, on the RK3566's four Cortex-A55s:

| model | total | vs realtime |
|-------|-------|-------------|
| tiny  | 5.4 s | 0.50x |
| base  | 11.7 s | 1.06x |
| small | 48.0 s | 4.36x |

`base` is the one it uses. Three things that look like optimisations are not:

- **Quantised models are slower here**, by 7-12%. This CPU advertises `asimdhp`,
  so f16 is its native path and dequantising is work added rather than removed.
- **Shrinking the encoder's audio context is a trap.** At `-ac 512` the encode
  time drops from 34.9 s to 13.0 s and the *total* rises to 69.8 s, because the
  decoder falls back and re-runs. The number that is easy to read is not the
  number that matters.
- **`tiny` is not a fast `base`.** It transcribed a carefully read sentence
  correctly, and collapsed the moment it had to carry an initial prompt.

## What the prompt is for

whisper writes Simplified Chinese by default. Asking for Traditional in the
initial prompt is cheaper than converting afterwards and does not mangle the
characters that differ by meaning rather than by script. Checked in both
directions: with `-l auto`, English audio still transcribes as English.

The larger surprise is that the prompt carries **vocabulary**. Dictation
failures were not scattered across the language; the same few words failed over
and over, and the worst of them was the subject itself. On one recording:

```
prompt without the words   我認為雲蘇如其實不用要求字的全部佔據，...
prompt with the words      我認為語音輸入其實不用要求字的全部占確，...
small, same prompt         我認為語音輸入其實不用要求字的全部正確，...
```

Putting the words you actually say into the prompt costs nothing and recovers
most of the gap to a model three and a half times slower. Set `WHISPER_PROMPT`.

## Forcing a language makes it translate

The panel button picks a prompt from the input source you are typing in, and
for a while it also forced whisper's language to match. That is a silent way to
lose what someone said. One English sentence, forced to `zh`:

```
-l zh, Chinese vocabulary prompt   這很正確。非常好，謝謝。
-l zh, Traditional prompt only     它是非常對的。它是非常美麗的。 Thank you.
-l auto, same Chinese prompt       It's really very correct. It's so wonderful...
```

The first is fluent, plausible, and not what was said. Nothing on screen
suggests the sentence was rewritten, which makes it worse than a wrong word: a
wrong word looks wrong. Detection was right in every case tested, including
English audio behind a Chinese prompt, and when detection is wrong you can see
that it is.

So whisper detects the language, and the input source only chooses the prompt.
The wish that started this -- *type Japanese, dictate Japanese* -- still holds,
because the prompt is what carries the script and the vocabulary.

## Three things this cost

**Silence is not a cheap input for whisper, it is a pathological one.** Its
decoder keeps falling back, hunting for words in noise: a three second empty
recording took 30 s, longer than eleven seconds of real speech. `dictate` now
decides whether anything was said first.

**That gate then nearly ate the speech it was protecting.** Modulation --
loud-to-median frame energy -- measured 1.38 for silence and 2.75 for a
carefully read sentence, so a gate at 1.6 looked safe. Ordinary speech at
ordinary speed measured 1.79. A gate that silently discards what someone said
is the worst failure available here, so it now needs the level to be low as
well before it drops anything.

**Resampling in Python cost more than the transcription.** Decimating 48k to
16k with a 63-tap filter in a Python loop took 7 s of CPU for a 3 s clip. ALSA
does the same conversion in C for no measurable cost: record through `plughw`
at 16 kHz and sum the four channels, which is the part worth doing here.

And one that was avoidable: `dictate` deleted each recording as it went, so
fifteen dictated sentences left nothing to compare two models over. That is the
same mistake as the analyser that deleted its recording on failure, which cost
someone twelve claps. The last recording now stays.
