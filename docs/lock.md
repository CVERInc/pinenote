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
org.gnome.desktop.session idle-delay 600                  # 10 minutes — setup.sh sets this to 0
```

`idle-delay 0` in `setup/setup.sh` was chosen to stop GNOME's own idle timer from fighting
`pn-idle-refresh` (see [`docs/setup.md`](setup.md)); turning locking on needs a nonzero value,
so `pn lock on` overrides it back to 10 minutes. `pn lock off` restores `disable-lock-screen`
to `true` and removes the autostart entry below, but does not touch `idle-delay` or
`lock-enabled` — there is nothing for either to do once the lockdown key is back.

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
gsettings set org.gnome.desktop.session idle-delay 600
```

`pn lock` reports the autostart entry and all three keys; `pn lock on|off` toggles the whole
set together — see `setup/pn`.

## Caution — unverified

The one reboot seen so far on this device happened after running `pn reload` (which restarts
gdm3) while the screen was locked. This has not been isolated from other things changing at
the same time, so treat it as a correlation, not a confirmed cause — but until it is
understood, unlock the screen before running `pn reload`.
