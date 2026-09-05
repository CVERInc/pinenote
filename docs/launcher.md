# The launcher it opens

Part of [pinenote](../README.md).

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

## Why the arrows took six attempts

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

## Reloading an extension on GNOME 48 Wayland

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

**It occasionally lands on the greeter anyway.** Once in a dozen or so restarts
the old session's PAM worker does not exit within GDM's five-second grace:

```
gdm-session-worker [pam/gdm-autologin] isn't dying after 5 seconds, now ignoring it
pam_unix(gdm-autologin:session): session opened      ← the new one
pam_unix(gdm-autologin:session): session closed      ← the old one, only now
GdmDisplay: Session never registered, failing        ← and the new one goes with it
```

That is GDM's race, not anything in this repository — the extensions had
finished tearing down two seconds earlier — but it is not rare here: session
teardown on this SoC takes longer than five seconds often enough that two
consecutive restarts landed on the greeter. `pn reload` does not bet on the
grace. It terminates the seat0 session first, waits for it to be gone, and only
then restarts gdm3, so there is nothing left to race with; a `systemd-run` guard
twenty-five seconds out restarts again if seat0 still has no user session. The
last dozen reloads came back in five seconds each.
