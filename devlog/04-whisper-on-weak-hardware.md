# Four things about whisper that only show up on slow hardware

I put speech recognition on an e-ink tablet: four Cortex-A55 cores at 1.8 GHz,
4 GB of RAM, no GPU, whisper.cpp compiled with `GGML_NATIVE=ON`. Everything
runs on the device; nothing leaves it.

On hardware this slow, choices that are invisible on a laptop become measurable
in seconds, and three of the four things I learned are traps — settings that
look like optimisations and are not.

Baseline, 11 seconds of audio, four threads:

| model | total | vs realtime |
|---|---|---|
| tiny | 5.4 s | 0.50× |
| base | 11.7 s | 1.06× |
| small | 48.0 s | 4.36× |

## 1. Quantised models are slower here

The obvious move on a small ARM core is to drop from f16 to a quantised model.
`base-q5_1` is 57 MB against base's 142 MB, and on paper less memory traffic
should mean less time.

```
base       11.66 s
base-q5_1  13.09 s      (+12%)
small      47.99 s
small-q5_1 51.61 s      (+8%)
```

Both slower. The CPU advertises `asimdhp` — half-precision SIMD arithmetic — so
f16 is its *native* path, and dequantising is work added rather than removed.
The bottleneck here is arithmetic, not bandwidth, and quantisation trades the
one you have for the one you do not need.

Check `/proc/cpuinfo` before assuming quantisation is free.

## 2. Reducing the encoder's audio context makes the number you read better and the number you wait for worse

whisper's encoder always processes a 30-second window regardless of how long
you actually spoke, and on `small` it dominates: 34 of the 48 seconds. The
`-ac` flag shrinks that context, and it works:

| audio context | encode | **total** |
|---|---|---|
| default | 34.0 s | 48.0 s |
| 1500 | 35.0 s | 52.3 s |
| 768 | 20.8 s | **37.3 s** |
| 512 | **13.0 s** | **69.8 s** |

At 512 the encode time drops by 62% and the total gets 45% *worse*. Starve the
decoder of context and it stops trusting its own output, falls back, and re-runs
segments — quietly, several times.

The encode time is the number printed prominently. The total is the number a
person waits through. Watch the one you care about, especially when the other
one is moving in the direction you hoped.

## 3. tiny is not a fast base

tiny transcribed a carefully-read test sentence perfectly, at twice realtime.
Then I added an initial prompt — a few words of context to steer style — and it
collapsed into fluent nonsense that shared almost no content with the audio.
base, given the same prompt, was exact.

That matters because the prompt turns out to be the most valuable knob
available, which is the fourth thing.

## 4. The prompt carries vocabulary, and that is worth more than a bigger model

An initial prompt is usually described as a style hint. It is really the
decoder's preceding context, so it biases the language model — including its
choice of *words*.

The failures in my testing were not scattered across the language. The same
handful of terms failed over and over, and the worst offender was the subject
of the sentence itself. Adding those exact words to the prompt fixed them, at
no cost in time:

```
prompt without the words   …heard a phonetically plausible non-word
prompt with the words      …heard the term correctly
a model 3.5× slower        …also correct
```

Most of the gap to `small` closed for free. If you know roughly what people
will say — a domain, a product name, a handful of jargon — write it into the
prompt before reaching for a larger model.

## And one genuine hazard: forcing the language

The tablet knows which input method the user is typing in, so an obvious
feature is to pass that to whisper as `-l <lang>`. I built it. It is dangerous.

Forcing a language the audio is *not* in does not make the model listen harder.
It makes it translate. An English sentence forced to another language came back
as fluent, grammatical text in that language that nobody had said — and nothing
on screen suggested a rewrite had happened.

A wrong word looks wrong. A wrong sentence that reads perfectly does not.

Auto-detection got every case right in my testing, including audio behind a
prompt written in a different language, and when detection is wrong it is
visibly wrong. So: let it detect, and use the input method to choose the
*prompt* instead. That keeps the useful half of the idea and removes the failure
mode.

## Two smaller things

**Silence is pathological, not cheap.** A three-second recording of an empty
room took 30 seconds — longer than eleven seconds of real speech. The decoder
keeps falling back, hunting for words in noise. Decide whether anything was said
*before* handing it over.

**And then that gate nearly ate the speech.** I gated on modulation — loud-to-
median frame energy — because speech is syllables and room noise is flat, and
that difference survives being carried into a quieter room in a way a level
threshold does not. Silence measured 1.38, a carefully-read sentence 2.75, so a
threshold of 1.6 looked safe. Ordinary speech at ordinary speed measured **1.79**.

Discarding what someone said, with no text and no reason, is the worst thing a
dictation tool can do. The gate now requires *two* cues to agree — modulation
low **and** level low — before it drops anything.

**Resampling in Python cost more than the transcription.** Decimating 48 kHz to
16 kHz with a 63-tap filter in a Python loop took 7 seconds of CPU for a
3-second clip. ALSA's `plughw` does the same conversion in C for no measurable
cost. The slowest thing in the pipeline was not the neural network.

## The shape of it

Every one of these was found by measuring on the device, and three of them
contradict what the settings are named. Quantisation is not a speedup here.
Reducing context is not a speedup. A smaller model is not a faster version of a
bigger one.

The one that generalises: on constrained hardware, measure the number the user
experiences, not the number the tool prints.

*[github.com/CVERInc/pinenote](https://github.com/CVERInc/pinenote), `setup/mic/`.*
