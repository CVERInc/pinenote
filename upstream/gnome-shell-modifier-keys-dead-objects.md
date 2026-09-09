`Keyboard._modifierKeys` keeps Key objects from the previous OSK layout across
a rebuild, and the next modifier toggle calls a GObject method on them.

`Keyboard._addRowKeys()` records every on-screen modifier key (Ctrl, Alt, Super,
...) in `this._modifierKeys`, keyed by keyval, so `_setModifierEnabled()` can
latch or unlatch all of them together. Nothing empties that map when the layout
is rebuilt. `_updateLayout()` destroys `this._currentLayout` — which owns every
`Key` actor created by the run of `_addRowKeys()` before it — and builds a new
one, but the entries `_addRowKeys()` pushed into `this._modifierKeys` from the
old run are never removed. The next `_updateLayout()` call appends the new
layout's Key objects to the *same* lists rather than replacing them, so the map
grows by one destroyed generation of Keys every rebuild, and the destroyed ones
are still in the list `_setModifierEnabled()` iterates.

A rebuild happens on every input-purpose change, group (layout) change, and
monitor change, so on a touch-only device where the OSK is shown and hidden
repeatedly this fires often.

## Steps to reproduce

On GNOME 48 with the on-screen keyboard forced on
(`org.gnome.desktop.a11y.applications screen-keyboard-enabled true`, or any
touch-only device where it comes up on focusing a text field):

1. Focus a text entry so the OSK appears, and latch a modifier (tap Ctrl).
2. Trigger a layout rebuild without dismissing the OSK — switching input
   layout/group (`gnome-control-center` → *Keyboard* → add a second layout and
   switch), or moving focus between fields with different input purposes
   (e.g. a normal text field to a numeric field), or changing monitors.
3. Latch or unlatch the modifier again (tap Ctrl a second time, on the newly
   rebuilt keyboard).

## Expected

The second latch toggles the modifier key(s) belonging to the current layout.

## Actual

`_setModifierEnabled()` iterates `this._modifierKeys[keyval]`, which still
holds the `Key`/`St.Button` objects from the layout destroyed in step 2, and
calls `.setLatched()` on each. Every rebuild leaves one more destroyed
generation in the list, so this is both a warning-per-toggle bug and a slow
leak of `Key` objects that are otherwise unreachable except through this map.

## What is logged

```
gnome-shell[…]: Object St.Button (0x…), has been already disposed — impossible
to set any property on it. This might be caused by the object having been
destroyed from C code using something such as destroy(), dispose(), or a
'remove' vfunc.
```

One such warning per stale `Key` per toggle. On a Pine64 PineNote (10.3" e-ink
tablet, touch-only, no physical keyboard, so the OSK is up for most of a
session) running GNOME Shell 48.7, a single session accumulated roughly 7000 of
these — consistent with frequent input-purpose/group rebuilds each adding
surviving stale entries that fire on every later toggle, not a one-off.

## The mechanism

`js/ui/keyboard.js`, class `Keyboard`. Quoting `gnome-48` (same on `main`,
line numbers below):

Constructor, line 1200:
```js
this._modifierKeys = new Map();
```

`_addRowKeys()`, lines 1557–1559:
```js
let modifierKeys = this._modifierKeys[key.keyval] || [];
modifierKeys.push(button);
this._modifierKeys[key.keyval] = modifierKeys;
```

`_setModifierEnabled()`, line 1580:
```js
for (const key of this._modifierKeys[keyval])
    key.setLatched(enabled);
```

Two separate things are true here:

- `this._modifierKeys` is never reset or pruned anywhere. `_updateLayout()`
  (called from `_updateKeys()`, on `purpose-changed`, group changes and
  monitor changes) destroys `this._currentLayout` and everything under it,
  including every `Key` built by the run of `_addRowKeys()` that just ran, but
  the references those `Key`s left in `this._modifierKeys` are untouched.
- Separately, `this._modifierKeys` is declared as a `Map` but used everywhere
  with `[]` property access rather than `.get()`/`.set()`. That still works —
  it stores plain properties on the `Map` object rather than `Map` entries —
  but it means the object carries no `Map` semantics (`.clear()`, `.get()`,
  iteration) despite being typed as one; a fix should either keep it a plain
  object consistently, or fix the accesses to use `Map` properly.

Confirmed unchanged on `main` as of 2026-09-09 (same three sites, at lines
1055, 1417–1419, 1440 there).

## Proposed fix

Either:

- Reset `this._modifierKeys` (as `{}`, or as `new Map()` with the accesses
  changed to `.get()`/`.set()`) at the top of `_updateLayout()`, before the
  `_addRowKeys()` calls that repopulate it, or
- Prune each keyval's list in `_updateLayout()`/`_updateKeys()` before or as
  part of destroying `this._currentLayout`.

A minimal patch doing the first (against `main`) is attached to this report,
matching the pattern used for gnome-shell#9397 — attached so it can be applied
without waiting on an MR.

## Searched first

- gnome-shell#9397 (filed from this device, still open) is the nearest prior
  report against this same file and class — a different bug: latched
  modifiers not reaching keyval-only keys (Tab, arrows, Enter…). Not this one.
- gnome-shell#6085 (closed) and gnome-shell#6114 (open, a follow-up of #6085)
  are OSK actors logging "has been already disposed" floods, from gnome-shell
  43 in 2022 — but the disposed objects there are `Gjs_ui_keyboard_Keyboard`,
  `AspectContainer` and `KeyContainer`, not `St.Button`, and neither mentions
  `_modifierKeys` or `setLatched`. Different objects, likely a different
  destroy-ordering bug in the same file; not a duplicate of this one as far as
  could be told from the two reports.
- Searched `modifierKeys`, `setLatched`, `St.Button disposed`, `latched
  modifier`, and "already disposed" + keyboard against the GitLab issue
  tracker (API search, title+description). Nothing else matched.

## Environment

- Pine64 PineNote, `pine64,pinenote-v1.2`, aarch64 — 10.3" e-ink tablet,
  touchscreen only, no pointer device, no physical keyboard, OSK effectively
  always in use
- Debian trixie, Wayland
- GNOME Shell 48.7

Not device-specific: the code path is unconditional, and any input-purpose,
layout-group, or monitor change reachable on any GNOME 48/main system rebuilds
the layout the same way. The PineNote's session-long OSK use is what turns a
rare cosmetic warning into ~7000 of them and a running Key-object leak.

## Related

Notes and measurements from this device are at
https://github.com/CVERInc/pinenote (MIT).
