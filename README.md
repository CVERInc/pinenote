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
- **A guard on `pinenote-dbus-service`** — without it the whole clearing half can die silently;
  see *When the ghosting stops clearing* below.
- **Lifelines** — SSH enabled, idle suspend disabled, GNOME 48 held back (its mutter has a
  documented history of breaking boot on this device), and `setup/lifeline.sh` below.

Everything is plain bash and gsettings. Read `setup/setup.sh` top to bottom before you run it.

### When the ghosting stops clearing

Half of this design is *not clearing* while you type. That half never breaks loudly — so when
the other half dies, the symptom is simply a screen that slowly becomes unreadable, with no
error anywhere you would think to look. Both halves of that failure happened here, and both
were silent for days:

1. **`pinenote-dbus-service` panics at boot.** It reads
   `/sys/devices/platform/gpio-keys/power/wakeup` while checking travel mode, and `gpio-keys`
   (the magnetic cover switch) can lose a boot-time race with its GPIO controller:

   ```
   gpio-keys gpio-keys: error -ENXIO: Unable to get irq number for GPIO 0
   ```

   A device that never probed has no `power/wakeup`, so the service exits 101 and
   `org.pinenote.ebc` never reaches the bus — and `TriggerGlobalRefresh` has no listener.
   Rebinding after boot always works, which is what the drop-in in `setup/` does.

2. **The idle daemon parsed its own input wrong.** GNOME's idle monitor answers
   `(uint64 342896,)`, and a `grep -oE '[0-9]+'` over that returns **two** numbers — the `64`
   in `uint64` first. Every comparison then failed with *integer expression expected*, roughly
   174,000 times per boot, straight into the journal. The refresh never fired once.

If ghosting stops clearing, check these in order:

```sh
systemctl status pinenote-dbus-service          # exit 101 => the gpio-keys race
journalctl --user -u pn-idle-refresh -b         # the daemon now says so when it cannot refresh
pn_trigger_global_refresh                       # does a manual clear still work?
```

The general lesson is worth more than either bug: **a component whose job is to stay quiet
needs to be loud when it fails.** The evidence for both was sitting in the journal the entire
time. Nobody had a reason to look, because nothing ever said anything was wrong.

### setup/lifeline.sh

The four settings that decide whether you can service this device from another machine at
all. They are separate because three of them need something only you can supply, and one of
them is a security trade-off nobody should inherit silently.

| | Needs | Default |
|---|---|---|
| Persistent journal | nothing | **applied** — stock journald is volatile, so the log of a crash dies with the crash |
| SSH authorised key | `PINENOTE_SSH_PUBKEY` | skipped |
| Wi-Fi connection | `PINENOTE_WIFI_SSID`, `PINENOTE_WIFI_PSK` | skipped |
| Passwordless sudo | `PINENOTE_NOPASSWD_SUDO=1` | skipped — read the block first |

Two findings worth keeping even if you write your own:

- On a **WPA2/WPA3 transition** network, nmcli's shorthand and an explicit `sae` both fail to
  associate. It has to be `wifi-sec.key-mgmt wpa-psk`.
- `nmcli connection add` **over SSH** fails with *Insufficient privileges* — polkit grants
  NetworkManager writes to an active local session, and an SSH login is not one. Use `sudo`,
  which is the better answer regardless: a root-owned system connection comes up at boot
  without waiting for a login.

## Upstream

The A2 waveform is not exposed in PineNote Helper's menu, although the code for it exists —
`_add_waveform_buttons()` sits commented out in `extension.js`, and so does the line that
would make *BW+Dither* select A2. Re-enabling them is what makes this workflow reachable from
the GUI instead of from `/sys`. Our contribution back to PNDeb is tracked here as it lands.

## License

MIT — see [LICENSE](LICENSE).
