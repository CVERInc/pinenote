#!/usr/bin/env bash
# PineNote setup — dogfood: the PineNote recording and replaying its own tuning.
# Goal: tune a clean PNDeb os1 into a dual-role device — "legible SSH terminal +
#       preserved GNOME handwriting (Xournal++/Wacom)" — without a separate os2.
# Idempotent: safe to rerun.
set -e
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"

echo "== [1] SSH server =="
sudo apt-get install -y openssh-server
sudo systemctl enable --now ssh

echo "== [2] Lifeline: disable sleep on AC (keep SSH alive) / suspend after 10m on battery =="
# 🔴 AC and battery power must be set separately. Both were nothing by default = 
#    exhausted the battery in under a day off AC, and once dead this device only
#    boots via the physical power button (reset paths are sealed, see vault).
# On AC power -> stay awake, preserving the ability to run long remote tasks.
# On battery -> deep suspend after 10 minutes idle.
# 🔴 Power consumption must be measured off AC; measuring on AC is an illusion
#    (the charger supplies current, charge_now drops slowly):
#    Measured deep suspend off AC is ~32mA = 19.4%/day => ~5 days on full charge
#    (2026-07-28, pn hook record).
#    On AC the same hook measured 8.5mA / 20 days, optimistic by 4x. Likewise
#    the "awake 49.5mA" measured on AC is low; extrapolated from the maintainer's
#    "exhausted in under a day" observation, true awake is ~170-200mA.
#    10 minutes rather than 5: reading on e-ink can mean long gaps without input.
# idle-delay stays 0 (no blank): on e-ink, blanking wipes the screen being read;
#    suspend already turns off the frontlight while keeping the picture, so just
#    go straight to suspend.
# ✅ suspend/resume measured reliable: deep suspend is entered, RTC and power
#    button both wake it, Wi-Fi reconnects automatically after ~14 seconds
#    (brcmfmac firmware reload), and SSH recovers on its own.
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type suspend
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-timeout 600
gsettings set org.gnome.desktop.session idle-delay 0

echo "== [3] Terminal readability (gnome-terminal, optimal for e-paper) =="
P=$(gsettings get org.gnome.Terminal.ProfilesList default | tr -d "'")
T="org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:$P/"
gsettings set "$T" cursor-blink-mode off
gsettings set "$T" cursor-shape block
gsettings set "$T" use-system-font false
gsettings set "$T" font "DejaVu Sans Mono 14"
gsettings set "$T" use-theme-colors false
gsettings set "$T" foreground-color "rgb(0,0,0)"
gsettings set "$T" background-color "rgb(255,255,255)"
gsettings set "$T" audible-bell false
gsettings set "$T" scrollback-lines 100000

# 16-color ANSI palette: line-drawing slots are pure black, background slots white.
# 🔴 Why not "tune to nice greys": this runs bw_mode=1, the panel has two levels, 
#    and any mid-grey is dithered, shattering the strokes of small text. GNOME's 
#    default slot 7 is #d0cfcc, and many TUIs (including Claude Code's light theme)
#    use slot 7 for "secondary text" — which on a white background is invisible.
#    Measured: changing every color except this one did nothing; changing this made
#    the whole screen readable.
# 🔴 Slot 7 must be black: it acts as foreground in a white-background terminal.
#    Setting it to white causes half the screen to vanish (tried it, only the
#    title bar remained).
# 🔴 Only slot 0 is white, slot 8 is not. Slot 0 is almost entirely used as a
#    background in TUIs; leaving it black makes a solid black block on a white
#    background: text vanishes, and large black areas are exactly the accumulation
#    source this repo suppresses. White = "unpainted background", the same
#    reasoning as unpainted context lines in diffs. Slot 15 is also white (white
#    text on dark backgrounds, e.g. inverted headers).
# 🔴 Slot 8 is a text slot, not a background slot, measured on the panel: whitening
#    it makes Claude Code's comments, git's secondary output, and all dim text
#    vanish entirely (row [2] in the test pattern disappeared). The theme therefore
#    points all backgrounds to slot 0, reserving 8 for "the shade only visible in
#    dark terminals".
# 🔴 Slots 1 (red) and 2 (green) are untouched. They act as diff backgrounds in
#    Claude Code; whitening them is tempting, but they are also the red/green
#    foregrounds in git/ls/grep — whitening them turns those words from "black" to
#    "invisible", buying only one program's diff background. The trade is unequal,
#    so diff backgrounds remain black blocks on this device.
# Trade-off: editor syntax highlighting becomes entirely black on this device.
#            A 1-bit screen never had the bandwidth for that information.
#            The other 8 slots are "dark secondary text" in other TUIs and will
#            vanish here.
# Scrollbar off: it claims ~50px on the right with no matching margin on the left
# — making the screen look off-center.
# Measured: text left edge is at 2px, right edge stops at x≈1819, leaving 52px
# empty on the right.
# On e-ink a scrollbar is both useless (we scroll by keyboard or touch) and leaves
# ghosting as it moves with the content.
gsettings set "$T" scrollbar-policy never

# Horizontal padding. The terminal only displays integer columns, and the undivided
# remainder is left empty on the right: this device is 936 logical px / 84 columns
# at 11.14px each; 84 columns claim 924px, leaving 12px (24 physical px) stacked
# on the right edge, making the whole screen look off-center. Measured: left 2px,
# right 20px. Splitting the remainder puts it in symmetry, without losing a single
# column — those pixels were unused anyway.
#
# 🔴 GTK reads gtk.css only at startup, and all gnome-terminal windows share a
#    single server, so this step needs a full terminal restart to become visible
#    (a reboot works too).
# 🔴 An existing gtk.css is never overwritten: it is a user's own file. We only
#    append our block, and check for a marker to avoid applying it twice.
GTKCSS="$HOME/.config/gtk-3.0/gtk.css"
mkdir -p "$(dirname "$GTKCSS")"
if [ -f "$GTKCSS" ] && grep -q "pinenote:terminal-padding" "$GTKCSS"; then
  echo "   -> gtk.css already has terminal padding, keeping"
else
  cat >> "$GTKCSS" <<'PNCSS'

/* pinenote:terminal-padding — see setup/setup.sh [3] */
vte-terminal {
  padding-left: 6px;
  padding-right: 6px;
}
PNCSS
  echo "   -> Terminal padding added (requires terminal restart to take effect)"
fi
gsettings set "$T" bold-is-bright false
gsettings set "$T" palette "['#FFFFFF', '#000000', '#000000', '#000000', \
'#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', \
'#000000', '#000000', '#000000', '#000000', '#FFFFFF']"

# Selection highlighting. 🔴 These three must be set together; setting the colors
# without the switch does nothing: when highlight-colors-set is false, VTE just
# changes the background to the "foreground color" and keeps the text's own color
# — on a white-background terminal that means black text on a black background, so
# the selection becomes a solid black block. Measured on the panel: the values were
# right to begin with, the missing part was the switch.
gsettings set "$T" highlight-background-color "#000000"
gsettings set "$T" highlight-foreground-color "#FFFFFF"
gsettings set "$T" highlight-colors-set true

echo "== [4] apt foundation: hold GNOME shell/mutter (the actual reason is to prevent full-upgrade) =="
# 🔴 Attribution correction (2026-08-01): this previously claimed "GNOME 48 causes
#    boot failures", which was wrong. The only evidence at hand was upstream
#    PNDeb/pinenote-debian-image#89 "Cannot boot after update", opened in 2024-11,
#    while GNOME 48 shipped in 2025-03 — the timeline does not fit. It was about
#    gdm3 failing to reinstall after a dist-upgrade. => "Do not run full-upgrade"
#    holds; "GNOME 48 is dangerous" had no evidence.
#    The hold has a cost: gnome-shell 47.3-1+pn1 no longer has a source (only in
#    dpkg status) = it is an orphan and will not receive security updates.
# 🔴 Do not run full-upgrade. The PNDeb signing key is short-lived (expires in
#    1-6 months); when it expires, reinstall the official keyring:
#    wget <release>/pinenote-custom-repo-and-keyring_X_all.deb && sudo dpkg -i ...
#    (verify fingerprint first).
sudo apt-mark hold gnome-shell gnome-shell-common gnome-shell-extension-prefs \
  gnome-shell-extension-user-theme gnome-shell-extensions-common \
  mutter-common mutter-common-bin 2>/dev/null || true

echo "== [5] Common tools =="
sudo apt-get install -y git tmux vim

echo "== [6] Typing Mode: waveform + two user services + dbus service fail-safe =="
# 🔴 This block did not exist before — the README claimed "one line installs
#    Typing Mode", but setup.sh never installed it; those services were placed by
#    hand. Reflashing left only the terminal colors, and the marquee feature
#    did not come back.
D="$(cd "$(dirname "$0")" && pwd)"

# Runtime waveform settings do not persist; boot relies on modprobe.d
sudo tee /etc/modprobe.d/rockchip_ebc.conf >/dev/null <<'EOF'
options rockchip_ebc refresh_waveform=4 auto_refresh=0 refresh_threshold=4 prepare_prev_before_a2=1
EOF

mkdir -p "$HOME/.config/systemd/user"
install -m 0644 "$D/pn-typing-mode.service" "$D/pn-idle-refresh.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now pn-typing-mode.service pn-idle-refresh.service

# pinenote-dbus-service panics from a gpio-keys boot race, which silently takes
# down the entire "clear ghosting on idle" chain. The reasoning is at the top of
# the drop-in file.
sudo mkdir -p /etc/systemd/system/pinenote-dbus-service.service.d
sudo install -m 0644 "$D/10-ensure-gpio-keys.conf" \
  /etc/systemd/system/pinenote-dbus-service.service.d/10-ensure-gpio-keys.conf
sudo systemctl daemon-reload

echo "== [7] Lifeline (SSH key / Wi-Fi / persistent journal / passwordless sudo) =="
# The non-interactive parts are applied automatically (persistent journal — without
# it, the next crash's final logs vanish with the crash); the rest need arguments
# or explicit opt-in, and lifeline.sh prints how to enable them.
"$(dirname "$0")/lifeline.sh"

# ── TODO (requires looking at the screen, deferred until someone is watching) ──
#  • e-ink waveforms: /sys/module/rockchip_ebc/parameters/* (root:video, user
#    is in video group -> writable without sudo)
#    Fixes "full screen flash on typing". bw_mode=1 pure B/W is best for text.
#    Runtime changes do not persist -> auto-apply at boot needs modprobe.d.
#  • Bluetooth Keychron K6 stutters: suspected 2.4G Wi-Fi/BT coexistence
#    interference -> move Wi-Fi to 5GHz (see [11]).
#  • ✅ suspend verified (2026-07-28, no longer an unknown): enters deep suspend,
#    RTC and cover-open both wake it, Wi-Fi reconnects automatically after ~14
#    seconds (brcmfmac firmware reload), and SSH recovers on its own. Off-AC
#    sleep draws ~19.4%/day => ~5 days on full charge. Battery idle auto-suspend
#    has been observed firing under real conditions (off AC + untouched). 🔴
#    Verification must use logind (systemctl suspend); rtcwake -m mem writes
#    directly to /sys/power/state, bypassing systemd-suspend.service and skipping
#    all system-sleep hooks.

echo "== [8] Fix PNDeb suspend power drain logging (the image on this device threw NameError on every sleep) =="
# /usr/lib/systemd/system-sleep/pn_record_power_usage.py searches for the battery
# using a platform path.
#   Our image: hardcoded rk817-charger.6.auto, while this device is .7.auto
#   (instance numbers drift) -> both candidates are missing -> bat_dir is never
#   assigned -> throws a NameError on every suspend; this instrument has never
#   worked from day one (not a single line in /root/energy_use.dat).
#   Upstream current: now uses glob to find the instance directory, fixing the
#   primary bug — but still asserts, so a miss will still throw an exception on
#   every suspend.
# Replace both forms with the stable /sys/class/power_supply/rk817-battery + a
# quiet exit on failure.
# Submitted upstream as PNDeb/pinenote-debian-image#129; until it lands (and for
# any older image), we patch it here.
# dpkg -S finds no owner = unmanaged by the package manager, it will not come
# back on its own after reflashing.
sudo python3 "$D/patch-pn-power-usage.py"

echo "== [9] Sleep screen (installed if ~/offscreen/screen.bin exists) =="
# The image left on the screen after closing the cover, locking, or shutting down
# is not the GNOME lock screen, it is the kernel EBC driver's off-screen: before
# powering down the panel, the driver pushes
# /lib/firmware/rockchip/rockchip_ebc_default_screen.bin straight to the
# controller. GNOME's org.gnome.desktop.screensaver picture-uri is a dead key
# (the shell only reads its user-switch-enabled), changing it does nothing.
# The picture is a private photo and does not enter this public repo; the recipe
# is in setup/offscreen/, the picture itself goes in ~/offscreen/ (/home is an
# independent p7 partition, reflashing os1 does not wipe it).
# 🔴 You do not have to reboot to look: SetOfflineScreenFromFileTemporary applies
#    the picture at runtime immediately. On a device where every reset path ends
#    in losing power and only the physical power button brings it back, this is
#    not a convenience, it is the only way to check before persisting — otherwise
#    every brightness adjustment requires a person on-site to reboot.
# 🔴 But that "persisting" was an illusion (caught during a reboot on 2026-08-04):
#    rockchip_ebc is a module, lives in the initramfs, and probes at t+1.3s, so
#    request_firmware resolves to **the copy in the initramfs**, not the one we
#    wrote to rootfs. The initramfs was packed with the factory picture -> reboot,
#    and the picture vanishes, while the driver prints exactly zero warnings
#    (nothing failed from its side).
#    => Writing the file + re-applying via the same D-Bus call at boot fills the
#    gap; true persistence is update-initramfs, see below.
FW=/lib/firmware/rockchip/rockchip_ebc_default_screen.bin
if [ -f "$HOME/offscreen/screen.bin" ]; then
  sudo cp -n "$FW" "$FW.bak-pine64"          # Factory PINE64 image, backed up once (-n for idempotence)
  sudo install -m 0644 "$HOME/offscreen/screen.bin" "$FW"

  sudo install -m 0755 "$D/offscreen/restore-offscreen.sh" /usr/local/sbin/pn-restore-offscreen
  sudo install -m 0644 "$D/offscreen/pn-offscreen.service" /etc/systemd/system/pn-offscreen.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now pn-offscreen.service
  echo "   Installed; factory image backed up to $FW.bak-pine64; restored on boot by pn-offscreen.service"

  # The initramfs is where the driver actually reads from. Untouched by default:
  # this device has no remote recovery; a broken initramfs = maskrom only, and
  # the extlinux menu is currently hidden (cannot pick an older kernel).
  # To persist it, opt in explicitly (and verify by rebooting while a person is
  # on-site):
  #   PINENOTE_OFFSCREEN_INITRAMFS=1 setup/setup.sh
  if [ "${PINENOTE_OFFSCREEN_INITRAMFS:-0}" = "1" ]; then
    sudo cp -n "/boot/initrd.img-$(uname -r)" "/boot/initrd.img-$(uname -r).bak-offscreen"
    sudo update-initramfs -u -k "$(uname -r)"
    echo "   initramfs regenerated (old backup at /boot/initrd.img-$(uname -r).bak-offscreen)"
  else
    echo "   initramfs not regenerated = driver reads factory image on boot; see above comments to persist"
  fi
else
  echo "   Skipping: missing ~/offscreen/screen.bin (generate one with setup/offscreen/make-offscreen.sh)"
fi

echo "== [10] Bluetooth keyboard: disable BT controller runtime suspend =="
# ⚠️ **Hypothesis, not yet verified** (2026-07-31): One candidate root cause for
# Keychron K6 typing stutters.
# Measured BT controller runtime PM as auto, autosuspend 5s; over 44 minutes of
# uptime it spent 98.4% suspended.
# 🔴 But that number is **not evidence** — the keyboard was disconnected while
#    measuring; 98.4% only proves it was idle. To verify, it needs measuring
#    while the keyboard is connected to see if it bounces in and out of suspend,
#    which requires a human typing.
# The other candidate is Wi-Fi/BT coexistence: BCM43455 is a single chip sharing
# an antenna, and Wi-Fi is on 2.4G(ch6). If the same AP offers 5GHz, move to it,
# but this device has no remote recovery, so switching bands needs a person on-site.
# Cost: slightly more power draw only while awake; during deep suspend the entire
# system stops, so the "5-7 days off AC" remains unaffected.
sudo tee /etc/udev/rules.d/50-bt-no-autosuspend.rules >/dev/null <<'EOF'
# BT controller runtime PM off — a sparse-input device (keyboard) pays the wake
# latency on every first keystroke after an idle gap. BCM43455 sits on UART/serdev.
ACTION=="add", SUBSYSTEM=="serial", KERNEL=="serial0-0", ATTR{power/control}="on"
EOF
sudo udevadm control --reload
C=/sys/class/bluetooth/hci0/device/power/control
[ -e "$C" ] && echo on | sudo tee "$C" >/dev/null   # Applies immediately, no reboot required
echo "   BT autosuspend disabled (rule verified to fire on add)"

echo "== [11] Prefer 5GHz for Wi-Fi (freeing 2.4GHz for Bluetooth) =="
# BCM43455 is a **single chip, shared antenna** for Wi-Fi + Bluetooth. While
# Wi-Fi sits on 2.4GHz, the Bluetooth keyboard disconnects, drops strokes, or
# repeats them (dropping a key-up leaves the kernel auto-repeating). The exact
# same keyboard is perfectly stable on a Mac, which rules out environmental
# interference — the contention is between this device's own two radios.
# ⚠️ Evidence level: measured noticeably stable on 5GHz, and objectively down/up
#    events pair up; but this was not a rigorous control experiment (the 2.4GHz
#    set could not be sampled under identical conditions). The hard metrics are
#    watching /var/log/bt-band-trial.log and `dmesg | grep -c "BLUETOOTH HID"`
#    (reconnection count) over the long term.
# Names no specific network: it reads the active connection, clones it while
# pinning the band to 5GHz, and carries the PSK over from the existing connection
# without writing it to disk. Works for anyone on any network.
A=$(nmcli -t -f NAME,TYPE con show --active 2>/dev/null | awk -F: '$2=="802-11-wireless"{print $1; exit}')
# Connections already pinned to 5GHz do not need cloning (otherwise each run
# sprouts another -5g suffix)
B=""; [ -n "$A" ] && B=$(nmcli -g 802-11-wireless.band con show "$A" 2>/dev/null)
if [ "$B" = "a" ]; then
  echo "   Current connection is already bound to 5GHz, skipping"
elif [ -n "$A" ] && ! nmcli -g NAME con show 2>/dev/null | grep -qx "${A}-5g"; then
  S=$(nmcli -g 802-11-wireless.ssid con show "$A" 2>/dev/null)
  P=$(sudo nmcli -s -g 802-11-wireless-security.psk con show "$A" 2>/dev/null)
  if [ -n "$S" ] && [ -n "$P" ]; then
    # 🔴 WPA2/WPA3 transition networks must explicitly set wpa-psk (both sae and
    #    shorthand fail to associate, see lifeline.sh)
    sudo nmcli con add type wifi con-name "${A}-5g" ifname wlan0 ssid "$S" \
      wifi.band a wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$P" \
      connection.autoconnect yes connection.autoconnect-priority 10 >/dev/null 2>&1 \
      && sudo nmcli con mod "$A" connection.autoconnect-priority 0 \
      && echo "   Created ${A}-5g (prefers 5GHz; original connection kept as fallback)"
    unset P
  else
    echo "   Skipping: failed to read SSID/PSK of current connection"
  fi
else
  echo "   Already exists or no active Wi-Fi, skipping"
fi

echo "== [12] Mac mode Bluetooth keyboard: remap left Alt and left Super back to PC layout =="
# A tri-mode keyboard switched to Mac mode presents itself as an Apple keyboard
# (vendor 05AC), and the mapping itself **is correct**:
#   control -> Ctrl / option -> Alt / command -> Super
# The issue is the **physical order**; the last two keys in the layouts differ:
#   PC layout   ... Ctrl  Super  Alt   [space]      <- Alt hugs the spacebar
#   Mac layout  ... Ctrl  Alt    Super [space]      <- Super hugs the spacebar
# So reaching next to the spacebar intending Alt+Tab sends Super instead. The
# physical Mac/Win switch on the keyboard performs exactly this swap — doing it on
# the host side instead means no longer toggling switches when moving between
# machines (a physical toggle is an invisible device state, and it bites).
# Swap the left side only: 65% layouts usually lack a right Alt to swap (measured:
# this keyboard's right side only has a second command key).
# ⚠️ This is a **global** setting and applies to any connected keyboard; targeting a
#    specific device requires binding the device id with keyd.
# 🔴 **Corrections must live in exactly one place** (measured 2026-08-01): when the
#    keyboard is toggled to Windows mode, it swaps the keycodes in firmware
#    (measured option->Super, command->Alt = PC order); applying this XKB rule on
#    top of that **reverts it to Mac layout = completely wrong**. => If using this
#    rule, leave the keyboard in Mac mode.
#    For the record: the switch **does not** alter the keyboard's declared identity
#    (both modes are vendor 05ac, the same HID instance, no re-enumeration), it
#    only alters the keycodes sent.
# 🔴 The kernel originally had a better answer for this: the `hid_apple` driver has
#    a `swap_opt_cmd` parameter, but this kernel has `# CONFIG_HID_APPLE is not set`,
#    so the keyboard falls back to hid-generic and those parameters do not exist.
#    This XKB rule is the userspace workaround, needing no kernel changes.
# 🔴 Append, do not overwrite the entire array: ime.sh also places caps:menu
#    (Caps->US) into this key, and if both scripts hardcode the array, the second
#    overwrites the first (actually happened on 2026-08-18: the Mac keyboard rule
#    was erased, and nobody noticed because it only shows when a Mac keyboard is
#    attached).
python3 - <<'PY'
import subprocess, ast
cur = ast.literal_eval(subprocess.check_output(["gsettings","get","org.gnome.desktop.input-sources","xkb-options"], text=True).strip())
if "altwin:swap_lalt_lwin" not in cur:
    cur.append("altwin:swap_lalt_lwin")
subprocess.check_call(["gsettings","set","org.gnome.desktop.input-sources","xkb-options", repr(cur)])
print("   xkb-options =", cur)
PY
echo "   Applied (requires manual verification: XKB sits above evdev, evdev keycodes remain unchanged)"

echo "== [18] Input method (skipped if PINENOTE_NO_IME=1) =="
# Pinyin, bopomofo, Japanese. This used to be "run it yourself if you want it",
# but without it this device could not type CJK after a reflash, and the pn-input
# button pointed at nothing — this is not optional. Opt out with the environment
# variable instead.
if [ "${PINENOTE_NO_IME:-0}" = "1" ]; then
  echo "   Skipping (PINENOTE_NO_IME=1)"
else
  "$D/ime.sh"
fi

echo "== done =="

# ── Tried and abandoned (do not retread) ──
#  • lid "suspend on cover close": tried logind's HandleLidSwitchExternalPower=ignore
#    to get "stay awake on AC, suspend on battery" -> did nothing. The guess then
#    was "logind does not consider USB-C external power" — which was wrong.
#    🔑 True cause (found 2026-07-28): gpio-keys reports SW_MACHINE_COVER (0x10),
#    not SW_LID, and logind's HandleLidSwitch* only respects SW_LID -> no setting
#    there will ever work. What actually handles the cover is PNDeb's own
#    pinenote_sleep_on_cover_close.sh, which asks logind to suspend on cover close.
#    The behavioral conclusion stands (do not close the cover when needing remote
#    access), but the target to change is that daemon, not logind.
#  🔴 Do not run systemctl restart systemd-logind on a live session — it kills the
#     GNOME session. Recovery: sudo systemctl restart gdm3 over SSH. Changing lid
#     behavior requires "write file + reboot".
#  🔴 The e-ink TTY font is too small and blurred, rendering it unusable — if
#     building a "minimal system booting straight to SSH", the console font is the
#     first obstacle to clear.

echo "== [14] Auto-rotate: wire up the accelerometer =="
# This device has an accelerometer (silan sc7a20), but auto-rotate is dead out of
# the box, failing in two places.
#
# ① iio-sensor-proxy is missing => GNOME cannot see the chip; the Auto Rotate
#    switch is present in Quick Settings, but greyed out.
sudo apt-get install -y iio-sensor-proxy
#
# ② systemd's /usr/lib/udev/hwdb.d/60-sensor.hwdb has an ACCEL_MOUNT_MATRIX labeled
#    for the PineTab2, using of:N<node>T<type>C<compatible> as the match key —
#    which only specifies the chip, not the machine identity. The PineNote uses the
#    same silan,sc7a20 mounted in a different orientation, so the PineTab2's
#    calibration applies and overwrites the correct value from the device tree.
#    Symptom: the four physical orientations collapse into two, both of them
#    landscape (transform 0 and 2).
sudo install -m 0644 "$D/udev/61-sensor-pinenote.rules" /etc/udev/rules.d/
sudo udevadm control --reload
# 🔴 Only trigger that specific device. --subsystem-match=iio reissues ADD for
#    saradc as well, and the power button (adc-keys) is attached to that ADC —
#    measured: doing this puts the machine to sleep.
for d in /sys/bus/iio/devices/iio:device*; do
  [ "$(cat "$d/name" 2>/dev/null)" = "sc7a20" ] && sudo udevadm trigger --action=add "$d"
done
sudo systemctl restart iio-sensor-proxy 2>/dev/null || true
gsettings set org.gnome.settings-daemon.peripherals.touchscreen orientation-lock false
echo "   Wired up; Auto Rotate is in quick settings (the rotate button on the panel also shows the current mode)"

echo "== [13] pn-osk: replace virtual keyboard with 65% layout (supported by GNOME 47 and 48) =="
# 🔴 This step was missing from the script before: the README dedicates a whole
#    section to this keyboard, but reflashing left it gone. A phantom feature,
#    the exact same shape as Typing Mode was.
# Idempotent: files are overwritten directly; config files are untouched if they
# exist (since the user tuned them).
E="$HOME/.local/share/gnome-shell/extensions/pn-osk@cver.net"
mkdir -p "$E"
install -m 0644 "$D/../extensions/pn-osk@cver.net/extension.js" \
                "$D/../extensions/pn-osk@cver.net/metadata.json" \
                "$D/../extensions/pn-osk@cver.net/stylesheet.css" "$E/"
# Custom icons (the panel's refresh button). Missing them leaves the button blank,
# and a blank button reads as broken.
mkdir -p "$E/icons"
install -m 0644 "$D/../extensions/pn-osk@cver.net/icons/"*.svg "$E/icons/"
if [ ! -f "$HOME/.config/pn-osk.json" ]; then
  install -m 0644 "$D/../extensions/pn-osk@cver.net/pn-osk.example.json" \
                  "$HOME/.config/pn-osk.json"
  echo "   -> Placed default ~/.config/pn-osk.json"
else
  echo "   -> ~/.config/pn-osk.json exists, keeping"
fi
# Newly installed extension directories are not scanned until the session restarts,
# so this enable step might initially fail; writing the uuid directly to the list
# ensures the shell loads it next time. Use python instead of sed to edit this
# array: an empty list is "@as []", and string concatenation produces bad syntax
# like "@as [, 'x']".
pn_enable_extension() {
  # Newly installed extension directories are not scanned until the session restarts,
  # so this enable step might initially fail; writing the uuid directly to the list
  # ensures the shell loads it next time. Use python instead of sed to edit this
  # array: an empty list is "@as []", and string concatenation produces bad syntax
  # like "@as [, 'x']".
  gnome-extensions enable "$1" 2>/dev/null && return 0
  PN_UUID="$1" python3 - <<'PYEOF'
import os, subprocess

UUID = os.environ["PN_UUID"]
cur = subprocess.run(["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
                     capture_output=True, text=True).stdout.strip()
body = cur[cur.index("[") + 1:cur.rindex("]")]
items = [s.strip().strip("'") for s in body.split(",") if s.strip()]
if UUID in items:
    print("   -> %s is already in enabled-extensions" % UUID)
else:
    items.append(UUID)
    val = "[" + ", ".join("'%s'" % i for i in items) + "]"
    subprocess.run(["gsettings", "set", "org.gnome.shell",
                    "enabled-extensions", val], check=True)
    print("   -> %s added to enabled-extensions" % UUID)
PYEOF
}

pn_enable_extension pn-osk@cver.net

echo "== [15] pn-panel: three top-bar e-ink controls (refresh / rotate / tone) =="
# These three used to live in pn-osk, sharing an extension with the keyboard and
# launcher but sharing zero state. They were split out so that anyone wanting
# only the buttons does not have to accept a rebuilt keyboard along with them.
P="$HOME/.local/share/gnome-shell/extensions/pn-panel@cver.net"
mkdir -p "$P/icons"
install -m 0644 "$D/../extensions/pn-panel@cver.net/extension.js" \
                "$D/../extensions/pn-panel@cver.net/metadata.json" \
                "$D/../extensions/pn-panel@cver.net/stylesheet.css" "$P/"
# Custom icons. Missing them leaves the button blank, and a blank button reads
# as broken.
install -m 0644 "$D/../extensions/pn-panel@cver.net/icons/"*.svg "$P/icons/"
pn_enable_extension pn-panel@cver.net

echo "== [15b] pn: single location for status and toggles =="
# setup/pn is a unified entry point that owns no state — the truth of every feature
# remains in its original home, pn only reads and writes them. So we just place a
# symlink here: ~/.local/bin is already on PATH in Debian's .profile.
mkdir -p "$HOME/.local/bin"
ln -sf "$D/pn" "$HOME/.local/bin/pn"
chmod +x "$D/pn"

echo "== [16] pn-wave: replace full-screen flash with complementary dither clear =="
# The amount of clearing did not decrease, the distribution did: the factory clear
# drives all pixels to black and then all to white at once; this one drives half
# to black and half to white, and swaps them in the next frame. Pixel for pixel
# the treatment is identical (the same full GC16 swing), but the screen's mean
# luminance stays at mid-grey the entire time, without a single full-screen flip
# — the discomfort comes from the latter, not the former.
W="$HOME/.local/share/gnome-shell/extensions/pn-wave@cver.net"
mkdir -p "$W"
install -m 0644 "$D/../extensions/pn-wave@cver.net/extension.js" \
                "$D/../extensions/pn-wave@cver.net/metadata.json" "$W/"
pn_enable_extension pn-wave@cver.net

echo "== [17] Microphone array: make it visible to the audio stack =="
# The four holes above the screen are a PDM microphone array on hw:0,1, and the
# card ships no UCM profile -- so WirePlumber falls back to a generic stereo
# configuration describing only device 0, the rk817 codec, and every application
# sees one stereo source. The array is not hidden; nothing ever told the stack it
# was there. This drop-in says so.
#
# Measured before writing it: hw:0,1 accepts 2-6 channels, all four carry signal,
# and claps from opposite sides invert the whole set of inter-channel delays --
# see setup/mic/ and the README. A UCM2 profile would be the version that fixes
# this for every PineNote rather than this one; this is the local shim.
install -d "$HOME/.config/pipewire/pipewire.conf.d"
install -m 0644 "$D/mic/50-pdm-mic-array.conf" \
                "$HOME/.config/pipewire/pipewire.conf.d/50-pdm-mic-array.conf"
if systemctl --user is-active --quiet pipewire; then
  systemctl --user restart pipewire pipewire-pulse wireplumber
  echo "   -> array exposed as a PipeWire source (restarted pipewire)"
else
  echo "   -> drop-in installed; it appears when pipewire next starts"
fi

# 🔴 The kernel's auto_refresh must be off: that path produces the factory full
#    flash, and we cannot change its appearance. The **true owner of auto_refresh
#    is pnhelper** — the value is recorded in its own gsetting, and every time the
#    session starts it overwrites the driver with the remembered value. Writing
#    only to sysfs or modprobe.d will not survive a single shell reload (measured:
#    changed the D-Bus value, and after restart gdm3 it was turned right back on).
PNH=/usr/share/gnome-shell/extensions/pnhelper@m-weigand.github.com/schemas
if [ -d "$PNH" ]; then
  gsettings --schemadir "$PNH" set org.gnome.shell.extensions.pnhelper auto-refresh false
  echo "   -> pnhelper auto-refresh set to false (otherwise it preempts with a full flash)"

  # The tone mode default. We declare it here instead of inheriting the upstream
  # schema's default — that default happens to currently be 0 as well, so this
  # device has always been in greyscale, but that is luck, not design: if upstream
  # changes the default tomorrow, this device would switch modes with it, and
  # nothing would mention it.
  #
  # 🔴 Write this only on the first run. This is preference, not correctness: if
  #    a user presses the panel button and then reruns setup.sh, it should not
  #    flip their choice back. The presence of the marker file skips it entirely.
  #    (The auto-refresh block above has no marker because that is correctness —
  #    the kernel path produces a factory flash we cannot alter, and must be off
  #    at all times.)
  TONE_MARK="$HOME/.config/pinenote-tone-default"
  case "${PINENOTE_TONE:-greyscale}" in
    greyscale) TONE_VALUE=0 ;;
    bw)        TONE_VALUE=1 ;;
    *) echo "   -> PINENOTE_TONE only accepts greyscale or bw, received ${PINENOTE_TONE}" >&2; TONE_VALUE=0 ;;
  esac
  if [ -f "$TONE_MARK" ]; then
    echo "   -> Tone mode previously configured, keeping your current choice"
  else
    gsettings --schemadir "$PNH" set org.gnome.shell.extensions.pnhelper \
      bw-mode "$TONE_VALUE"
    : > "$TONE_MARK"
    echo "   -> Tone default = ${PINENOTE_TONE:-greyscale} (changeable later via panel button, no further modifications here)"
  fi
else
  echo "   -> Missing pnhelper schemas, skipping; auto_refresh remains disabled by modprobe.d" >&2
fi
