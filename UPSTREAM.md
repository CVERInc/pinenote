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
- **PR:** [systemd#43569](https://github.com/systemd/systemd/pull/43569) — reverts
  the entry, as the maintainer asked for in the issue.

`60-sensor.hwdb` carries an `ACCEL_MOUNT_MATRIX` labelled for the PineTab2,
keyed on a modalias that names the chip (`silan,sc7a20`) and not the machine.
The PineNote mounts the same chip differently, and its device tree already
supplies the right matrix, which the hwdb entry then overrides. A narrower entry
cannot be written: `of:N<name>T<type>C<compatible>` describes the sensor node,
and on a device-tree machine there is no DMI half to the lookup key, so both
boards present an identical match string.

Our workaround: `setup/udev/61-sensor-pinenote.rules`, filed after the `60-` rule
that imports hwdb, reasserts the device-tree value. It becomes unnecessary if the
revert lands.

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

## alsa-ucm-conf — the microphone array

- **Status:** not yet filed, and it is **two** PRs rather than one — the profile
  goes to `alsa-project/alsa-ucm-conf`, and the `alsa-info.sh` dump the README
  asks for is a file in `alsa-project/alsa-tests`
  (`python/ucm-validator/configs/Rockchip/PineNote.txt`), not an attachment.
  Commits there need a `Signed-off-by` (DCO.txt is at the repo root; the README
  does not mention it).
- **Settled:** the `Headphones` device stays out, for a checkable reason — see
  `setup/mic/ucm2/UPSTREAM.md`.
- **Blocked on:** one run of `setup/mic/ucm2/validate.sh` on the tablet. The
  upstream validator loads `libasound` through ctypes, so it cannot run on a
  mac.

The four holes above the screen are a PDM microphone array that no shipped UCM
profile describes, so the audio stack does not present it as a usable source.
Ours is in `setup/mic/ucm2/`, with its own notes in `setup/mic/ucm2/UPSTREAM.md`.
