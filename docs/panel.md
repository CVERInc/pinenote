# The panel it taps

Part of [pinenote](../README.md).

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

A fourth arrived with the input methods: `pn-input`, which shows `US` / `TW` /
`JP` and cycles on a tap. It is the only one of the four that draws a word rather
than an icon, for the same reason the caps key spells `caps locked` — on a
two-colour panel with no animation, words are the signal that survives, and three
states cannot be drawn as "what pressing it will do". Its total width is 26px,
matching the three measured from the screenshot: two capitals need less padding
than a 16px icon, so the padding comes in and the group stays even.

GNOME's own input-source indicator is hidden with it. That one is a separate
`statusArea` item on 48 rather than something folded into Quick Settings — dumped
with `PanelInfo()` rather than assumed — and unlike the `BW+D:1` label above, this
is a case where hiding is honest: showing the current source and letting you pick
another is all it does, and `pn-input` does both.

`BW+D:1` is the driver's vocabulary: bw_mode 1 is black-and-white with dithering,
and the 1 after the colon is the A2 waveform paired with it. Behind the label sat
four modes, a threshold slider, an invert toggle and a row of waveform numbers.
Two of those are readings a person actually chooses between:

| Mode | bw_mode | partial waveform | what it is for |
|---|---|---|---|
| Black and white | 1, dithered | A2 | text: crisp, and it never flashes |
| Greyscale | 0 | GC16 | pictures: sixteen tones, and it flashes |

One button, two states, the same shape as the rotation button beside it.

**If the ink looks faint, you are in greyscale.** Drawing in Xournal++ with
greyscale selected puts down strokes that barely show, and pressing refresh
reveals a line that was dark all along. The line was always there; it had not
been driven all the way to black. Greyscale pairs with GC16, a DC-balanced pulse
train that needs something like 450ms to finish, and a moving pen issues a new
partial update every few tens of milliseconds — so each stroke interrupts the
one before it and the pigment stops partway. A refresh runs uninterrupted and
the stroke arrives.

The symptom reads like pressure sensitivity failing or a setting inside
Xournal++, which is what makes it worth writing down: it is neither, and the fix
is the tone button. Black-and-white pairs with A2, which is a fast one-bit
waveform and exactly what every e-ink device means by handwriting mode. Ink
keeps up with the pen there.

Between them sits DU, full-swing but far quicker than GC16, which makes greyscale
usable for writing without leaving it:

```sh
gdbus call --system --dest org.pinenote.ebc --object-path /ebc \
  --method org.pinenote.ebc.SetDefaultWaveform 2      # 4 puts GC16 back
```

Deliberately a command rather than a wiring change. Upstream hardcodes greyscale
to GC16 with no setting for it, so making the pairing stick would mean watching
`WaveformChanged` and writing the value back after upstream sets it — a third
writer on a value that has already produced two races here. The button already
reaches the better answer for drawing, and one press is cheaper than that.

**Which one this device starts in, said out loud.** `setup.sh` writes the
`bw-mode` gsetting on a first run and never again, defaulting to greyscale;
`PINENOTE_TONE=bw` picks the other. The value it wrote before this was upstream
Pinenote Helper's own schema default, which happens to be 0 — so the device had
been in greyscale for weeks by inheritance rather than by choice, and an upstream
change to that default would have moved it with nothing in the repository
mentioning either state. A marker file makes the write happen once: the panel
button is the way to change tone afterwards, and re-running setup should not
undo a choice made with it. The `auto-refresh` write above it carries no marker
on purpose — that one is correctness rather than taste, since the kernel's own
refresh path produces the stock flash and nothing here can restyle it.

`/etc/modprobe.d/rockchip_ebc.conf` no longer sets `bw_mode` or
`default_waveform` for the same reason `typing-mode.sh` stopped: two writers for
one value is a race, and this one was visible. The module loaded at 1, Pinenote
Helper applied 0 at login, and the clearing daemon logged the mode changing
under it five times in the first ninety seconds of every boot. One owner, no
flapping.

**What follows from the choice.** Greyscale pairs with GC16, which is a full
reset waveform, so every screen update clears as it draws and ghosting never
accumulates. The dither clear in `pn-wave` is therefore skipped entirely — the
daemon reads `bw_mode` each second and stands down, saying so once in the
journal. On a greyscale device `Clear()` firing zero times per boot is the
design working, not the daemon being broken. Black-and-white is the mode that
needs it: A2 is fast and quiet and accumulates, which is what the whole clearing
half of this repository exists for.

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
