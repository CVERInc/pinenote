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

## gnome-shell — latched modifiers and the on-screen keyboard's keyval keys

- **Issue:** [gnome-shell#9397](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/9397)
  (open), with the patch attached as a comment so it can be applied without
  waiting for the MR.
- **MR:** [gnome-shell!4386](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/4386)
  — `keyboard: Forward latched modifiers on the keyval path`, from the fork at
  `cver/gnome-shell`, branch `osk-keyval-modifiers`.

`Keyboard._addRowKeys` hands `this._modifiers` to `commit()`, the path a
character key takes, and not to the branch above it, where every key with a
keyval lives — Tab, Escape, Enter, the arrows, Home/End, Page Up/Down. A latched
Ctrl reached `c` and not `←`. Present in 47, in the 48.7 this device runs, and on
`main` as of 2026-09-05; searched under the `5. On-screen Keyboard` label (198
issues) and a dozen queries before filing, after checking the search could find
a known MR. The nearest prior report, #8670, was a different bug in Mutter.

Shift is a separate matter: upstream's Shift is a level switch and never a held
key, so Shift+Tab has no path at all. The issue notes it; the MR does not attempt
it.

Our workaround: `extensions/pn-osk@cver.net`, behind `chords` in `pn-osk.json`,
patches the controller and makes the right Shift a real `Shift_L`. Keep it until
the MR is in a release this device runs; the Shift half stays regardless.

Filing this needed a gitlab.gnome.org account. New accounts there cannot create
projects — and so cannot fork — until an SSH key is on the account, after which
automation lifts the limit within about half an hour. That is documented in the
GNOME handbook; the error message does not say so.

## gnome-shell — dead Key objects in `_modifierKeys` after a layout rebuild

- **Issue:** [gnome-shell#9408](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/9408)
  (open, filed 2026-09-10; report text in
  [`upstream/gnome-shell-modifier-keys-dead-objects.md`](upstream/gnome-shell-modifier-keys-dead-objects.md))
- **MR:** ours, [gnome-shell!4394](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/4394),
  is **closed**. A maintainer replaced it the same hour with
  [!4396](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/4396),
  `keyboard: Properly use modifier keys as a Map (and clear them on reset)`,
  which carries `Closes: #9408 (overrides !4394)`. Theirs is the better patch
  on two counts: it makes every access use the `Map` the field is declared as,
  rather than leaving that inconsistency for later as ours did, and it clears
  `_modifiers` alongside `_modifierKeys` so a modifier latched before a rebuild
  cannot survive it with no key left to paint. The one comment on ours also
  said the description was too verbose to read, which is the lesson worth
  keeping: the investigation belongs in the issue, and the merge request gets
  the change.

`Keyboard._addRowKeys` appends every on-screen modifier key to
`this._modifierKeys[keyval]`, which `_setModifierEnabled` walks to latch or
unlatch them together. `_updateLayout` destroys `this._currentLayout` —
every `Key` the prior `_addRowKeys` run built — on each rebuild, but never
clears that map, so the destroyed generation's Keys stay in the lists the
next modifier tap walks, and each tap logs one "Object St.Button has been
already disposed" per dead key. One session on this device accumulated
7,008 of them; the one before, 2,880.

Fix: reset `this._modifierKeys` to `{}` at the top of `_updateLayout`,
before the `_addRowKeys` calls that repopulate it — matching how the field
is read and written everywhere (bracket access), despite being declared
`new Map()` in the constructor. That mismatch is called out in the MR and
left as a separate cleanup.

Our workaround: `extensions/pn-osk@cver.net` clears `this._modifierKeys` at
the top of its `_updateLayout` wrapper. It clears rather than reassigns, so
that it stays harmless on a shell that has taken !4396 and turned the field
into a real `Map`. Keep it until that lands here.

## pinenote-gnome-extension — quality-mode honours its value

- **PR:** [PNDeb/pinenote-gnome-extension#26](https://github.com/PNDeb/pinenote-gnome-extension/pull/26)
  — `_apply_quality_mode()` derives the direction from the setting's value
  instead of toggling off the driver's state.

The handler for `changed::quality-mode` was handed the new value and ignored
it: it read `dclk_select` back from the driver and flipped whatever it found, so
every change toggled. Correct as long as the setting and the driver agree, and
they do agree until a driver reset at boot or another client writing the
setting — at which point `quality-mode=true` can switch the panel to 80 Hz.
Found while wiring our tone button to that setting (`docs/display.md`, *The
five frames a second nobody mentioned*).

Our side does not work around it: pn-panel writes the setting and relies on
pnhelper keeping the two in step, which pnhelper's own toggle already repairs.
