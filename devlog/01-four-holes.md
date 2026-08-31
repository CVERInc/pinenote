# Four holes, no datasheet

There are four small holes in the bezel above the screen of a PineNote. I had
owned the tablet for months before wondering what they were.

They are a PDM microphone array. ALSA enumerates it as `hw:0,1`, beside the
rk817 codec on `hw:0,0`. That is roughly where public knowledge stops: nothing
published says how many of them work, how far apart they are, or whether they
resolve direction — which are the first three things anyone writing anything
spatial needs to know.

So I measured them. This is what that took, including the parts that went
wrong, because two of those cost more than the measurement did.

## They were never hidden. Nothing told the stack they existed

Before any of the interesting work, a dull obstacle: no application could see
the array at all.

The card ships no UCM profile. Without one, ALSA falls back to a generic
stereo configuration that describes device 0 and nothing else, so every
application sees a single stereo source. The array was not broken or disabled.
Nothing had ever told the audio stack it was there — and the same fallback
drops the codec's own microphone input too.

A PipeWire drop-in papers over this on one machine, and one did while I was
measuring. But the profile is the layer that owns the question: it describes
the card once, for every application and every session manager, and it is the
same file that would fix this for every PineNote if it went upstream.

I checked it by removal rather than by appearance. Anything can be made to show
up by adding another mechanism; the test that means something is taking the old
one away. With the drop-in moved aside and PipeWire restarted, the array still
arrived as a four-channel source, the codec's microphone arrived beside it, and
the default source stayed the codec rather than being taken over by four
channels nobody asked for.

## Ambient noise cannot answer the question

The geometry has to come from the signal, and the obvious approach fails in a
way that looks like broken hardware.

Room noise is diffuse. It arrives from every direction at once, so all four
microphones hear it simultaneously and the time-of-arrival differences collapse
to zero. My first attempt used ambient noise and produced exactly that: a table
of zeros. It reads as a failed measurement rather than as a wrong question.

A clap is transient and comes from one place, so it reaches the near microphone
first. At 48 kHz, one sample of delay is 7.1 mm of path difference. That is the
whole method: clap, cross-correlate, read the lags.

## Two failures that cost twelve claps each

**The first 0.3 seconds after opening a PDM device is a settling transient**
that pins several channels to full scale. Left in the analysis, it looks
exactly like four broken microphones. Dropping the first 0.4 s is not a
refinement; without it there is nothing to measure.

**The correlator walked off the end of its window on negative lags.** The
negative branch indexed `B[i - L]` with `i` running to the end of `A`. It only
crashed on a recording that actually contained a clap arriving in that order —
which is to say, on the first recording where someone had clapped to the *other*
side. And the script deleted its recording before the analysis, so the crash
cost twelve fresh claps from a human being rather than one more run.

> **Claude**
> Clap three times to the left of the tablet, then three to the right, then
> above, then below.

> **cver**
> done

> **Claude**
> …the analyser crashed and the script had already deleted the recording.
> Could you clap twelve more times.

The recording is kept now.

Both are fixed. What stops them recurring is not the fix but the test:
`tdoa.py --selftest` builds four channels with delays chosen in advance and
checks they come back. Synthetic signals with known answers cost nothing and
catch this class of bug before a person is involved. I would rather have
written that first.

## What they are

| | |
|---|---|
| Channels | 4, all live (`hw:0,1` accepts 2–6) |
| Noise floor | about −54 dBFS in a quiet room |
| Pairwise correlation | 0.33–0.50 |
| Spacing | ~21 mm, ~21 mm, ~25 mm |
| Aperture | ~68 mm |
| Arrangement | one horizontal line |

The correlation figure is the one worth pausing on. At 1.0 the four would be
copies of a single microphone. Near 0 they would be hearing noise rather than a
room. Between those, the part that does not correlate is the spatial
information — the entire reason there are four of them.

Solving the six inter-channel delays for arrival order puts the microphones at
−3, 0, +3 and +6.5 samples across, and all six pairs agree with that layout
rather than only the three used to fit it.

The check that matters is the one that was not used to fit anything: **claps
from directly above and below collapse to ±1 sample.** A line of microphones is
equidistant from those directions, so a straight line is what the sideways
claps and the vertical ones agree on independently.

## What the geometry buys

A 68 mm aperture with 21 mm spacing puts spatial aliasing near 8 kHz. Speech
lives below 4 kHz, so the useful band sits entirely inside the clean one.

Four microphones summed are worth about 6 dB of signal-to-noise against
diffuse noise — coherent speech adds as N, incoherent room noise as √N. The
array cannot separate up from down, because it is a line, but a person talking
to a tablet is in front of it, and that is the axis carrying nothing anyway.

That fits the device better than it first sounds. Everything else about
working on an e-ink tablet is shaped by a panel that takes 450 ms to change its
mind. Speech is the one input where that does not matter: nothing has to redraw
while you talk.

## Upstream, both directions

The profile went to `alsa-project/alsa-ucm-conf`, and the `alsa-info.sh` dump
its validator needs went to `alsa-project/alsa-tests`, which is a separate
repository — the README asks for the dump but not for where it lives, and the
answer is `python/ucm-validator/configs/<Vendor>/<Card>.txt`.

Running that validator was worth it in both directions.

**It found three real problems in my profile.** `SectionDevice."Mic Array"` was
never a legal name — UCM device names are `<Base><index>` from a fixed set — and
a bare `Mic` beside a `Mic2` counts as mixing indexed with non-indexed devices.
Two PCM names carried a redundant trailing `,0`. All three would have come back
as CI failures rather than as something I found myself.

**And I found three in the validator.** Its dump parser is six section names
behind current `alsa-info.sh`, and an unknown section is fatal — their own
`configs/USB/ALC4080.txt` already fails on it. Its amixer regex still requires
`Card hw:N` where current alsa-utils answers `Card sysdefault:N`. And its
device-name check raises `TypeError: NoneType + int` in exactly the case it
means to report as an error, which is how I found it.

One more thing, for anyone else collecting these dumps: run `alsa-info.sh` from
an empty working directory. An unquoted expansion in it globs the working
directory into the distro line, and mine arrived carrying `systemd-private`
paths and input-method log filenames. That was caught on the way into a public
tree rather than after.

## Where it stands

The array is a usable capture source now, described once for every application
on the machine, with the description offered upstream so it might stop being
something each owner rediscovers.

What it can do spatially — and, more interestingly, what it turns out it cannot
— is the next post.

*Code, including the self-tests: [github.com/CVERInc/pinenote](https://github.com/CVERInc/pinenote), `setup/mic/`.*
