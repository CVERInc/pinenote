#!/usr/bin/env bash
# Lifelines — the four settings that make a PineNote serviceable from another machine.
#
# Day one with this device was spent typing into an on-screen keyboard that drops
# characters, on a machine that rebooted at random, with no log surviving the reboot
# to say why. Every one of those problems was solved by something below. None of it
# used to live in this repo, so a reflash put you right back at day one.
#
# Safe to run with no arguments: it applies what needs no input, and prints exactly
# how to unlock the rest. Idempotent — re-running changes nothing already in place.
#
#   ./lifeline.sh
#   PINENOTE_SSH_PUBKEY="ssh-ed25519 AAAA... you@host" ./lifeline.sh
#   PINENOTE_WIFI_SSID=myssid PINENOTE_WIFI_PSK=secret ./lifeline.sh
#   PINENOTE_NOPASSWD_SUDO=1 ./lifeline.sh          # read the warning first
set -eu

USERNAME="$(id -un)"
skipped=0

echo "== [1] Persistent journal (survives the reboot that needs explaining) =="
# Debian's journald defaults to Storage=auto, which means volatile *unless*
# /var/log/journal exists. On a stock image it does not — so the log of a crash
# dies with the crash. Creating the directory is the whole fix.
if [ -d /var/log/journal ]; then
  echo "   /var/log/journal exists — already persistent"
else
  sudo mkdir -p /var/log/journal
  sudo systemd-tmpfiles --create --prefix /var/log/journal
  sudo journalctl --flush
  echo "   enabled"
fi
# Cap it: this device has ~15G for the OS partition and no one is watching it.
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=150M\n' | sudo tee /etc/systemd/journald.conf.d/00-journal-size.conf >/dev/null
echo "   SystemMaxUse=150M"

echo "== [2] SSH authorized key (so you never type on the panel again) =="
if [ -n "${PINENOTE_SSH_PUBKEY:-}" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
  if grep -qF "$PINENOTE_SSH_PUBKEY" "$HOME/.ssh/authorized_keys"; then
    echo "   key already authorised"
  else
    printf '%s\n' "$PINENOTE_SSH_PUBKEY" >> "$HOME/.ssh/authorized_keys"
    echo "   key added"
  fi
else
  echo "   skipped — set PINENOTE_SSH_PUBKEY to the *public* key of the machine you"
  echo "   will drive this from (contents of its ~/.ssh/id_ed25519.pub)"
  skipped=$((skipped + 1))
fi

echo "== [3] Wi-Fi on a WPA2/WPA3 transition network =="
# Two traps, both of which cost an evening:
#  1. A transition-mode AP advertises WPA2 and WPA3 at once. nmcli's shorthand form
#     and an explicit key-mgmt of 'sae' both fail to associate. It has to be wpa-psk.
#  2. `nmcli connection add` over SSH fails with "Insufficient privileges" — polkit
#     grants NetworkManager writes to an *active local session*, which an SSH login
#     is not. sudo is required here, and is the better answer anyway: a root-owned
#     system connection comes up at boot without anyone logging in.
if [ -n "${PINENOTE_WIFI_SSID:-}" ] && [ -n "${PINENOTE_WIFI_PSK:-}" ]; then
  if nmcli -t -f NAME connection show | grep -qxF "$PINENOTE_WIFI_SSID"; then
    echo "   connection '$PINENOTE_WIFI_SSID' already defined"
  else
    sudo nmcli connection add type wifi con-name "$PINENOTE_WIFI_SSID" \
      ifname wlan0 ssid "$PINENOTE_WIFI_SSID" \
      wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PINENOTE_WIFI_PSK"
    echo "   connection '$PINENOTE_WIFI_SSID' created"
  fi
else
  echo "   skipped — set PINENOTE_WIFI_SSID and PINENOTE_WIFI_PSK to define one here."
  echo "   Doing it in the GUI works too; the point of this block is the wpa-psk part."
  skipped=$((skipped + 1))
fi

echo "== [4] Passwordless sudo — OPT-IN, and a real trade-off =="
# What it buys: an agent (or you) on the other end of SSH can maintain this device
# unattended. What it costs: anyone who reaches this account is root, with no second
# gate. On a single-user tablet on a home network that is usually the right trade,
# but it should be a decision, not a default. Undo: sudo rm /etc/sudoers.d/010-user-nopasswd
if [ "${PINENOTE_NOPASSWD_SUDO:-0}" = "1" ]; then
  tmp="$(mktemp)"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$USERNAME" > "$tmp"
  # Validate before installing — a malformed sudoers file locks you out of sudo.
  sudo visudo -c -q -f "$tmp"
  sudo install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/010-user-nopasswd
  rm -f "$tmp"
  echo "   enabled for '$USERNAME' (validated with visudo)"
elif [ -f /etc/sudoers.d/010-user-nopasswd ]; then
  echo "   already enabled on this machine"
else
  echo "   skipped — set PINENOTE_NOPASSWD_SUDO=1 only if you have read the note above"
  skipped=$((skipped + 1))
fi

echo "== [5] Wi-Fi powersave off (the tablet says 'connected' and answers nothing) =="
# 症狀長這樣：平板上 Wi-Fi 顯示連線中、IP 也還是原本那個，但另一台機器 ping
# 不到，連 ARP 都拿不到回應。ARP 是二層的 —— 拿不到回應就代表這不是路由、
# 不是防火牆、也不是 IP 跑掉，而是無線晶片睡著了：關聯還在，但它不回應未經
# 請求的訊框。它自己送出任何一個封包就會醒（在平板上載一頁網頁就夠）。
#
# 對一台「主要用途是被 SSH 進來維護」的裝置，這個預設是錯的：省下來的電，
# 換到的是一台隨機失聯的機器。
#
# NetworkManager 的 wifi.powersave：0=用預設 1=不要動 2=關閉 3=開啟。
# 這顆模組的驅動預設是開著，所以要明確寫 2。
NM_PS=/etc/NetworkManager/conf.d/10-no-wifi-powersave.conf
if [ -f "$NM_PS" ] && grep -q 'wifi.powersave *= *2' "$NM_PS"; then
  echo "   already configured"
else
  printf '[connection]\nwifi.powersave = 2\n' | sudo tee "$NM_PS" >/dev/null
  echo "   wrote $NM_PS"
fi
sudo systemctl reload NetworkManager || true
# 現況要用問的，不要用猜的 —— 設定檔寫下去不等於現在這條連線已經套用，
# 已經建立的關聯要重連才會換。
if command -v iw >/dev/null 2>&1; then
  echo "   current: $(iw dev wlan0 get power_save 2>/dev/null || echo 'unknown')"
  echo "   還是 on 的話，重連一次才會套用。🔴 不要直接在 SSH 裡下 nmcli device"
  echo "   disconnect —— 那會把你自己的連線一起砍掉、然後沒有人再跑後半段。"
  echo "   要嘛在平板上做，要嘛丟給 systemd 讓它活過 SSH 斷線："
  echo "     sudo systemd-run --on-active=2 nmcli device reapply wlan0"
else
  echo "   iw 未安裝，無法回報現況（sudo apt-get install -y iw）"
fi
# ⚠️ 位址本身沒有在這裡固定。這台是 DHCP，而它到目前為止一直拿到同一個
#    位址，所以問題是「睡著」不是「換號碼」。真的要釘死，在路由器上做 DHCP
#    reservation，不要在裝置上設靜態 —— 設錯的話你就得抱著平板打字了。

echo
if [ "$skipped" -gt 0 ]; then
  echo "== done — $skipped block(s) skipped for want of input (see above) =="
else
  echo "== done — all lifelines in place =="
fi
