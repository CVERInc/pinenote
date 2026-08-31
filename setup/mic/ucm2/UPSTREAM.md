# Sending this to alsa-project/alsa-ucm-conf

## Does a card like this belong there?

Yes, and there is already a close precedent in the tree: `ucm2/Rockchip/rk817-sound/`
covers a different board that pairs the same rk817 codec with the same mixer
control names (`Master Playback Volume`, `Master Capture Volume`,
`Mic Capture Gain`, `Playback Mux`, `Internal Speakers Switch`) -- this
profile's `Speaker`/`Mic` devices are adapted directly from it. What is new
here is the second device: a PDM microphone array on its own PCM
(`hw:PineNote,1`), which nothing in the existing tree describes for this
board. alsa-ucm-conf already carries several exactly analogous entries for
other boards (`Intel/avs/avs_dmic/DMIC-4ch-HiFi.conf` is the same shape:
a `SectionDevice."Mic"` whose only special value is `CaptureChannels 4` on a
non-zero PCM device), so a multi-device capture-only array is not a stretch
for the format.

## Contribution mechanics (checked against the upstream README, 2026-08-31)

- Repo: https://github.com/alsa-project/alsa-ucm-conf -- PRs are accepted
  directly on GitHub (43 open at time of writing); this is not a
  mailing-list-only project like alsa-lib/alsa-driver.
- The README asks explicitly: *"If you create a pull request for new
  hardware, please, add also the alsa-info.sh output to emulate this
  hardware in the UCM validator."* **That output is a file in a different
  repository, not an attachment on the PR** -- the validator reads its card
  dumps from `alsa-tests/python/ucm-validator/configs/<Vendor>/<Card>.txt`
  (e.g. `configs/Rockchip/rk3399-gru-sound.txt`, ~1900 lines of raw
  alsa-info.sh output). So this is two pull requests: the profile to
  alsa-ucm-conf, the dump to alsa-tests. CI runs submissions through the UCM
  validator (https://github.com/alsa-project/alsa-tests/tree/master/python/ucm-validator),
  which replays `alsa-info.sh` output to emulate the card's control/PCM
  topology without the real hardware attached. A PR without that dump is
  not testable by a maintainer who doesn't own a PineNote.
- **Corrected 2026-08-31:** an earlier version of this note said no DCO
  requirement was found. There is one -- `DCO.txt` sits at the repo root, and
  recent commits carry `Signed-off-by:` trailers (checked with
  `git log --format='%(trailers:key=Signed-off-by)'`). The README does not
  mention it, which is how the first check missed it: it looked in the README
  and not at the tree. Commits need a sign-off.
- Path convention confirmed against `ucm2/README.md` shipped on-device
  (from the `alsa-ucm-conf` Debian package): the real files live at a
  vendor-qualified path (here `Rockchip/PineNote/`, matching the sibling
  `Rockchip/rk817-sound/`), and `conf.d/<CardDriver>/<CardLongName>.conf` is
  a symlink into it -- exactly the layout this directory uses, copied from
  the `PinePhone`/`rk817-sound` entries already in the tree.

## What's missing before a PR is postable

1. **`alsa-info.sh` output.** Captured on the device (`--no-upload`) and
   sitting at `/tmp/alsa-info.txt` there. It becomes
   `configs/Rockchip/PineNote.txt` in the alsa-tests PR.

2. ~~**A run through the actual UCM validator.**~~ **Done 2026-08-31 on the
   tablet** (it loads `libasound` through ctypes, so it cannot run on a mac).
   `validate.sh` next to this file reproduces it. The profile now validates
   clean -- exit 0, no errors, no warnings -- and the run paid for itself three
   times over.

   **What it caught in this profile.** `SectionDevice."Mic Array"` was not a
   legal name: UCM names are `<Base><index>` with Base from a fixed set, so it
   became `Mic2`, and the codec input beside it became `Mic1` (a bare `Mic`
   next to a `Mic2` is what the validator calls mixing indexed with
   non-indexed; the tree has 49 `Mic1` and 47 `Mic2`). `PlaybackPCM`/
   `CapturePCM` also dropped their redundant `,0`. All three would have come
   back as CI failures on the pull request.

   **What it caught in alsa-tests, which are theirs and not ours.** Three, each
   reproducible without any PineNote file present:

   - `SECTIONS` in `python/lib/alsainfo.py` is missing six section names that
     the current `alsa-info.sh` emits (`Sysfs card info`, `Sysfs ctl-led info`,
     `ACPI SoundWire Device Status Information`, `AC97 Codec information`,
     `USB Descriptors`, `USB Stream information`), and an unknown section is
     fatal. Their own `configs/USB/ALC4080.txt` already fails on it.
   - The amixer block regex requires `Card hw:<n>`. Current `alsa-info.sh`
     addresses the card by id (`amixer -c PineNote info`) and alsa-lib answers
     `Card sysdefault:0`, which does not match, and the failure is an
     `AttributeError` on `None`.
   - `check_device_names` crashes with `TypeError: unsupported operand
     type(s) for +: 'NoneType' and 'int'` when a non-indexed device precedes an
     indexed one of the same base (`Mic` then `Mic2`) -- the exact case it
     means to report as an error two lines further down.

   Also worth knowing: the validator's `all` pass is red on an untouched
   upstream tree (`USB-Audio/USB-Audio.conf`: `'If'.'opt' If requires condition
   section`), and 31 of the 39 dumps in `configs/` fail the `configs` pass for
   reasons that predate us. Do not read either as a verdict on this profile.

   **On real hardware, after the rename:** `alsaucm -c PineNote set _verb HiFi
   list _devices` reports Speaker/Mic1/Mic2, and a capture through `Mic2` gives
   four live channels.

3. ~~**A decision on the `Headphones` device.**~~ **Settled 2026-08-31, from
   mainline's own device tree rather than by guessing at the case.** The board
   does have a headphone path -- the wiki says the codec's headphone output is
   routed to the USB-C audio/USB switch, and `rk3566-pinenote.dtsi` declares
   the widget for it (`widgets = "Headphone", "Headphones"`, `routing =
   "Headphones", "HPOL"` / `"HPOR"`). What it does not have is any way to reach
   it: the same file's `usb-c-connector` node carries only a USB2 HS endpoint,
   with no audio mode and no mode-switch or mux binding, and there is no jack
   detection anywhere in the tree. A `Headphones` device would therefore be
   selectable, silent, and with no control for `JackControl` to name. It stays
   out, and `HiFi.conf` now records that reasoning where the next reader will
   look. Worth revisiting if the connector gains an audio-mode binding.

   The same file also settles two things that were previously taken on trust:
   `simple-audio-card,name = "PineNote"` confirms the CardLongName the conf.d
   symlink depends on, and the HPOL/HPOR -> Speaker Amp -> "Internal Speakers"
   routing explains why the borrowed `If.1` branch -- which reads as inverted --
   is the right one for this board.

4. **Someone who can answer maintainer follow-up.** alsa-ucm-conf's
   maintainers are known to ask clarifying questions about hardware they
   don't have; whoever posts the PR should own the device or be able to
   reach someone who does, to re-run `alsaucm`/`arecord` on request.

None of this is hard, it just wasn't in scope for proving the profile works
locally. The profile in this directory is otherwise upstream-shaped as-is:
same file layout, same conf.d symlink mechanism, same style of borrowing a
sibling profile's mixer plumbing that the existing tree already does for
`rk817-sound`.

## Honest assessment: is upstreaming worth it over the PipeWire drop-in?

For this one machine, no -- the drop-in already works and upstreaming a PR
does nothing for the maintainer's tablet today; review latency on a
niche-hardware ALSA PR is measured in months, if it lands at all. For every
*other* PineNote, yes: the drop-in is a per-machine file nobody else will
ever discover, while a merged UCM profile fixes the card for anyone running
a stock `alsa-ucm-conf` package, with no PipeWire configuration at all. The
two aren't actually in tension -- ship the drop-in now, submit the UCM
profile because it's nearly free (the hard part, measuring what the array
actually is, is already done and written up), and drop the shim locally
once alsa-ucm-conf ships it for real.
