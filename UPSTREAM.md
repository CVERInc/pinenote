# What we have sent upstream

Several fixes in this repository are workarounds for things that belong in
someone else's tree. This file records which ones have been raised, where, and
what the answer was.

It exists because it was missing. Work on the accelerometer fix was reported to
systemd, and then, weeks later, reported again from this same account by someone
who searched, found nothing, and trusted the empty result — the two issues sat
side by side until one was closed as a duplicate of the other. Read this file
before opening anything upstream, and add to it the moment you do.

An empty search result is a claim about your search, not about the world. Check
the ruler before you trust the measurement.

## systemd — accelerometer mount matrix

- **Issue:** [systemd#43321](https://github.com/systemd/systemd/issues/43321) (open)
- **Duplicate we filed by mistake:** systemd#43568 (closed)
- **PR:** [systemd#43569](https://github.com/systemd/systemd/pull/43569) —
  **merged** 2026-08-30 by yuwata, which closed #43321 with it.

`60-sensor.hwdb` carries an `ACCEL_MOUNT_MATRIX` labelled for the PineTab2,
keyed on a modalias that names the chip (`silan,sc7a20`) and not the machine.
The PineNote mounts the same chip differently, and its device tree already
supplies the right matrix, which the hwdb entry then overrides. A narrower entry
cannot be written: `of:N<name>T<type>C<compatible>` describes the sensor node,
and on a device-tree machine there is no DMI half to the lookup key, so both
boards present an identical match string.

Our workaround: `setup/udev/61-sensor-pinenote.rules`, filed after the `60-` rule
that imports hwdb, reasserts the device-tree value. Keep it. The revert has
landed upstream but this machine runs systemd 257, and the rule stays correct
either way — with the hwdb entry gone it reasserts a value that already matches.
Retire it once an installed `/usr/lib/udev/hwdb.d/60-sensor.hwdb` here no longer
contains `sc7a20`.

## PNDeb image — iio-sensor-proxy

- **PR:** [PNDeb#134](https://github.com/PNDeb/pinenote-debian-image/pull/134) —
  adds the package to `07_gnome.yaml`; refs
  [PNDeb#45](https://github.com/PNDeb/pinenote-debian-image/issues/45), where
  auto-rotation was asked for so the sensor could be tested at all.

The image builds with `recommends: false`, and `iio-sensor-proxy` is only a
Recommends of `gnome-shell` and `gnome-settings-daemon`, so it is dropped and
GNOME never sees an accelerometer. `power-profiles-daemon` comes off the same
Recommends line and the image already restores it by hand.

Our workaround: `setup/setup.sh` step 14 installs the package.

## alsa-ucm-conf / alsa-tests — the microphone array

- **PR:** [alsa-ucm-conf#844](https://github.com/alsa-project/alsa-ucm-conf/pull/844)
  — the profile.
- **PR:** [alsa-tests#27](https://github.com/alsa-project/alsa-tests/pull/27) —
  the `alsa-info.sh` dump the validator needs, plus two fixes it needs to run at
  all. Their dump parser had fallen six section names behind `alsa-info.sh` (an
  unknown section is fatal, and their own `configs/USB/ALC4080.txt` already
  failed on it), its amixer regex still required `Card hw:N` where current
  alsa-utils answers `Card sysdefault:N`, and its device-name check raised
  `TypeError: NoneType + int` in exactly the case it meant to report as an
  error.

The four holes above the screen are a PDM microphone array that no shipped UCM
profile describes, so the audio stack does not present it as a usable source.
Ours is in `setup/mic/ucm2/`, with its own notes in `setup/mic/ucm2/UPSTREAM.md`
— including what the validator caught in our own profile before a maintainer
had to, which was three things.

One to carry forward: run `alsa-info.sh` from an empty directory. An unquoted
expansion in it globs the working directory into the distro line, and ours came
out carrying `systemd-private-<boot id>` paths and input-method log filenames.
(First written here as "machine id", which overstated it: checked against
`journalctl --list-boots`, the string was the boot ID, which changes every boot.
The log filenames were the part actually worth removing -- they name what the
owner runs and when.)
That was caught on the way into a public tree, not after.
