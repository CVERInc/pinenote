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

The battery/power icon is a plainer subtraction — nothing here replaces what it
shows, CHOD just does not want it on the bar — and it does not live where the
rest of this file's hiding does. It is not its own `statusArea` role at all on
48: `Main.panel.statusArea.quickSettings._system`, a `SystemIndicator`
(`ui/status/system.js`) sitting inside Quick Settings' own `_indicators` box,
confirmed by reading that file on the device rather than assumed. Hiding it —
`hide.battery: true` in `pn-panel.json`, default `false` — hides only that
always-on icon and percentage label; the Power Off entry it also owns is a
separate object Quick Settings' own menu adds for itself and is never touched.

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

The same fact cuts the other way at teardown, not just at startup. The lock
screen pushes GNOME's `unlock-dialog` session mode, which disables every
extension that has not declared it — Pinenote Helper and this one both — and
whichever `disable()` runs first tears its own indicators down. `_pnHidePanelItems`
used to hold those indicators directly and ask them to `.container.show()`
again in `_pnRemovePanel`, which meant asking a corpse to move: GJS logs
`Object St.Bin … has been already disposed` straight from its C boundary the
moment a disposed GObject's property is read, before a `try`/`catch` around
the call gets a say — measured 2026-09-09, three of those in `journalctl -b -1`
back to back, one per hidden item, at the lock that triggered it. The fix
tracks each item's own `destroy` signal instead of reacting to a failed read
afterwards: a destroyed item drops itself off the restore list the moment it
happens, so the loop in `_pnRemovePanel` never touches one that is already
gone.

This extension does not declare `unlock-dialog` itself, on purpose. `pn-osk`
needs it — the on-screen keyboard is the only way to type the unlock password
on a device with no physical one — but nothing here is needed to unlock the
tablet, and two of its buttons are actively wrong to leave live on the lock
screen: voice dictation commits straight into whatever has focus, and the
long-press below injects a synthetic right-click into whatever has focus —
on the lock screen, that focus is the password field. Being disabled there
was already correct; the only bug was how loudly it happened.

What went with the label is still reachable, just not from the top bar: the
toggles (auto-refresh, clear screen on suspend, dither invert) are gsettings keys
under `org.gnome.shell.extensions.pnhelper`, the waveform picker is
`SetDefaultWaveform` on `org.pinenote.ebc`, and the USB MTP gadget is
`org.pinenote.usb`. Both interfaces are on the system bus. None of them is a
daily decision.

## The rotate button, made mostly optional

The sensor was wired all along. `iio:device0` (`3-0068`, an st_accel on I2C
bus 3) has been reporting through iio-sensor-proxy since first boot — the
rotate button beside tone and refresh just calls the same D-Bus interface
GNOME's own quick-settings orientation lock does. What kept it feeling like a
button-only feature was `orientation-lock` sitting `true`: gsettings' default,
never turned off, so the accelerometer was live and ignored and the button was
the only way to spin the screen.

Turning the lock off surfaces a second bug that had nothing to do with the
lock. `pinenote_sleep_on_cover_close.sh` suspends the device on every cover
close, and `st_accel_suspend`/`st_accel_resume` pair cleanly in `dmesg` each
time — the driver comes back fine. iio-sensor-proxy does not: `monitor-sensor`
as root reports `Failed to claim accelerometer: Timeout was reached` after the
first cover-close cycle, and orientation stops updating until something
restarts the service. `sudo systemctl restart iio-sensor-proxy` fixes it
immediately, which is what `iio-sensor-proxy-resume.service` now does for you
— a oneshot hung off `suspend.target`'s `Install`, so it fires on every resume
instead of waiting for someone to notice the tablet stopped turning. `pn
autorotate on` installs and enables it and drops the lock; `pn autorotate` on
its own reports whether the unit is enabled and what the lock is currently set
to.

With a sensor that can be trusted to keep working, the rotate button becomes
optional rather than load-bearing: GNOME's quick-settings menu already carries
the same lock toggle, one level down from where this button sits on the top
row. Nothing here removes the button — it stays the one-tap path — but it is
no longer covering for a sensor that could not be relied on to do its own job.

### Mutter never picks it up, so pn-panel drives it itself

Turning the lock off is not, on this device, enough on its own. With
`orientation-lock` false and iio-sensor-proxy alive, `AccelerometerOrientation`
does update as the tablet is turned — confirmed live, `normal` → `left-up`
tracked in real time — but Mutter's own panel-orientation policy never acts on
it: `DisplayConfig`'s `GetCurrentState` transform sits still regardless (the
monitor reports `is-builtin: true`, which is normally what that policy keys
off of). Whatever this build of Mutter wants before it will drive a built-in
panel from the sensor, it is not present here, and chasing it further looked
like guessing at Mutter internals rather than fixing anything pn-panel owns.

So pn-panel drives it instead, through the rotation it already has: while the
lock is off, it calls `ClaimAccelerometer` on `net.hadess.SensorProxy` (system
bus) and subscribes to that interface's `PropertiesChanged`, and on every
`AccelerometerOrientation` change it applies `PN_ORIENTATION_TRANSFORM[value]`
through the exact same call the sensor-resync path already used on the
unlock edge — one shared function, two triggers, not a second rotation
mechanism. A tilt through a diagonal fires one or more intermediate
orientations on the way to the one the tablet settles on, so applies are
debounced 600ms after the last change; a value that maps to the transform
already in effect is skipped rather than spending a round trip confirming
that.

The claim is watched, not fetched once: `iio-sensor-proxy-resume.service`
above restarts the daemon on every resume, which is a new process and drops
any outstanding claim and subscription with it. pn-panel watches the
`net.hadess.SensorProxy` bus name itself (`Gio.bus_watch_name`) and reclaims,
resubscribes, and resyncs to the current value on every name-appeared edge —
including the very first one at startup or unlock, whether or not the name
was already owned.

Lock semantics are unchanged. Locking — the panel button (which locks first,
then rotates, so the sensor cannot immediately spin it back) or Quick
Settings' Auto Rotate toggle — stops this tracking and releases the claim;
clearing the lock resumes it. `disable()` releases and unsubscribes the same
way. Nothing here changes what locking means, only what unlocked now
actually does.

## Two fingers, tap for undo, hold for redo

`cyttsp5` declares `ABS_MT_SLOT` 0..31 in `/proc/bus/input/devices` — a
32-slot protocol, not a claim about how many fingers it resolves. Measured
with `evtest` and `libinput debug-events` straight off `/dev/input/event5`,
below Mutter and libinput both: a real three-finger touch never shows more
than two slots active at once. One attempt produced three distinct
`ABS_MT_TRACKING_ID`s (622, 623, 624), but the second released the instant
the third landed, same `SYN_REPORT` frame:

```
697.717717  slot0=622 slot1=623 (down together)
697.828285  slot2=624 down, slot1=-1 up  -- same frame
697.837536  slot0=-1 up
```

A second attempt, held for a second, never produced a third tracking ID at
all. `libinput`'s `TOUCH_DOWN`/`TOUCH_UP` lines matched frame for frame. A
third finger steals one of the two live slots or is never reported, at the
kernel, before Mutter or this file sees anything — not fixable in software
here, so the gesture stays two fingers throughout, told apart by hold time.

A chord is read on `global.stage`'s `captured-event`, capture phase, always
returning `Clutter.EVENT_PROPAGATE` since the app under the finger —
Xournal++, a text field — still needs its own copy to draw or scroll. A
group resolves when the last finger lifts, and only if: peak concurrent
contacts was exactly `gestures.fingers` (default 2); every contact drifted
under 24px (a pinch drifts far more, differently per finger); and every
finger arrived within 120ms of the first. Duration then picks the chord:
under 300ms fires `gestures.undo` (`"tap"`, Ctrl+Z), 500ms or more fires
`gestures.redo` (`"hold"`, Ctrl+Shift+Z — GTK's convention, not Word's
`Ctrl+Y`). 300–500ms fires nothing, on purpose: guessing a borderline hold
is how a slightly-late tap starts an unwanted redo. Skipped while the
overview is open, any modal has a grab, or the touch began over the
on-screen keyboard's own box, whose two-finger use must not undo its typing.

Two traps met building this. Sequences must be keyed by
`event.get_event_sequence().get_slot()`, not the sequence object itself — a
GJS boxed wrapper for the same touch need not be the same JS object next
callback, so a Map keyed by `===` silently stopped matching a finger's
UPDATE/END to its own BEGIN, and peak came out one finger short on every
real hand while a synthetic tap (no UPDATE to lose) still passed;
`pn-osk`'s keyboard.js keys the same way for the same reason. Second, the
chord goes to `global.display.focus_window`, not necessarily the window a
person is looking at — a tap that fires and changes nothing is a focus
question, not a gesture one, and the trace line now names that window.

Measured in three layers: a synthetic uinput touchscreen (`python3-evdev`,
`INPUT_PROP_DIRECT`) to drive taps without a hand, a GTK4 window logging
every key it received to confirm the chord's shape, and
`evtest`/`libinput debug-events` to read the finger count below the
compositor once the shell's own count looked wrong.

## One finger, hold for a menu

Every app on this device already draws its own right-click context menu —
GTK, VTE terminals, Firefox, Chromium, Xournal++ — and every one of those
menus already has Copy and Paste in it. A press-and-hold that becomes a
right-click reaches all of them without a line of per-app code: the same
"hold for a menu" a finger already gets on iOS, aimed at a button GTK built
decades ago.

`gestures.longPress: {enabled: true, ms: 600, drift: 24}` in `pn-panel.json`.
One finger, on purpose — the two-finger chord above already owns undo/redo,
and a hold is exactly how that chord starts, so the two must never read the
same contact. They don't: long-press only arms on a fresh group's first
finger, and a second finger joining before `ms` disarms it immediately, well
before `GESTURE_MAX_LEAD` (120ms) would have accepted that same finger into a
chord.

Unlike the chord, which waits for every finger to lift and then classifies
the whole group afterwards, this has to fire *while the finger is still
down* — that is the entire difference between "hold for a menu" and "let go
for a menu". So it is a `GLib.timeout_add` armed on `TOUCH_BEGIN`, not a
verdict computed on `TOUCH_END`, disarmed by whichever comes first: a second
finger, this finger moving past `drift` px, this finger lifting before the
timer fires, or the group going stale. If none of those happen by `ms`, it
fires once, at the position the finger was last seen, and marks the group so
its own eventual `TOUCH_END` — read afterwards by the chord's own evaluator —
does not print as a confusing "rejected" line next to the "fired" one; that
evaluator was already going to reject a peak of one finger on its own, this
only keeps the trace readable.

Firing means a Clutter virtual `POINTER` device
(`Clutter.InputDeviceType.POINTER_DEVICE`, created once in `enable()` next to
the virtual keyboard the chord already uses, dropped in `disable()`):
`notify_absolute_motion` to move the pointer under the finger first — a touch
never moves the system pointer on its own — then
`notify_button(Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED)` and
`RELEASED`. Same shape as the chord's synthetic key pair, one layer down;
signatures confirmed against GNOME Shell 48.7's own `Clutter-16.typelib` on
the device rather than assumed.

Excluded the same way the chord is: overview, any modal, the on-screen
keyboard's own box (checked at the moment it fires, not the moment it
armed). One exclusion this gesture alone needs, and it took a wrong turn to
find: it first gated on `device.get_device_type() ===
Clutter.InputDeviceType.TOUCHSCREEN_DEVICE`, which is wrong on this
device's Wayland stack — Mutter reports every real finger touch here
through a device named "Virtual pointer device for seat", not a
touchscreen, so that gate rejected every genuine long-press
(`reason=not-touchscreen`, never once `fired`) while doing nothing to stop
a pen, which never reaches here anyway. The real gate is the event type —
`TOUCH_BEGIN`/`TOUCH_UPDATE`/`TOUCH_END`/`TOUCH_CANCEL`, the same test the
two-finger tracker above already uses and has never mistaken a pen for a
finger on — plus `get_device_tool()` for the pen, belt and braces: a pen
already carries a barrel button for a right-click, and carries a non-null
tool even on the rare event that arrives touch-typed, which a finger never
does — giving it a second right-click from a hold would fight the one it
already has.

Touch is always propagated, same as the chord: whatever app is under the
finger still needs to draw the press itself, and the right-click that
follows a beat later goes to whatever ends up with focus, which is usually
the same widget.

**The conflict we expected, and what the glass showed.** Firefox and
Chromium implement their own touch long-press handling, so the fear was a
hold over a page producing both their behaviour and this synthesized
right-click, uncoordinated: a double menu or a stuck selection. On this
device, in Firefox ESR on the first day, it did not happen: a hold over
page text raised one context menu, Firefox's own, with Copy in it. Chromium
has not been tried. `gestures.longPress.enabled` stays as the switch in
case another engine does fight it. For copying out of a browser the pinned
keyboard (`docs/keyboard.md`, "Summon and dismiss") is still the shorter
road, since Ctrl then C works whether or not a menu appears.
