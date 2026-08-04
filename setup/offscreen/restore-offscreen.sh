#!/bin/bash
# Put the off-screen (sleep) image back after a boot.
#
# Why a service is needed at all, given setup.sh already writes the file the
# driver documents itself as reading:
#
#     /lib/firmware/rockchip/rockchip_ebc_default_screen.bin
#
# Because rockchip_ebc is a module that lives in the initramfs, and it probes at
# t+1.3s — before the root filesystem is the thing answering firmware requests.
# request_firmware resolves against the *initramfs* copy of that path, which was
# packed when the image was built and has the stock Pine64 picture in it. The
# file on the root filesystem is never read. Nothing warns you: the driver logs
# no failure, because from its point of view nothing failed.
#
# So a freshly installed picture shows up the moment you apply it by hand, looks
# permanent for as long as the machine stays up, and is gone the next time the
# machine comes back. `update-initramfs` is the real fix and the setup script can
# do it for you, but regenerating an initramfs on a device whose only recovery
# path is maskrom is a decision, not a step. This service is the part that is
# free: re-apply at boot, through the same runtime call used to iterate.
#
# Failures here are loud on purpose. The earlier version of this idea had
# `2>/dev/null` on the D-Bus call and spent three days telling the journal it had
# succeeded, to a service that was not running.
set -u

FW=${1:-/lib/firmware/rockchip/rockchip_ebc_default_screen.bin}
DEST=org.pinenote.ebc
TIMEOUT=${OFFSCREEN_WAIT:-60}

if [ ! -r "$FW" ]; then
  echo "no off-screen image at $FW — nothing to restore"
  exit 0
fi

# pinenote-dbus-service can lose a boot race and get restarted (see
# 10-ensure-gpio-keys.conf), so After= is necessary but not sufficient: wait for
# the name to actually be owned rather than for the unit to have been started.
deadline=$((SECONDS + TIMEOUT))
until dbus-send --system --print-reply --dest=org.freedesktop.DBus \
        /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner \
        string:"$DEST" 2>/dev/null | grep -q 'boolean true'; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "$DEST never appeared on the system bus within ${TIMEOUT}s;" \
         "off-screen image NOT restored — the panel will show whatever the" \
         "initramfs copy holds" >&2
    exit 1
  fi
  sleep 2
done

if dbus-send --system --print-reply --dest="$DEST" /ebc \
     "$DEST".SetOfflineScreenFromFileTemporary string:"$FW" >/dev/null; then
  echo "off-screen image restored from $FW"
else
  echo "SetOfflineScreenFromFileTemporary failed for $FW" >&2
  exit 1
fi
