One CSS declaration kills gnome-shell. No JavaScript is involved, and it does not
have to come from an extension — a shell theme does it too.

```css
#panel .panel-button { margin-right: -10px; }
```

A negative margin is neither ignored nor clamped. It becomes a negative
allocation, and the background-painting path multiplies it into a ~4GB
allocation that fails, which is fatal.

## Steps to reproduce

Either of these, on GNOME 48:

**As a CSS-only extension.** `extension.js` with an empty `enable()` and
`disable()`, and the one declaration above in `stylesheet.css`. Enabling it kills
the shell about two seconds later.

**As a shell theme.** Append the same declaration to a theme's
`gnome-shell/gnome-shell.css` and select it with User Themes. Same result. This
is the wider surface of the two: it needs no extension of one's own, only a theme
someone downloaded.

## What is logged

```
gnome-shell[…]: ../clutter/clutter/clutter-actor.c:8863: Actor 'unnamed [StBoxLayout]' tried to allocate a size of -4.00 x 32.00
gnome-shell[…]: Failed to create offscreen effect framebuffer: Failed to create texture 2d due to size/format constraints
gnome-shell[…]: ../../../glib/gmem.c:139: failed to allocate 4294967232 bytes
systemd[…]: org.gnome.Shell@wayland.service: Main process exited, code=killed, status=5/TRAP
```

The offscreen-effect line is a second casualty of the same negative size, not a
step on the way to the abort — `update_fbo()` warns and returns `FALSE`, and it
allocates nothing. The fatal path is the one below.

## Backtrace

There are no debug symbols on this device and the kernel is built without
`CONFIG_COREDUMP`, so this is gdb attached to the live process, letting the
SIGTRAP arrive:

```
#5  g_malloc0 () from libglib-2.0.so.0
#6  ?? () from /usr/lib/gnome-shell/libst-16.so
#7  st_theme_node_paint () from /usr/lib/gnome-shell/libst-16.so
#8  st_widget_paint_background () from /usr/lib/gnome-shell/libst-16.so
#9  clutter_actor_continue_paint ()
```

## The arithmetic

`st_theme_node_prerender_background()` in `src/st/st-theme-node-drawing.c`
(around line 1430 on `gnome-48`):

```c
width  = paint_box.x2 - paint_box.x1;
height = paint_box.y2 - paint_box.y1;

texture_width  = ceilf (width * resource_scale);
texture_height = ceilf (height * resource_scale);

rowstride = cairo_format_stride_for_width (CAIRO_FORMAT_ARGB32, texture_width);
data = g_new0 (guchar, texture_height * rowstride);
```

`cairo_format_stride_for_width()` returns **−1** for a width it cannot serve, and
that return value is used without being checked. The multiplication then happens
in unsigned 32-bit, so the count is `2³² − texture_height` rather than a small
negative number, and `g_malloc0` is asked for very nearly 4GB.

## The arithmetic, confirmed by prediction rather than by reading

If that is the mechanism then the failed byte count depends on the panel's
**height** and not at all on the margin. Both halves were tested.

| what was changed | actor size logged | bytes requested |
|---|---|---|
| `margin-right: -10px` | −12.00 × 32.00 | 4294967232 |
| `margin-right: -10px` | −4.00 × 32.00 | 4294967232 |
| `margin-right: -200px` | −4.00 × 32.00 | 4294967232 |
| `#panel { height: 48px }` | −4.00 × 48.00 | 4294967200 |
| `#panel { height: 64px }` | −4.00 × 64.00 | 4294967168 |

The panel is on a scale-2 monitor, so 32, 48 and 64 logical pixels are 64, 96 and
128 device pixels, and 2³² minus those is 4294967232, 4294967200 and 4294967168 —
the three measured values, exactly. Two of those rows were written down as
predictions before the run.

Note also that the margin's magnitude does not reach the allocation at all:
−10px and −200px both produce −4.00, and both produce the same byte count.

## Controls

- **`margin-top: -10px`** — survives. The panel's height is fixed, so nothing
  goes negative. It is the horizontal axis that has no floor here.
- **Positive margins, and `-natural-hpadding` reduced to 2px** — fine. The second
  is what we shipped; it produces the layout the negative margin was reaching for.

## What happens afterwards

The session is lost. `org.gnome.Shell-disable-extensions.service` then sets
`disable-user-extensions true`, so the next session comes back with **every**
extension off — which is the right instinct, but on this tablet the disabled set
includes the extension that drives the e-ink display modes, so the device comes
back visibly degraded rather than merely plain.

With autologin, the crash lands on the greeter rather than on a new session:
`AutomaticLoginEnable` fires when GDM starts, not when a session ends. On a
tablet whose only keyboard belonged to the session that just died, that is the
difference between a bug and a locked door. `systemctl restart gdm3` from
another machine is what recovered it here.

## Searched first

- gnome-shell#7339, *A CSS-only extension causes gnome-shell to crash*, is a
  different failure: SIGSEGV in `st_theme_node_lookup_shadow()` with corrupted
  shadow values, triggered by Alt+L.
- Negative Clutter allocations are reported elsewhere as *warnings* with visual
  glitches — StScrollBar and StBoxLayout receiving negative widths from layout
  bugs. Those do not abort. What is different here is that the negative size
  reaches an allocation whose failure is fatal.

Nothing was found for a negative CSS margin specifically. If this is a duplicate,
it is one we could not find.

## Environment

- Pine64 PineNote, `pine64,pinenote-v1.2`, aarch64 — 10.3" e-ink tablet,
  touchscreen only, no pointer device, no physical keyboard
- Debian trixie, Wayland, scale 2
- GNOME Shell 48.7, mutter 48, libst-16
- Autologin enabled, which is what turns a crash into a locked-out device

## Related

The workaround is trivial once known: never go negative, reduce padding instead.
The cost is entirely in finding out, because the failure arrives as the whole
desktop disappearing rather than as a rule that did not apply.

Happy to test a patch. Notes and measurements from this device are at
https://github.com/CVERInc/pinenote (MIT).
