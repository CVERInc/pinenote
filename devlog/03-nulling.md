# A null that works perfectly, and then does not

Summing four microphones buys about 6 dB against room noise. I had that number
from a synthetic test with a self-check, and it is correct, and it is narrower
than it reads.

Coherent speech adds as N; incoherent noise adds as √N. The word doing the work
there is *incoherent*. Fans, hiss, a room's own floor — those arrive from
everywhere and partially cancel when you add the channels. A loudspeaker does
not. It reaches all four microphones coherently, so summing lifts it by exactly
as much as it lifts you, and the ratio does not move at all.

I tested that with a podcast playing beside the tablet and someone dictating a
known sentence, transcribing each recording twice — once summed, once from a
single microphone:

```
level 2, summed     6、マスタイトルというか、サタイトルの話について…
level 2, one mic    というスタイトルというか、サタイトルも放送されて…
```

Both transcribed the podcast rather than the person. Both failed identically at
every noise level. There is nothing wrong with the 6 dB; it simply has no
opinion about *which* voice you wanted, and neither does the transcriber.

## Nulling is the one kind of beamforming this array could do

Pointing a beam needs aperture. This array has 68 mm of it, which is a fifth of
a wavelength at 1 kHz — there is no main lobe to aim in the speech band, and no
amount of cleverness creates one.

Placing a *null* is a different problem and needs no aperture at all. Align the
four channels so the unwanted direction arrives identically in all of them,
then apply weights that sum to zero. That direction cancels exactly. Others,
arriving with different delays, do not.

The alignment has to be sub-sample: at 21 mm spacing and 16 kHz, a source 45°
off broadside puts 0.7 of a sample between neighbours. Integer shifts cannot
express that, so it is done as a phase ramp per frequency bin. Not
sophistication — the minimum that works.

On synthetic plane waves it is exact:

```
built at -45°   deepest null at -44°,  -72.6 dB
built at   0°   deepest null at   0°,  -inf dB
built at +30°   deepest null at +30°,  -78.2 dB
```

Note what that test is checking. The sweep searches every angle and reports
where suppression is deepest. Nothing tells it the answer — if the arithmetic
is wrong, the minimum lands somewhere else, or nowhere. It landing on the
construction angle is the proof.

## In a room: −6.4 dB, and pointing the wrong way

Phone playing a podcast at 45°, measured by the array itself as −2 samples
across the outer pair. Same code:

```
deepest null at -4 deg from broadside, -6.4 dB against the plain sum
```

Not at 43° where the source is. At broadside. And 66 dB shallower than the
synthetic case.

**My first explanation was reverberation**, and I gave it before measuring
anything: a null removes one direction, reflections arrive from all of them, so
the reverberant field survives and sets the floor. It is a good story. It is
also the kind of story that is very easy to believe about a room.

Coherence between the outer microphones disagrees:

| band | measured | a diffuse field would give |
|---|---|---|
| 300–800 Hz | 0.94 | 0.87 |
| 800–2000 Hz | 0.73 | 0.38 |
| 2000–5000 Hz | 0.68 | **0.04** |

Above 800 Hz the field is strongly directional. There is plenty for a null to
bite on. Reverberation was not the answer.

## The correction inside the correction

That table needed fixing before it could say anything, and the first version
said the opposite.

I had converted coherence to a direct-to-diffuse ratio with `c/(1−c)`, which
assumes a diffuse field is *incoherent*. For microphones 63 mm apart, it is
not: a purely diffuse field has coherence `sinc²(2πfd/c)`, which is 0.87 at
500 Hz. My first pass reported "+12 dB direct-to-diffuse" in the low band and
it was an artefact of the spacing, not a property of the room.

Against the correct baseline the reading reverses: the low band is
diffuse-like, and the *high* band — where the naive formula looked least
impressive — is where the directional energy actually is.

Two wrong explanations, both corrected by measuring the thing rather than
reasoning about it. The second was worse than the first, because it came with
numbers.

## What is actually wrong is the weights

Energy is directional; the null still fails. That points away from the room and
at the beamformer.

`[1, −1, −1, 1]` places exactly **one** null. A room hands you several coherent
arrivals — the direct path, the desk, a wall — each perfectly coherent, each
from a different angle. One null cannot cancel three directions, so the sweep
settles wherever the total residual is smallest. That is a compromise, it
cancels none of them properly, and it lands somewhere meaningless. Broadside,
as it happens.

Four microphones have three degrees of freedom. They could carry three nulls,
or adaptive weights that find the coherent components themselves rather than
being told one angle. That is the next thing to build, and the tools to judge
it already exist: a synthetic test that proves a null lands where it is told,
and a coherence check that says whether a recording contains anything worth
nulling.

## What I would tell myself before starting

The synthetic result was −72 dB. It was beautiful, it was correct, and it
predicted nothing about the room, because the room's difficulty is not in the
arithmetic — it is in how many things are arriving at once.

A self-test proves your code does what you meant. It cannot tell you whether
what you meant is enough.

*[github.com/CVERInc/pinenote](https://github.com/CVERInc/pinenote): `setup/mic/nullsteer.py`, `nulltest.py`, `coherence.py`.*
