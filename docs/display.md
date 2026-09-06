# The clear you do not see

Part of [pinenote](../README.md).

A full clear on e-paper is a black-and-white flash: every pixel is driven to one rail and then
the other, including the ones that did not change, because the point is to reset the particles
rather than to redraw the image. It works, and on this panel it takes about a second.

`extensions/pn-wave@cver.net` does the same work in a different order. Instead of sending the
whole screen to black and then the whole screen to white, it lays down an ordered dither — half
the pixels black, half white — holds it, and then swaps to the exact complement:

```
frame 1   Bayer 8x8 at 50%, held 700 ms
frame 2   its complement,   held 700 ms
```

Every pixel still goes to both rails under GC16. Pixel for pixel it is the same treatment the
stock flash gives. What changes is that the mean luminance of the screen never moves: it sits at
mid grey for the whole 1.4 seconds. The discomfort of a flash comes from the entire visual field
changing brightness at once, not from the clearing itself, and those two turn out to be
separable. In use you stop noticing the clear happens at all — 32 of them fired in one evening
here without the owner spotting one.

`setup/idle-refresh.sh` calls it 8 seconds after you stop touching the screen. If the extension
is not loaded the daemon says so in the journal and falls back to `TriggerGlobalRefresh`,
because the one thing this daemon must never do is quietly clear nothing.

## Hold each frame long enough or it stains

GC16 is a DC-balanced pulse train. Interrupt it with a new target before it finishes and the
residual charge stays on the pixel, which settles a few levels off. On this panel a black/white
swing needs more than 500 ms; 700–900 ms is safe.

That single fact explains every failed attempt that came before this one. Frames held for 220 ms
or 500 ms left banding, and the banding always looked like a bug in whatever animation was being
tried — wrong geometry, wrong dither, wrong stagger — because the parts of the screen that were
truncated depended on how the work happened to land in frames. Four different theories, one
cause. If an animated clear on this hardware leaves marks, suspect the hold time before
suspecting the drawing.

## The sweep that did not win

`Sweep()` is still in the extension: it divides the screen into bands and runs a complete
black/white/black/white clear in each one, staggered so the boundary travels across the display.
It is closer to what a Kindle does, and it looks good.

It is also slow, and slowness is not neutral. A band cannot start until the previous frame has
finished, so a sweep costs `bands + stages − 1` frames — 6 frames for a coarse one, 20 for a fine
one, which is 5 to 12 seconds. Filmed at 240 fps, a Paperwhite's page-turn wipe takes 0.167 s and
resolves in roughly 40 slices; this panel manages one full swing in 450–700 ms. There is no
parameter that closes that gap, and a clear slow enough to watch reads as weak hardware rather
than as a considered animation.

So the sweep stays available and is not the default:

```sh
gdbus call --session --dest net.cver.PnWave --object-path /net/cver/PnWave \
  --method net.cver.PnWave.Sweep "{'bands': <int32 5>, 'cycles': <int32 1>, 'stepMs': <int32 900>}"
```

## auto_refresh has to be off, and pnhelper owns it

The kernel can clear on its own: `auto_refresh` counts the area repainted and fires once it
reaches `refresh_threshold` screenfuls. That path produces the stock flash, from inside the
driver, where its appearance cannot be changed — so it has to be off for any of this to be
visible.

Turning it off in `/etc/modprobe.d` is not enough. `pnhelper` keeps its own copy of the setting
and writes it back to the driver every time the shell starts, so a value set only in sysfs
survives until the next `restart gdm3` and no longer. `setup.sh` sets the gsetting that actually
owns it.

The cost of that is real and worth stating: with the kernel's area counter off, nothing clears
during continuous scrolling — the idle daemon needs you to stop for 8 seconds. Reading with
natural pauses never notices. A long uninterrupted scroll will accumulate.

# The six values it draws with

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
  resolving a shadow. This is computed at runtime rather than written against
  selector names that may not exist next release: a `Shell.GLSLEffect` on the
  panel, the modal group and the overview takes each fragment's luminance,
  inverts it, and snaps it to the six values. It is applied at `enable()`, not
  behind a switch. There is no moment when rendering a colour this panel cannot
  show is the right answer, and a switch would mean every value had to look
  right under two polarities — which is the exact mechanism that made the
  previous theme's values rot.
- **Design** — deliberately arranging things differently from upstream. That
  stays as CSS. The keyboard is the case: stock builds it from a black bed with
  keys at 114 and special keys at 93, twenty-one apart, which dithers into one
  texture. Ours is a `#aaa` bed, `#fff` keys, `#333` function keys — not the
  stock values moved closer to the grid, a different arrangement.

The CSS used to carry a reference implementation of the first kind, value by
value, as a way of proving the six were right. Once the shader existed that
became a second, staler answer to a question already answered, so it was
deleted. What the app grid keeps is three arrangements and no colours at all:
the dock is removed, the page arrows are lifted out of the gutters, and app
names wrap to two lines. Everything else — label colours, the folder plate,
the scrollbar handle, the search hint, the dialog — is upstream's, seen
through the shader.

Moving something can carry it out of the shader's reach without meaning to.
The page arrows are lifted into the chrome layer, which sits outside
`overviewGroup`, so for a while they were the one thing whose colour we still
had to decide — not because we wanted to, but because we had moved them past
the physics. The fix is to hand the effect to them individually rather than to
paint them; upstream gives them no ground outside the folder dialog, so they
come out as a bare chevron.

That leaves a useful property: the only colours still written in the
stylesheet are the keyboard's, and the keyboard has a layer of its own that
the shader never touches. Every value in the file means what it says. Nothing
is written in pre-inversion coordinates waiting to be misread.

Measured on the app grid afterwards: the whole screen resolves to those six
values and nothing else, bar 0.2% of pixels in the panel band that are still
unexplained. Upstream's folder tile arrives as a `wash` plate with a `slate`
hairline on `paper` — three values, none of them ours.

# A rotation glitch we could not reproduce

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

# The five frames a second nobody mentioned

`rockchip_ebc`'s `dclk_select` module parameter picks between the two DRM modes this panel
actually offers: `1872x1404@5.000` (0, "quality") and `1872x1404@80.000` (1, "performance").
pnhelper's `PerformanceModeButton` owns it — the D-Bus call, the Mutter mode change, all of it —
and its own source says of quality mode: it "is not intended for writing."

Measured 2026-09-06: quality mode was the live default, unremarked, the whole time — nobody had
pressed pnhelper's `Q`/`N` button (hidden on this panel, see `PN_HIDDEN_PANEL_ROLES`) and
`dclk_select` had simply never moved. With the owner's pen: 5 Hz + GC16 (the tone button's grey)
drew broken strokes. GC16 is a ~450 ms DC-balanced pulse train; a stroke's damage rects arrive
every ~12 ms while writing, so each new rect interrupts the last pulse before it settles. 80 Hz +
mono (bw_mode 1, waveform 1/A2 — the tone button's mono) drew the same pen fast *and* solid; A2
carries no such pulse-train constraint.

So the tone button now carries the mode: mono asks pnhelper for performance, grey asks it back to
quality — done by flipping pnhelper's own `quality-mode` gsetting (see `PN_TONE_SETS_MODE` in
`extensions/pn-panel@cver.net/extension.js`), never `SetDclkSelect` or Mutter directly, so
pnhelper stays the one owner of both. Order matters and is enforced there: tone first, mode
second, so pnhelper's own refresh (about a second later) lands on the tone already in place.

⚠️ Measured, not designed: pnhelper's `changed::quality-mode` handler does not read the boolean
it is handed — it reads `dclk_select` back off the driver and flips whatever that says,
unconditionally. Two clean toggles in a row landed correctly here because each started from the
state the last one actually left; a write that does not change the gsetting's stored value fires
no `changed` signal at all (GSettings drops no-op writes), silently skipping the mode switch that
tap was supposed to cause. Not our code to fix — pnhelper stays the owner — but worth knowing
before trusting a single toggle's result on faith.

`EnterWritingMode()` changes `default_waveform` 4→1 and `split_area_limit` 12→8. `dclk_select` is
untouched by it — measured across the transition, all three parameters read before and after.
Writing mode and the 5/80 Hz mode are two independent switches on this device; nothing upstream
ties them together, which is the whole reason the tone button had to do it instead.

### What the pen actually waits for

Measured with an iPhone at 240 fps from a low side angle, so the tip and the
leading end of the ink are both in frame, drawing fast vertical lines in the mono
tone at 80 Hz. The number is the distance from the tip to the end of the ink,
divided by the tip's speed, read off consecutive frames — three strokes each
time. The 8× slow-motion factor is Apple's standard and is assumed; neither clip
showed a normal-speed segment to calibrate against.

| | frames | latency |
|---|---|---|
| Xournal++ as installed (stabilizer: averaging, 20-point buffer) | 16–26 | **68–108 ms**, mean ≈ 89 |
| stabilizer off (`stabilizerAveragingMethod` 0, `stabilizerPreprocessor` 0) | 5–6 | **20–24 ms**, mean ≈ 22 |

The second row is a different quantity, and honestly so: with the stabilizer off
the tip had finished and lifted before any ink showed, so what remains is the
panel's own reveal time after the input pipeline is done. That is the point.
Two-thirds of the delay was Xournal++ waiting to have twenty points before it
drew the first; the compositor, the driver and the waveform together are a
fifth of it. reMarkable quotes 21 ms for its purpose-built pen path, so on this
device the stock desktop stack, with one preference changed, lands in the same
neighbourhood — the mode switch and the tone carry the rest.

In every clip the ink arrives as a dot, then a string of dashes, then a line:
each 12.5 ms damage rectangle is refreshed on its own and the gaps fill in
afterwards. That is what an 80 Hz compositor looks like on a panel that
answers one rectangle at a time.

The stabilizer is not a setting this repo changes for you — it is a drawing
preference, and lines drawn without it are as steady as the hand. Clip Studio
puts the strength under the artist's thumb; Procreate smooths only while the
pen is held down and let go quickly, so a fast stroke costs nothing. Xournal++
offers the first shape without a scale. If the trade is ever worth taking here,
it is the second shape that should be built.
