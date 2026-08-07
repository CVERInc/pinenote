# App names in the grid cannot be read in full on a touch-only device

**Component:** gnome-shell — app display
**Version:** 48.7 (Debian trixie, aarch64)
**Hardware:** Pine64 PineNote — 10.3" e-ink tablet, touchscreen only, no pointer
device and no physical keyboard attached

## Summary

An app name that does not fit its tile is ellipsized. `AppIcon` can show the full
name — it switches the label to `line_wrap: true, ellipsize: NONE` — but every
path that triggers that switch requires either a pointer or keyboard focus. On a
device with neither, there is no gesture that reveals the rest of the name.

## What happens

In `js/ui/appDisplay.js`, `AppIcon._updateMultiline()` expands the label:

```js
const expand = this._forcedHighlight || this.hover || this.has_key_focus();
clutterText.set({
    line_wrap: expand,
    line_wrap_mode: expand ? Pango.WrapMode.WORD_CHAR : Pango.WrapMode.NONE,
    ellipsize: expand ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END,
});
```

It is called from three places:

- `_onHover()`, connected to `notify::hover`
- `vfunc_key_focus_in()`
- `vfunc_key_focus_out()`

On a touchscreen there is no hover state, and with no keyboard there is no way to
move key focus onto an icon. Tapping launches the app; pressing and holding opens
the context menu. Neither expands the label.

## Reproducing without the hardware

Any GNOME session driven by touch only. On a desktop it can be approximated by
installing an app with a name longer than the tile and confirming that the label
only expands on pointer hover or with the arrow keys — those two are the entire
set.

Names on a stock Debian install that ellipsize on this panel include
`Document Scanner`, `Byobu Terminal`, `Midnight Commander` and
`ImageMagick (color depth=q16)`.

## Why it matters here

This is the app grid on a tablet: it is the only place the device names its apps.
Four of the twenty-six apps on a stock install were unreadable, and two of them
were distinguishable only by their first seven characters.

## Possible directions

Listed in the order we would rank them, though the project will have context we
do not:

1. **Expand while the icon is pressed.** `AppIcon` already has
   `setForcedHighlight()`, which sets `_forcedHighlight` and drives the same
   expression. A press-and-hold that is not yet a long-press could set it, giving
   touch the same affordance the pointer has.
2. **Wrap when the name does not fit, rather than only on demand.** Two lines
   costs vertical space in the cell, so this is a layout decision rather than a
   local fix, but it removes the need for an affordance at all.
3. **Treat it as a touch-input gap generally.** The same shape may exist wherever
   `notify::hover` is the only trigger for revealing content.

We are not attached to any of these — the report is the reproducible part.

## What we did locally

For our own device we force the wrap permanently and give the label a fixed width
and a two-line height, so it wraps inside the cell instead of overflowing. That is
a device-specific choice: it costs vertical space, which we could afford only
after reworking the grid for a square panel. It is not offered as a patch.

Our notes and measurements are at https://github.com/CVERInc/pinenote (MIT), in
case any of it is useful.
