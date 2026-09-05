# pinenote

> **Everything CVER runs on the Pine64 PineNote.** The settings and three GNOME extensions
> that make a Debian/GNOME image behave on e-ink — and, at more length, what each of them
> cost to get wrong first.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Device: PineNote](https://img.shields.io/badge/Device-Pine64%20PineNote-brightgreen.svg)
![Shell: bash](https://img.shields.io/badge/Shell-bash-lightgrey.svg)

---

## What & why

The PineNote ships a Debian/GNOME image that drives the e-ink panel as though it were an
ordinary display. Nothing is broken and almost every default is wrong for the panel: the
partial-refresh waveform is the one the kernel source itself annotates as "flashy", and it
is applied to every keystroke.

Most of what follows hangs off one button. The tone control switches between two modes, and
each carries a waveform, and the waveform decides what happens to ghosting:

| Mode | Waveform | Ghosting | Ink | Clearing |
|---|---|---|---|---|
| Greyscale — the default | GC16 | never accumulates: every update resets as it draws | faint, because a pen outruns a 450ms waveform | not needed |
| Black and white | A2 | accumulates | keeps up with the pen | scheduled |

Neither is the better one. They are two tasks — reading and writing — and the trade only
resolves once you know which you are doing, which is why this is a button rather than a
setting somebody picks once.

Where clearing is needed it does not have to be a flash. Driving every pixel to both rails
and changing the brightness of the whole field at once are separable, and only the second is
unpleasant: a complementary dither gives every pixel the same swing the stock flash does
while the screen's mean luminance never leaves mid grey. Thirty-two of those fired here in
one evening without being noticed.

The rest of this repo is mostly the measurements that got there, including the ones that
were wrong for a while.

## setup/

One line on a clean PineNote:

```sh
curl -sL https://raw.githubusercontent.com/CVERInc/pinenote/main/setup/bootstrap.sh | bash
```

It is idempotent, and it installs:

- **Typing mode** — A2 waveform, dithered B/W (icons keep their shading), `auto_refresh` off,
  persisted via `/etc/modprobe.d/rockchip_ebc.conf` and a systemd user service.
- **Idle refresh** — a small daemon that watches GNOME's idle monitor and clears the screen
  once you have been still for 8 seconds. The clear itself is `pn-wave`'s complementary
  dither rather than the stock flash; see [*The clear you do not see*](docs/display.md#the-clear-you-do-not-see).
- **The clear** — `extensions/pn-wave@cver.net` installed and enabled, and the kernel's own
  `auto_refresh` turned off at the setting that actually owns it.
- **The keyboard** — `extensions/pn-osk@cver.net` installed and enabled, with
  `pn-osk.example.json` dropped in as `~/.config/pn-osk.json` if you do not have
  one yet. An existing config is never overwritten.
- **The panel** — `extensions/pn-panel@cver.net` installed and enabled. Separate
  from the keyboard on purpose; see [*The panel it taps*](docs/panel.md#the-panel-it-taps).
- **Input methods** — `setup/ime.sh`, run by `setup.sh` unless `PINENOTE_NO_IME=1`.
  Pinyin and bopomofo that output traditional, Japanese by romaji, Korean
  installed but left out of the switching list; see [*The languages it types in*](docs/keyboard.md#the-languages-it-types-in).
- **Terminal legibility** — pure black on pure white, no cursor blink, a large monospace face,
  and a sixteen-slot ANSI palette split into marks and plates; see [*The agent it codes with*](docs/agent.md#the-agent-it-codes-with).
- **A guard on `pinenote-dbus-service`** — without it the whole clearing half can die silently;
  see [*When the ghosting stops clearing*](docs/setup.md#when-the-ghosting-stops-clearing).
- **A sleep screen** — optional, and only if you have put a `~/offscreen/screen.bin` there.
  Installed as firmware and re-applied at every boot by `pn-offscreen.service`, because the
  firmware path alone does not survive a reboot; see [*The picture it sleeps under*](docs/setup.md#the-picture-it-sleeps-under).
- **Lifelines** — SSH enabled, idle suspend disabled, GNOME's shell and mutter held back (what
  is actually documented on this device is a full `dist-upgrade` leaving it with no gdm3 — not
  a fault in any one GNOME release), and [`setup/lifeline.sh`](docs/setup.md#setuplifelinesh).

Everything is plain bash and gsettings. Read `setup/setup.sh` top to bottom before you run it.

## The rest of it

The measurements, the wrong turns, and the reasoning behind each piece live in `docs/`, one
file per subject, in the order the device asks for them:

- [`docs/setup.md`](docs/setup.md) — the gpio-keys race that silently stopped the ghosting from
  clearing, the five settings behind `lifeline.sh`, the `pn` command, and the picture the panel
  sleeps under after you press lock.
- [`docs/display.md`](docs/display.md) — the complementary-dither clear that 32 firings in one
  evening went unnoticed, the six greys everything on this panel is drawn in, and a rotation
  glitch that never reproduced under a clean test.
- [`docs/keyboard.md`](docs/keyboard.md) — the 65% keyboard built for a band GNOME already
  reserved and would not spell its own labels, a latched modifier that finally reaches Shift+Tab
  and Ctrl+arrow, and the five input methods — RIME's bopomofo among them — that share it.
- [`docs/launcher.md`](docs/launcher.md) — widening the app grid so names stop truncating, and
  the six attempts it took to move two arrows.
- [`docs/panel.md`](docs/panel.md) — one tap each for clearing the ghosting, rotating the screen,
  and swapping the tone, instead of three menus buried at different depths.
- [`docs/agent.md`](docs/agent.md) — Lumalock, the six-override ANSI theme Claude Code reads on
  this device, and what "an override lands only if the key exists" cost the version before it.
- [`docs/microphones.md`](docs/microphones.md) — four PDM microphones nobody had documented, what
  beamforming can and cannot do with them, and dictating through whisper.cpp on the device itself.

## Upstream

Four of the fixes here are workarounds for things that belong in someone else's tree, and
[`UPSTREAM.md`](UPSTREAM.md) records which have been raised, where, and what came back. Read
it before filing anything: we once reported the accelerometer collision twice from the same
account, weeks apart, because the second search came back empty and that was trusted.

[PR #25](https://github.com/PNDeb/pinenote-gnome-extension/pull/25) uncomments
`_add_waveform_buttons()`, which is what puts A2 in Pinenote Helper's menu at all. It was
opened against a version where that call and the line pairing *BW+Dither* with A2 were both
commented out. The `1.8.dev` package installed here has both enabled already, so on this
device the change has arrived by another route and the patch has nothing left to do.

Nothing here patches Pinenote Helper. The waveform this workflow needs is chosen by the tone
button above, through the same D-Bus interface the extension itself calls.

## License

MIT — see [LICENSE](LICENSE).
