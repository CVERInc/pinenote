#!/usr/bin/env python3
"""Print what an application actually receives from the keyboard.

The on-screen keyboard can only be pressed by a finger, and a finger cannot
report what arrived — "Shift+Tab works now" is otherwise a claim someone has to
stand next to the tablet to make. This is the other half of pn-osk's TapKey()
D-Bus method: TapKey presses, this prints, and the pair can be driven over SSH.

    keylog.py                 window with an entry, logs to stdout
    keylog.py --seconds 30    quit by itself

Each line is one event, as GTK sees it:

    press   keyval=ISO_Left_Tab (0xfe20)  keycode=23  state=SHIFT
    text    "hello"

keyval is the symbol the compositor resolved, which is not the symbol the
keyboard sent: a virtual Tab with Shift held resolves to ISO_Left_Tab, exactly
as a physical keyboard's does. That difference is the whole point of forwarding
a real modifier rather than sending the shifted keysym directly.
"""

import argparse
import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

MODS = [
    (Gdk.ModifierType.SHIFT_MASK, "SHIFT"),
    (Gdk.ModifierType.LOCK_MASK, "LOCK"),
    (Gdk.ModifierType.CONTROL_MASK, "CTRL"),
    (Gdk.ModifierType.ALT_MASK, "ALT"),
    (Gdk.ModifierType.SUPER_MASK, "SUPER"),
]


def state_names(state):
    names = [name for mask, name in MODS if state & mask]
    return "+".join(names) if names else "-"


def emit(kind, *parts):
    print(f"{kind:<8}" + "  ".join(parts), flush=True)


def on_key(kind):
    def handler(_controller, keyval, keycode, state):
        emit(kind,
             f"keyval={Gdk.keyval_name(keyval)} ({keyval:#x})",
             f"keycode={keycode}",
             f"state={state_names(state)}")
        return False
    return handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=0,
                    help="quit after this many seconds (0 = stay)")
    args = ap.parse_args()

    app = Gtk.Application(application_id="net.cver.keylog")

    def activate(_app):
        win = Gtk.ApplicationWindow(application=app, title="keylog")
        win.set_default_size(600, 200)

        entry = Gtk.Entry(hexpand=True, placeholder_text="type here")
        # The buffer is watched as well as the keys: a key that goes through the
        # input method commits text without ever arriving as a key event, and
        # the difference between those two routes is usually what is in doubt.
        entry.get_buffer().connect(
            "inserted-text",
            lambda _b, _pos, text, _len: emit("text", f'"{text}"'))
        entry.get_buffer().connect(
            "deleted-text",
            lambda _b, pos, end: emit("delete", f"{pos}..{end}"))

        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", on_key("press"))
        keys.connect("key-released", on_key("release"))
        # CAPTURE: read the event before the entry consumes it, so Tab still
        # shows up here instead of silently moving the focus.
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        win.add_controller(keys)

        win.set_child(entry)
        win.present()
        entry.grab_focus()

        if args.seconds:
            GLib.timeout_add_seconds(args.seconds, lambda: (app.quit(), False)[1])

    app.connect("activate", activate)
    return app.run([sys.argv[0]])


if __name__ == "__main__":
    sys.exit(main())
