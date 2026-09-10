# Lock at login

Part of [pinenote](../README.md).

## Why nothing ever locked

PNDeb ships two things that combine to mean the session never locks on its own:
`AutomaticLoginEnable` in gdm3 (see [`docs/launcher.md`](launcher.md) for what that autologin
costs a reload), and `org.gnome.desktop.lockdown disable-lock-screen` set `true` — a lockdown
key, not a screensaver setting, so it overrides idle timeout, suspend, and the cover switch
alike. With it set, nothing on this device ever asked for a password: booting dropped you
straight into the desktop, and closing the cover only suspended it.

## What we set

```
org.gnome.desktop.lockdown disable-lock-screen false     # the key that blocked all of the above
org.gnome.desktop.screensaver lock-enabled true           # lock, once the screensaver activates
org.gnome.desktop.session idle-delay 0                    # never: see "The idle lock that reset the tablet"
```

`idle-delay` stays at the `0` that `setup/setup.sh` chose (it also keeps GNOME's idle timer
from fighting `pn-idle-refresh`, see [`docs/setup.md`](setup.md)). So the lock fires at login,
on suspend (which is what the cover does), and from the power button, never from idleness.
`pn lock off` restores `disable-lock-screen` to `true` and removes the autostart entry
below; it does not touch `lock-enabled`, which has nothing to do once the lockdown key is
back.

### The idle lock that reset the tablet

The first day this lock existed, `idle-delay` was 600, and the PineNote hard-reset twice:
once at 16:03 when gdm was restarted while the shield was up, and once at 21:48 when the
tablet was woken after ten idle minutes had locked it and blanked the panel. Both times the
journal ends without a shutdown sequence and the kernel logs nothing after
`rockchip_ebc_ctx_release`, the driver letting go of the display. The three locks that were
walked through many times that day without incident all share one thing: the panel was never
blanked and re-lit through the shield. Until that path is understood, the lock does not come
from idleness, and `pn reload` is done with the screen unlocked.

A fourth reset the next day did not involve the lock at all: the cover closed at
12:56, the kernel logged `PM: suspend entry (deep)`, and the next line in the
journal is a fresh boot at 14:56. Two hours of deep suspend ended in a reboot
rather than a resume. It is listed here so the ledger of unexplained resets stays
in one place, not because the lock had a hand in it.

## The cover magnet

Closing the cover does not go through GNOME's lid handling at all: `gpio-keys` reports this
switch as `SW_MACHINE_COVER` (0x10), not `SW_LID`, and `logind`'s `HandleLidSwitch*` settings
only ever look at `SW_LID` — a dead end covered in `setup/setup.sh`'s "tried and abandoned"
notes. What actually suspends the device on cover close is PNDeb's own
`/usr/bin/pinenote_sleep_on_cover_close.sh`, which asks `logind` to suspend directly. That part
was already working; what was missing was anything to show *after* the resume. With
`disable-lock-screen` cleared, resuming from that suspend now presents the lock screen —
closing the cover locks the device, which it never did before.

## Autostart, not disabling autologin

The alternative was turning `AutomaticLoginEnable` off and making GDM's own greeter the thing
you authenticate against at boot. We didn't: the greeter's own on-screen keyboard has never
been exercised on this panel, and a login screen you can't type into on a device with no
physical keyboard is a worse failure than a session that starts unlocked. `setup/pn-lock-at-login.desktop` is a per-session autostart entry instead — it runs once the
(still auto-logged-in) session comes up and locks it immediately, so the state you land in is
"logged in, but locked" rather than "not logged in yet." The password entry you actually type
into is GNOME Shell's own unlock dialog, which by this point already gets `pn-osk`'s k6
keyboard — `pn-osk`'s `metadata.json` carries `session-modes: ["user", "unlock-dialog"]`
precisely for this, see [`docs/keyboard.md`](keyboard.md#pinning-the-keyboard).

## Install

```sh
install -m 0644 setup/pn-lock-at-login.desktop ~/.config/autostart/pn-lock-at-login.desktop
gsettings set org.gnome.desktop.lockdown disable-lock-screen false
gsettings set org.gnome.desktop.screensaver lock-enabled true
gsettings set org.gnome.desktop.session idle-delay 0
```

`pn lock` reports the autostart entry and all three keys; `pn lock on|off` toggles the whole
set together — see `setup/pn`.

## Caution — unverified

The one reboot seen so far on this device happened after running `pn reload` (which restarts
gdm3) while the screen was locked. This has not been isolated from other things changing at
the same time, so treat it as a correlation, not a confirmed cause — but until it is
understood, unlock the screen before running `pn reload`.
