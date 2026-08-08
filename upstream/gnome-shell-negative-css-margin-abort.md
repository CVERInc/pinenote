A negative `margin` in an extension stylesheet does not fail to apply and does
not get clamped. It becomes a negative allocation, and gnome-shell aborts.

The session is lost. On a device with autologin this is worse than it sounds:
`AutomaticLoginEnable` fires when GDM starts, not when a session ends, so the
crash leaves the greeter asking for a password. This tablet has no physical
keyboard and its on-screen keyboard belongs to the session that just died.

## Steps to reproduce

1. Any GNOME extension that adds buttons to the panel. Ours adds three
   `PanelMenu.Button`s to the right box.
2. Put one declaration in the extension's `stylesheet.css`:

   ```css
   #panel .my-panel-button { margin-right: -10px; }
   ```

3. Enable the extension. It enables cleanly and logs nothing. gnome-shell aborts
   about two seconds later, during the first allocation cycle that includes those
   buttons.

## Output

```
gnome-shell[…]: ../clutter/clutter/clutter-actor.c:8863: Actor 'unnamed [StBoxLayout]' tried to allocate a size of -12.00 x 32.00
gnome-shell[…]: Failed to create offscreen effect framebuffer: Failed to create texture 2d due to size/format constraints
gnome-shell[…]: ../../../glib/gmem.c:139: failed to allocate 4294967232 bytes
gnome-shell[…]: == Stack trace for context 0x… ==
gnome-shell[…]: #0   … resource:///org/gnome/shell/ui/init.js:21 (… @ 48)
systemd[…]: org.gnome.Shell@wayland.service: Main process exited, code=killed, status=5/TRAP
```

4294967232 is 0xFFFFFFC0, which is −64 read as an unsigned 32-bit value.

## Controls

Same extension, same panel buttons, same session:

- **Positive `margin-right`** — fine. Used deliberately afterwards to restore an
  edge margin.
- **`-natural-hpadding` and `-minimum-hpadding` reduced to 2px** — fine. This is
  what we ended up shipping; it produces the layout the negative margin was
  reaching for.
- **`padding: 0` / `margin: 0` on the icons inside those buttons** — fine.

So it is the sign, not the property and not the selector.

## What is measured and what is a guess

Measured: the declaration, the three log lines, the abort, and that removing the
declaration makes it stable again.

Guessed: that the negative margin subtracts from a preferred width without a
floor, and that the offscreen-effect path then hands the resulting negative width
to a size calculation that treats it as unsigned. The 0xFFFFFFC0 in the failed
allocation is consistent with that, but the arithmetic between −12.00 and
4294967232 has not been traced.

Also worth pointing out rather than arguing: `clutter_actor_allocate` already
knows the size is wrong — it prints the actor and the exact negative dimensions —
and then continues into a path where the same number is fatal. Whatever the fix
is, the information needed to refuse is present one frame earlier.

## Not reduced further

This was hit while building a real extension, and it was reproduced by adding and
removing the one declaration. It has not been reduced to a minimal standalone
extension, and it has not been tried from a user theme's `gnome-shell.css` rather
than an extension stylesheet — which would be worth knowing, since that path
needs no extension at all.

## Searched first

- gnome-shell#7339, "A CSS-only extension causes gnome-shell to crash", is a
  different failure: SIGSEGV in `st_theme_node_lookup_shadow()` with corrupted
  shadow values, triggered by Alt+L.
- Negative Clutter allocations are reported elsewhere as *warnings* with visual
  glitches — StScrollBar and StBoxLayout receiving negative widths from layout
  bugs. Those do not abort. What appears to be new here is a negative size that
  originates in a stylesheet value and reaches an allocation that is fatal.

Nothing was found for a negative CSS margin specifically. If this is a duplicate,
it is one we could not find.

## Environment

- Pine64 PineNote, `pine64,pinenote-v1.2`, aarch64 — 10.3" e-ink tablet,
  touchscreen only, no pointer device, no physical keyboard
- Debian trixie, Wayland
- GNOME Shell 48.7, Mutter 48
- Autologin enabled, which is what turns a crash into a locked-out device

## Related

The workaround is trivial once you know: never go negative, reduce padding
instead. The cost is entirely in finding out, because the failure arrives as the
whole desktop disappearing rather than as a rule that did not apply.

Happy to test patches, and happy to reduce this to a minimal extension if that
would help. Notes and measurements from this device are at
https://github.com/CVERInc/pinenote (MIT).
