# I filed a duplicate of my own bug report

The PineNote's screen would not stay in portrait. Four physical orientations
collapsed into two, both landscape, and `iio-sensor-proxy` only ever reported
`normal` and `bottom-up`.

The cause is a single line in systemd's hardware database. `60-sensor.hwdb`
carries an `ACCEL_MOUNT_MATRIX` labelled for the PineTab2, keyed on the
accelerometer's modalias:

```
sensor:modalias:of:NaccelerometerT_null_Csilan,sc7a20:*    # PineTab2
 ACCEL_MOUNT_MATRIX=0, 0, -1; 1, 0, 0; 0, -1, 0
```

That key names the *chip*, not the machine. The PineNote uses the same silan
sc7a20 mounted differently, so it matches the same rule and gets the wrong
matrix. Its own device tree already supplies the right one, and the hwdb entry
overrides it:

```
$ cat /sys/bus/iio/devices/iio:device2/mount_matrix
-1, 0, 0; 0, 1, 0; 0, 0, 1          # correct, from the device tree
$ udevadm info … | grep ACCEL
ACCEL_MOUNT_MATRIX=0, 0, -1; 1, 0, 0; 0, -1, 0    # what hwdb replaced it with
```

A narrower rule cannot be written. On a device-tree machine there is no
`/sys/class/dmi/id/modalias` to qualify it with, so both boards present an
identical match string, and a second entry would simply shadow the first.

I wrote all of that up carefully, searched the tracker to check nobody had
raised it, found nothing, and filed it.

## It was already there. I had filed it myself

> **hook**
> An equivalent issue already exists: #43321 — "hwdb: sc7a20 accel matrix is
> matched by chip, and two Pine64 boards mount it differently"

Same account. Three weeks earlier. Open, with three comments on it.

And the third comment, from a systemd maintainer, twenty days before my
duplicate:

> **yuwata**
> IIUC, the entry added by bc4a027 matches multiple devices, right?
> I think it is better to revert bc4a027.
> Then, if the kernel provides the correct matrix, then the issue should be
> fixed.

The work had been requested. Nobody had picked it up, including me, because I
did not know it had been asked. My search had returned empty and I had treated
that as evidence about the world rather than about my search.

I closed the duplicate and sent the revert. It merged the same day.

**An empty result is a claim about your instrument.** When you measure zero,
the first hypothesis should be that the ruler is broken — and it is *cheap* to
check: search for something you know exists. I did that later in the same week
on a different tracker, found that GitHub's code search returned zero for a
directory I could see with my own eyes, and switched to cloning and grepping.
That habit came directly from this.

## The one that was nobody's fault

The same image ships without `iio-sensor-proxy`, so GNOME sees no accelerometer
at all and the Auto Rotate switch stays greyed out.

That is not an omission anyone made. The image builds with `recommends: false`,
and `iio-sensor-proxy` is only a *Recommends* of `gnome-shell` and
`gnome-settings-daemon` — so the build flag drops it. The proof is three lines
above in the same file: `power-profiles-daemon`, which comes off that identical
Recommends line, is already restored by hand.

My patch adds one line beside it. The satisfying part of that report was not
finding the missing package; it was finding the *pattern* the maintainers had
already established, so the change reads as finishing something rather than
proposing something.

## The one where the validator and I found each other's bugs

The microphone array needed a UCM profile, which goes to `alsa-ucm-conf`. Its
README asks for `alsa-info.sh` output so the profile can be validated without
the hardware — and does not say that the dump lives in a *different repository*,
`alsa-tests`, under `python/ucm-validator/configs/`. Two pull requests, not one.

Running that validator was worth it in both directions.

It found three real errors in my profile. `SectionDevice."Mic Array"` is not a
legal name — UCM device names are `<Base><index>` from a fixed set — and a bare
`Mic` beside a `Mic2` counts as mixing indexed with non-indexed devices. Two PCM
paths carried a redundant trailing `,0`. All three would have come back as CI
failures rather than as something I found myself.

And I found three in it. Its dump parser is six section names behind the current
`alsa-info.sh`, and an unknown section is fatal — one of their own committed
test dumps already fails on it. Its amixer regex still requires `Card hw:N`
where current alsa-utils answers `Card sysdefault:N`. And its device-name check
raises `TypeError: NoneType + int` in precisely the case it means to report as
an error, which is how I met it.

## What the four have in common

Every one of them was a workaround I was already carrying locally. The rotate
fix was a udev rule; the missing package was a line in my setup script; the
audio profile was a file I installed by hand.

A local workaround is a decision to fix the problem for exactly one machine.
That is often right, and it was right while I was still measuring. But each of
these was cheap to send once the measuring was done, and three of the four
would fix the same problem for every other owner of this tablet.

The tracking file I did not have — the one that would have stopped me filing
that duplicate — exists now. It is the first thing to read before opening
anything upstream, and it opens by explaining why it exists.

*[github.com/CVERInc/pinenote](https://github.com/CVERInc/pinenote), `UPSTREAM.md`.*
