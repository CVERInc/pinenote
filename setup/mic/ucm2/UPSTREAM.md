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
  hardware in the UCM validator."* CI runs submissions through the UCM
  validator (https://github.com/alsa-project/alsa-tests/tree/master/python/ucm-validator),
  which replays `alsa-info.sh` output to emulate the card's control/PCM
  topology without the real hardware attached. A PR without that dump is
  not testable by a maintainer who doesn't own a PineNote.
- No DCO/Signed-off-by requirement was found in the README; a plain PR
  appears sufficient, but that should be re-checked against
  `CONTRIBUTING.md` if one exists at PR time (none was found at the repo
  root as of this check).
- Path convention confirmed against `ucm2/README.md` shipped on-device
  (from the `alsa-ucm-conf` Debian package): the real files live at a
  vendor-qualified path (here `Rockchip/PineNote/`, matching the sibling
  `Rockchip/rk817-sound/`), and `conf.d/<CardDriver>/<CardLongName>.conf` is
  a symlink into it -- exactly the layout this directory uses, copied from
  the `PinePhone`/`rk817-sound` entries already in the tree.

## What's missing before a PR is postable

1. **`alsa-info.sh` output**, captured on the actual PineNote and attached to
   the PR, per the README's explicit ask. Not run as part of this task
   (out of scope / not installed on-device); would need to be fetched from
   `https://www.alsa-project.org/alsa-info/alsa-info.sh` and run there, or
   assembled by hand from `/proc/asound/*`, `amixer -c0 contents`, and
   `arecord -l` -- most of which is already gathered in this repo's README
   section "The microphones nobody uses" and in this task's session log.
2. **A run through the actual UCM validator** (alsa-tests), not just
   `alsaucm -c PineNote ...` against the live card. The validator emulates
   the card from the alsa-info.sh dump, which is a slightly different code
   path than opening a real control device, and is what CI will actually
   run.
3. **A decision on the `Headphones` device.** The rk817 codec's `Playback
   Mux` control offers an `HP` item and the borrowed `Speaker` section
   assumes both exist, but nothing in this task confirmed the PineNote
   actually wires out a headphone jack (no `Headphones Jack` control is
   present in `amixer -c0 contents`, and it's a Boox-style e-reader tablet,
   not obviously headphone-equipped). This profile deliberately leaves the
   `Headphones` device out rather than guess; upstream will likely ask the
   same question, and it's better resolved by someone who can look at the
   physical unit than invented here.
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
