#!/bin/sh
# Install the PineNote UCM2 profile into the system ALSA search path.
#
# This mirrors the layout alsa-ucm-conf ships upstream: real files live under
# a vendor path (Rockchip/PineNote/), and a symlink under conf.d/<driver>/
# is what alsa-lib's search (see /usr/share/alsa/ucm2/ucm.conf) actually
# finds for this card. The PineNote's sound card is an ASoC "simple-card",
# so alsa-lib reports:
#
#   CardDriver   = simple-card   (from /proc/asound/cards, or
#                                 /sys/class/sound/card0/device/driver)
#   CardLongName = PineNote      (from /proc/asound/cards / card0/id)
#
# and probes, in order:
#   ucm2/conf.d/simple-card/PineNote.conf
#   ucm2/conf.d/simple-card/simple-card.conf
#
# We install the first.
#
# Requires: alsa-ucm-conf package installed first (provides ucm2/ucm.conf and
# the conf.d/ directory itself -- `apt install alsa-ucm-conf` on Debian).
#
# Usage: sudo ./install.sh

set -eu

UCM2=/usr/share/alsa/ucm2
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$(id -u)" -ne 0 ]; then
	echo "run as root (sudo ./install.sh)" >&2
	exit 1
fi

if [ ! -d "$UCM2/conf.d" ]; then
	echo "$UCM2/conf.d not found -- install the alsa-ucm-conf package first" >&2
	exit 1
fi

install -d -m 755 "$UCM2/Rockchip/PineNote"
install -m 644 "$HERE/Rockchip/PineNote/PineNote.conf" "$UCM2/Rockchip/PineNote/PineNote.conf"
install -m 644 "$HERE/Rockchip/PineNote/HiFi.conf" "$UCM2/Rockchip/PineNote/HiFi.conf"

install -d -m 755 "$UCM2/conf.d/simple-card"
ln -sf ../../Rockchip/PineNote/PineNote.conf "$UCM2/conf.d/simple-card/PineNote.conf"

echo "installed. verify with:"
echo "  alsaucm -c PineNote list _verbs"
echo "  alsaucm -c PineNote set _verb HiFi list _devices"
echo
echo "then restart the user session's audio stack for WirePlumber to re-probe:"
echo "  systemctl --user restart pipewire pipewire-pulse wireplumber"
