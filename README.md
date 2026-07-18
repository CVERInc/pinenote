# pinenote

> **Everything CVER runs on the Pine64 PineNote.** It starts with the one fix that made the
> device usable as a terminal: typing on e-ink without the screen flashing every few words —
> and clearing the ghosting only once you stop typing.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Device: PineNote](https://img.shields.io/badge/Device-Pine64%20PineNote-brightgreen.svg)
![Shell: bash](https://img.shields.io/badge/Shell-bash-lightgrey.svg)

---

## What & why

The PineNote ships a Debian/GNOME image that drives the e-ink panel like an ordinary display.
Type in a terminal and the whole screen flashes every ~20 characters. That is not a bug in
your setup: the driver's default *partial* refresh waveform is **GC16**, the one the kernel
source itself annotates as "flashy" — and it is applied to every single keystroke.

Switching partial refreshes to **A2** (fast binary black/white transitions) removes the flash
completely. But A2 has a catch: its refresh areas are tiny, so the driver's area-accumulating
`auto_refresh` never reaches its threshold and ghosting builds up without ever being cleared.

The answer is not a gentler cleanup waveform. Clearing ghosting *requires* driving every
pixel, which is always visible — gentle waveforms simply fail to clean. The answer is
**timing**: never clear while you are typing, then clear properly the moment you stop. It is
the same trick a Kindle uses when it hides its flash inside a page turn.

So this is less a set of parameters than a behaviour:

| When | What | Why |
|---|---|---|
| You are typing | A2, no automatic clear | fast, flash-free, never interrupts you |
| You stop (8s idle) | one GC16 global refresh | ugly, but you are not looking |
| You want it now | the panel's ↻ button | manual escape hatch |

## setup/

One line on a clean PineNote:

```sh
curl -sL https://raw.githubusercontent.com/CVERInc/pinenote/main/setup/bootstrap.sh | bash
```

It is idempotent, and it installs:

- **Typing mode** — A2 waveform, dithered B/W (icons keep their shading), `auto_refresh` off,
  persisted via `/etc/modprobe.d/rockchip_ebc.conf` and a systemd user service.
- **Idle refresh** — a small daemon that watches GNOME's idle monitor and calls
  `org.pinenote.ebc.TriggerGlobalRefresh` once you have been still for 8 seconds.
- **Terminal legibility** — pure black on pure white, no cursor blink, a large monospace face.
- **Lifelines** — SSH enabled, idle suspend disabled, GNOME 48 held back (its mutter has a
  documented history of breaking boot on this device).

Everything is plain bash and gsettings. Read `setup/setup.sh` top to bottom before you run it.

## Upstream

The A2 waveform is not exposed in PineNote Helper's menu, although the code for it exists —
`_add_waveform_buttons()` sits commented out in `extension.js`, and so does the line that
would make *BW+Dither* select A2. Re-enabling them is what makes this workflow reachable from
the GUI instead of from `/sys`. Our contribution back to PNDeb is tracked here as it lands.

## License

MIT — see [LICENSE](LICENSE).
