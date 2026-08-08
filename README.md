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
- **The keyboard** — `extensions/pn-osk@cver.net` installed and enabled, with
  `pn-osk.example.json` dropped in as `~/.config/pn-osk.json` if you do not have
  one yet. An existing config is never overwritten.
- **The panel** — `extensions/pn-panel@cver.net` installed and enabled. Separate
  from the keyboard on purpose; see *The panel it taps*.
- **Terminal legibility** — pure black on pure white, no cursor blink, a large monospace face.
- **A guard on `pinenote-dbus-service`** — without it the whole clearing half can die silently;
  see *When the ghosting stops clearing* below.
- **A sleep screen** — optional, and only if you have put a `~/offscreen/screen.bin` there.
  Installed as firmware and re-applied at every boot by `pn-offscreen.service`, because the
  firmware path alone does not survive a reboot; see *The picture it sleeps under* below.
- **Lifelines** — SSH enabled, idle suspend disabled, GNOME's shell and mutter held back (what
  is actually documented on this device is a full `dist-upgrade` leaving it with no gdm3 — not
  a fault in any one GNOME release), and `setup/lifeline.sh` below.

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

### The picture it sleeps under

The PINE64 still life you are left staring at after you press lock is not a GNOME lock screen,
and the setting that looks like it should change it does nothing: `org.gnome.desktop.screensaver
picture-uri` is a dead key — GNOME Shell reads only `user-switch-enabled` out of that schema.
The lock screen's *own* background is your desktop wallpaper with a blur of radius 90 and
brightness 0.65 hardcoded in `unlockDialog.js`, which on e-ink is a field of grey noise.

The still life comes from a layer below all of that. As the panel powers down the EBC driver
pushes `/lib/firmware/rockchip/rockchip_ebc_default_screen.bin` straight at the controller —
1872x1404, 4 bits per pixel, two pixels to a byte, exactly 1,314,144 of them. It is 1:1 with
the physical pixels: no blur, no clock, no unlock dialog, and it stays there for days, because
the picture survives the power going away. `setup/offscreen/` turns a photograph into one.

Writing that file is not, on its own, enough to change the picture — see the first bullet
below. That took a reboot to find out.

![A cat, as the PineNote sleeps under it](setup/offscreen/example.png)

*16 grey levels, Floyd–Steinberg, no blur and no clock, held in landscape. Shown at half size
and re-dithered at that size — scaling an already dithered image is how you get moiré. The
real buffer is 1404x1872, 1:1 with the panel. The maintainer's cat, published at the
maintainer's insistence.*

Four things are worth knowing before you make your own:

- **The file the driver reads is the one in the initramfs.** `rockchip_ebc` is a module packed
  into the initramfs and it probes at t+1.3s, so `request_firmware` is answered from there, not
  from the root filesystem you just wrote to. The initramfs was built with the stock picture in
  it, which means your picture is read exactly never — and nothing tells you, because from the
  driver's side nothing failed. It looks correct for as long as the machine stays up, since the
  runtime call below is what put it on the panel, and it is gone after the next boot. `setup.sh`
  therefore also installs `pn-offscreen.service`, which re-applies the picture through that same
  runtime call once the bus is up. Making the file itself authoritative means regenerating the
  initramfs — `PINENOTE_OFFSCREEN_INITRAMFS=1 setup/setup.sh`, opt-in on purpose, because this
  device's only recovery path is maskrom and an initramfs is a thing you can get wrong.
- **The buffer is stored mirrored.** Upright frame to panel is `-flop -rotate 90`, and the
  stock image is the proof — it only comes back readable through exactly that pair. Verify
  against it rather than reasoning about it; `pnimg.py selftest` re-encodes the stock PNG and
  checks it byte for byte against the stock buffer.
- **You do not have to reboot to look.** `org.pinenote.ebc.SetOfflineScreenFromFileTemporary`
  swaps the picture at runtime. On this device that is not a convenience: every reset path
  ends in the machine losing power, and only the physical button brings it back, so "reboot to
  see whether that brightness was right" costs a person walking over to the desk.
- **Your monitor will lie to you about tone.** 16 levels, and a reflective white that returns
  maybe 40% of the light — an image that looks well separated on a laptop arrives flat and
  grey in the hand. The script prints a distribution instead: median for how grey it is,
  near-white for how much highlight detail got flattened, and p1 for whether anything still
  reads as black. Brightening via the white point and brightening via gamma move different
  numbers, and only one of them costs you the fur.

One quieter trap: dither against the 16 levels the buffer can actually hold (0, 17, ... 255).
Dither to anything else and the encoder quantises a second time, undithered — which turns a
carefully dithered gradient straight back into banding, after you already paid for it.

## The keyboard it types on

GNOME's on-screen keyboard reserves a band the full width of the monitor and a
third of its height in landscape, then draws the keys inside a container that
preserves the layout's column-to-row ratio and centres whatever it cannot fill.
On this panel the keys got 1207 of 1872 pixels. The top 98 of the band's 468
pixels belong to a word-suggestions strip that a terminal never fills. And the
keys were narrow enough that the terminal layout's own labels ellipsized: `Tab`
rendered as `T…`, `Ctrl` as `C…`, `?123` as `?…`. They were not mystery keys.
They were keys that could not spell their names.

![The keyboard, landscape and portrait](extensions/pn-osk@cver.net/keyboard.png)

`extensions/pn-osk@cver.net` makes the keys use the band that was already being
paid for, and rebuilds the terminal layout as a 65% keyboard: the digits with
their shifted faces, the punctuation where fingers expect it, an inverted-T, and
a navigation column down the right edge. Portrait gets the same keyboard: one
layout in both orientations is worth more than two tuned ones, and rotating the
tablet no longer moves a key. The modifiers are named in lower case on both — the
words fit once the label size is trimmed, and a key that can spell itself beats a
glyph you have to learn. Escape keeps `⎋` in portrait, where the column is
narrowest. Renames live in `labels` (both orientations) and `portrait.labels`
(upright only), the second layered over the first.

It also adds an Escape key, which the stock terminal layout does not have in any
of its four levels. That gap is [three years old
upstream](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2551).

Caps Lock says which state it is in. Pressing it latches the whole shift level —
that part works — but GNOME only ever paints a key as *latched* on the
long-press-Shift path, and the caps key is not in the list that gets told. The
state was real and invisible at once. A `:latched` rule in the stylesheet was
tried first and did nothing, because the pseudo class never arrives. So the key
is named after what it is doing instead: `caps lock` becomes `caps locked`. On a
panel with two colours and no animation, words are the signal that survives.

### On GNOME 48

48 renames every keyboard-specific OSK icon to an `osk-` prefix —
`keyboard-enter-symbolic` becomes `osk-enter-symbolic`, and likewise for shift,
caps lock, hide, layout, emoji and delete. The generic `go-*-symbolic` arrows are
left alone. The extension matches both spellings, so one copy runs on 47 and 48.

Only one of those renames actually mattered, and it is worth knowing why: `enter`
is the single icon behind `_composeLevel`'s `return null`. One failed lookup
dropped the entire layout back to stock while the extension still reported
`ACTIVE`, still answered on D-Bus, still read its config, and composed exactly
zero rows. Nothing in the journal said so. If this keyboard is ever silently the
stock one again, `trace` in the config prints what `_updateLayout` was handed and
whether `_addRowKeys` ever saw a composed row — that is the shortest path back.

The keyboard also sits past the bottom of its band, and it is tempting to file
that under 48. It is not. Measured on both systems: keys are 94 physical pixels
on 47 against 96 on 48, five rows overflow by six either way, and `font-size` is
`1.455em` in both themes. **47 has been overflowing since the first day.** What 48
changed is the scale — rotating the tablet makes it write `scale=2` into
`monitors.xml` — so the same six logical pixels arrive as twelve physical ones
and stop being invisible. `stylesheet.css` trims label and icon, which takes keys
to 92 and the overflow to four, and is also what lets `caps locked` fit its three
columns.

This was first written up the other way round, as *48 enlarges the key font*,
from numbers that looked twice as large on one side — because they were logical
pixels under a 2x scale on one system and physical pixels under 1x on the other.
Two coordinate systems, read as one measurement. Correcting it cost a reboot into
the older install and one more look, which is the practical argument for keeping
that install around: a second system is not only a way back, it is the only
control group this device has.

The gap above the screen edge costs width: `AspectContainer` holds a ratio, so
every pixel taken off the band returns as roughly two pixels of margin on each
side. Loosening `.key-container` padding does not help, and neither does an
explicit `height` — only the font size moves a key's height, and that is a
legibility budget, not a layout knob.

Every width lives in `~/.config/pn-osk.json` and is re-read on each rebuild, so
changing the shape of the keyboard costs a JSON edit and a D-Bus call rather
than a session restart. **Read
[GEOMETRY.md](extensions/pn-osk@cver.net/GEOMETRY.md) before changing one** —
half a column is the smallest width this keyboard can express, and finer values
are truncated without complaint.

The extension also exposes `Capture` and `Geometry` on
`org.cver.PnOsk`. That is not a debugging leftover: GNOME refuses screenshots to
callers outside the shell, and `/dev/fb0` on this device holds whatever plymouth
last drew rather than the live desktop, so there was no way to see this layout
over SSH except by photographing the glass. `setup/oskshot` counts down and then
takes the picture, which leaves your hands free to rotate the tablet or hold
shift while it fires.

### What the measurements could not tell us

The instrumentation found the 17 columns, the 0.5 grid, and an override that was
silently doing nothing because an unallocated actor reports its box as
`±Infinity` and `|| fallback` does not catch that.

It did not find any of this:

- that the keys should **not** be aligned — the left edge of a real keyboard is
  a staircase, and a straight one is harder to type on
- that up and down should be wider than left and right, but only where they are
  not sitting next to each other
- that `` ` ~ `` cannot leave the number row, whatever it costs elsewhere
- that a forward delete key never needed to exist

Every one of those came from looking at the glass, and three of them reversed
what the arithmetic was busy doing at the time. The layout in the screenshot is
not a design that was computed. It is what two ways of being wrong converged on.

## The launcher it opens

The app grid used to show about seven characters of a name before an ellipsis.
Widening the cells is the obvious move and it does not work: the grid picks its
column count first, then takes the largest icon size that still fits, so the
cell width is capped by whatever vertical space is left. What was eating that
space is a shrunken workspace preview and a dash, both of which the APP_GRID
state keeps around for reasons that make sense on a laptop and none here. On a
tablet whose overview is only ever a launcher, both are pure cost.

So APP_GRID now hands the whole screen to the grid, and the page arrows moved
out of the gutters they used to reserve and up beside the search box, flush with
the screen edges. Most names fit outright now — Contacts, Weather, Calendar,
Extensions and LibreOffice were all truncated before. The entry path is
unchanged: the panel corner still opens the overview with its workspaces and
dash intact, and the grid is one tap further in.

### Why the arrows took six attempts

They are St widgets, so the first instinct is CSS. CSS in St covers appearance
and never geometry — `color` and `font-size` take, anything positional does not.
Geometry belongs to a `Clutter.LayoutManager`, so the next instinct is to patch
`BaseAppViewGridLayout.vfunc_allocate`. That cannot be done from JS: Clutter
calls the pointer bound at class registration, and overriding the prototype
changes nothing. Ordinary methods on the same object patch fine, which is what
makes this confusing — `_computeWorkspacesBoxForState` and `vfunc_allocate` look
identical from JS and only one of them is yours.

What works is taking the actors away: reparent both arrows into a fixed-position
layer of our own and set their coordinates directly. That got one arrow into
place and left the other at zero width, at x = the screen's right edge, for
three rounds. Both arrows reported identical properties — same style class, same
alignment, same 104px preferred size — so the difference was not in the actors.

`clutter_actor_allocate()` can be called on any actor, not just your own
children, and the original grid layout still calls it on both arrows every
frame. `_getIndicatorsWidth` had been patched to return 0 to reclaim the
gutters, so the box it hands them is zero-width and pinned to the edge. The
asymmetry was the tell and it pointed the wrong way: `prev` was hidden on the
first page, and `clutter_actor_allocate()` returns early for invisible actors.
Being hidden was the only thing protecting it.

The fix is to give the layout two invisible decoys to allocate and keep the real
arrows in our layer. The `clicked` handlers were connected to the real buttons
at construction, so paging still works. Their size comes from the stylesheet;
only position is ours. An earlier version wrote `set_size(arrow.width || 48)`,
which reads zero and writes zero straight back.

### Reloading an extension on GNOME 48 Wayland

None of the quick paths work, and each fails in a way that looks like success:

- `gnome-extensions disable && enable` calls `disable()`/`enable()` on the
  module already in memory. Extensions are ESM now and the import is cached by
  URL, so the file on disk is never re-read. Everything you measure afterwards
  is the old code, and it looks like your change had no effect.
- `org.gnome.Shell.Extensions.ReloadExtension` answers
  `NotSupported: ReloadExtension is deprecated and does not work`.
- `systemctl --user restart org.gnome.Shell@wayland.service` is refused; the
  unit is `RefuseManualStart`. Restarting `org.gnome.Shell.target` returns
  success and leaves the same PID running.
- Killing gnome-shell works, but the unit is `Restart=no`, so nothing brings it
  back and the tablet sits on the greeter.

What works is `sudo systemctl restart gdm3`. `AutomaticLoginEnable` fires on
GDM startup — not after a session ends — so this is also how you get back from
the greeter if you already killed the shell. Open windows close either way.

## The four values it draws with

The panel has sixteen levels — 0 to 255 in steps of 17 — and `0x11` is 17, so
those sixteen levels are exactly the sixteen three-digit shorthand greys, `#000`
through `#fff`. The whole rule is: **write greys as `#NNN`**. Anything that
cannot be written that way is off the grid and will be quantised again on its way
to the panel, which is where mid-tones turn into noise.

| | | for |
|---|---|---|
| ink | `#000` | text, emphatic borders, icons |
| sunk | `#333` | components that recede |
| slate | `#777` | separators, secondary containers, disabled states |
| shadow | `#aaa` | container beds, panel beds |
| wash | `#ddd` | the faintest emphasis, sitting on paper |
| paper | `#fff` | ground, foreground components |

They are named for the **role** they play, not for how bright they are. Chinese
ink painting has a canonical vocabulary for exactly this range — five tones of a
single ink — and it is tempting on a device made of ink and paper, but it names
density. A stylesheet needs to know what a value is *for*, and two values of the
same density can have different jobs. `slate` is mass that does not speak;
`wash` is ink spread so thin that it reads as a surface rather than a mark.

⚠️ The last two are not equally safe. `slate` sits in the middle of the widest
gap and is far from its neighbours in both modes. `wash` is deliberately close to
`paper`, which is what makes it useful and what makes it fragile: in
black-and-white mode `paper` is solid and `wash` is a thirteen-percent dot
pattern, so a hairline at that value is a dotted line rather than a line. Use it
for areas, not for hairlines.

Alpha cannot express these. Black at 80% over a black background is still black,
so a translucent value has to be flattened to an opaque one before it means
anything.

Two kinds of colour rule live here and conflating them is how the theme this
replaced went stale:

- **Physics** — moving an off-grid value onto the grid, removing alpha,
  resolving a shadow. This should be computed at runtime by walking the actor
  tree and reading what each widget actually resolved to, not written against
  selector names that may not exist next release. The CSS here is a reference
  implementation that proves the values are right; `Palette()` reports 918
  resolved colours with nothing off the grid, no alpha and no chroma.
- **Design** — deliberately arranging things differently from upstream. That
  stays as CSS. The keyboard is the case: stock builds it from a black bed with
  keys at 114 and special keys at 93, twenty-one apart, which dithers into one
  texture. Ours is a `#aaa` bed, `#fff` keys, `#333` function keys — not the
  stock values moved closer to the grid, a different arrangement.

## The panel it taps

`extensions/pn-panel@cver.net`. It began inside the keyboard extension and was
carved out once it worked, because those two share no state: none of the panel
code reads the keyboard's config, and its install had been sitting inside an
`if` that tested whether the app grid had been found — an accident of where the
code was written rather than a dependency. Someone who wants a tone button
should not have to accept a rebuilt keyboard with it.

Three things get pressed on this tablet more than anything else: clear the
ghosting, turn the screen, change the tone. All three were already reachable and
all three were buried — the refresh behind a Pinenote Helper button, the rotation
about ten items down a status indicator's menu, the tone behind a panel label
reading `BW+D:1`. They are one tap each now, and they call the interfaces
themselves rather than borrowing the neighbour's buttons, which a package upgrade
puts back where it found them.

`BW+D:1` is the driver's vocabulary: bw_mode 1 is black-and-white with dithering,
and the 1 after the colon is the A2 waveform paired with it. Behind the label sat
four modes, a threshold slider, an invert toggle and a row of waveform numbers.
Two of those are readings a person actually chooses between:

| Mode | bw_mode | partial waveform | what it is for |
|---|---|---|---|
| Black and white | 1, dithered | A2 | text: crisp, and it never flashes |
| Greyscale | 0 | GC16 | pictures: sixteen tones, and it flashes |

One button, two states, the same shape as the rotation button beside it.

**The state belongs to Pinenote Helper, not to the driver.** Its `bw-mode`
gsetting is re-applied whenever that extension is enabled, so changing the driver
alone works until the next login and then silently reverts — which is what
happened here on 2026-08-06 and got written up as a race. Upstream's own menu
items write that key and leave the work to its `changed` handler, so this button
does the same: one write, one global refresh, and the mode survives a login. If
nothing has moved 400ms later — Pinenote Helper missing, disabled, or no longer
listening to that key — the button applies the change itself and says so in the
journal. Both branches have been made to fire; the second one by disabling the
extension and pressing the button.

**The icon is one file, and the panel draws its own state.** It borrows the
refresh button's frame outline exactly — both are things that act on the screen
itself, so the difference belongs inside the frame — and fills it with a real
grey ramp, `#555` to `#EEE`. In greyscale mode that is a smooth gradient. In
black-and-white mode the driver converts it, so the same file renders as a row of
dots thinning out from coarse to fine: the icon becomes a live sample of what
this mode does to grey. There is no second icon and no state to keep in sync,
because the hardware is a more accurate instrument here than anything that could
be drawn, and there are only two modes, so *the other one* is what pressing does.

Two consequences. The file must not be named `-symbolic`, or the recolouring pass
flattens the ramp to solid black. And a screenshot can never show the dots —
dithering happens in the driver, below the framebuffer that `Capture()` reads —
so this is one of the few things on this device that only the glass can verify.

An earlier attempt drew tone as four rising bars, which at 16px is the
signal-strength icon, and the Wi-Fi indicator is three icons away.

**A correction that this feature depended on.** The reasoning above was first
written as "this is a two-colour panel, so the icon cannot use grey" — copied out
of this repository's own extension description, which says the same, and used as
though it were a fact about the hardware. It is not. The framebuffer is 4bpp:
1872 × 1404 ÷ 2 = 1,314,144 bytes, exactly the size of the driver's off-screen
image, and GC16 means sixteen greys. This panel is the same class as a Kindle.
What is true is that the tablet spends nearly all of its time in a two-colour
*mode*, which is a choice made to stop the flashing — and it is that choice, not
a hardware limit, that makes a grey ramp turn into dots.

**Hiding a neighbour's button is not a one-time act.** Disabling and re-enabling
Pinenote Helper — which a package upgrade does — adds its indicators back as new
objects, and the ones hidden at startup no longer exist. The panel grows three
buttons back while this extension stays ACTIVE and logs nothing. The panel boxes
are watched for `child-added` and the list is applied again.

What went with the label is still reachable, just not from the top bar: the
toggles (auto-refresh, clear screen on suspend, dither invert) are gsettings keys
under `org.gnome.shell.extensions.pnhelper`, the waveform picker is
`SetDefaultWaveform` on `org.pinenote.ebc`, and the USB MTP gadget is
`org.pinenote.usb`. Both interfaces are on the system bus. None of them is a
daily decision.

## A rotation glitch we could not reproduce

The panel is native landscape and GNOME rotates it to portrait. Turning the
screen while a window was open produced this once: the window kept its landscape
width, ran off the right edge, and left a band of empty desktop below it.
Reopening the browser in portrait did not fix it. Restarting gnome-shell did.

That looked like a compositor bug and was written up as one. The evidence never
supported it. **Every measurement was taken on a window launched over SSH with a
hand-assembled environment (`setsid` plus four exported variables), not from the
dock.** That difference was present in both of the runs being compared, which
means there was no control. Launching normally and rotating does not reproduce
it.

One dead end worth recording so it is not repeated: `ls -l /proc/PID/fd | grep
wayland-0` cannot tell you which display protocol a process is using. Sockets
appear there as `socket:[inode]` with no path, so the check comes back empty
whether or not the process is on Wayland — and empty looks exactly like a
negative result. `pgrep Xwayland` answers the question; that grep never could.

If it happens again, capture these three *before* restarting the shell. Together
they separate the client from the compositor:

- `about:support` -> Window Protocol, for a browser window
- `gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig --method org.gnome.Mutter.DisplayConfig.GetCurrentState` -> the transform
- `pgrep Xwayland` -> whether an X11 path is involved at all

## Upstream

[PR #25](https://github.com/PNDeb/pinenote-gnome-extension/pull/25) uncomments
`_add_waveform_buttons()`, which is what puts A2 in Pinenote Helper's menu at all. It was
opened against a version where that call and the line pairing *BW+Dither* with A2 were both
commented out. The `1.8.dev` package installed here has both enabled already, so on this
device the change has arrived by another route and the patch has nothing left to do.

Nothing here patches Pinenote Helper. The waveform this workflow needs is chosen by the tone
button above, through the same D-Bus interface the extension itself calls.

## License

MIT — see [LICENSE](LICENSE).
