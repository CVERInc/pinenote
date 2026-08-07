On a touch-only tablet, tapping the **already-selected** filename in a save
dialog does not raise the on-screen keyboard. Tapping the empty part of the same
entry raises it immediately.

The selected region is exactly the text you are there to replace, so the natural
gesture is the one that fails.

This device has no physical keyboard and no pointer, so the on-screen keyboard is
the only way to type at all.

## Steps to reproduce

1. Touch-only Wayland session, GNOME 48, on-screen keyboard enabled.
2. In GNOME Web, long-press an image and choose to save it. The file chooser
   opens with the filename pre-selected (`something.png`, base name highlighted).
3. **Tap on the highlighted text.** The entry already looks focused. No keyboard.
   Repeated taps in the same place do not help — it took four before one landed
   outside the selection and the keyboard appeared.
4. **Tap the empty area of the same entry, past the end of the text.** The
   keyboard appears immediately, first time, every time.

## Control: a non-GTK entry in the same session

The folder-rename entry in the GNOME Shell app grid also pre-selects its text.
Tapping directly on that selection **does** raise the keyboard. Same session,
same finger, same shell, same on-screen keyboard — so whatever consumes the touch
appears to be on the GTK side rather than in the shell's decision to show the
keyboard.

## What I think is happening

A touch that begins inside an existing selection is presumably being treated as
the start of a selection-drag rather than as a request to place the caret, so
whatever normally announces "text input is starting here" is not reached. That is
a guess about the mechanism; the reproduction above is not.

## Environment

- Pine64 PineNote, `pine64,pinenote-v1.2`, aarch64 — 10.3" e-ink tablet,
  touchscreen only, no pointer device, no physical keyboard
- Debian trixie, Wayland
- GTK 4.18.6, GTK 3.24.43
- GNOME Shell 48.7, Nautilus 48.3, xdg-desktop-portal-gnome 47.2, Epiphany 47.2
- The dialog is the portal's file chooser (`xdg-desktop-portal-gnome` activates
  Nautilus to draw it), so this is not specific to the calling application

## Related

#4795 reported "GTK4 entries do not trigger on-screen keyboard" in 2022 and was
closed as *Needs Information*. This may be the same underlying problem with a
reproduction attached — I have not been able to confirm that, since that report
does not say where in the entry the tap landed.

## One observation, offered as context rather than as a request

The keyboard here is raised in response to a *gesture* being recognised on a text
field. Any list of qualifying gestures has gaps in it, and this appears to be one
of them; fixing this particular gesture would not remove the next one. Touch
platforms that raise the keyboard on *focus* rather than on a gesture do not have
this class of gap, because focus has only one form.

I mention it only because the label on #4795 was *Accessibility*, and on a device
with no physical keyboard the on-screen keyboard is not an assistive overlay —
it is the keyboard. I am not asking for a redesign; the reproduction above stands
on its own.

Happy to test patches. Notes and measurements from this device are at
https://github.com/CVERInc/pinenote (MIT).
