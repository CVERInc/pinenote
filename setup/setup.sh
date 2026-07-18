#!/usr/bin/env bash
# PineNote 調教 setup — dogfood：PineNote 記錄／重放自己的調教。
# 目標：把乾淨的 PNDeb os1 調教成「護眼 SSH 終端 ＋ 保留手寫 GNOME(Xournal++/Wacom)」
#       的一機二職，不必另建 os2。
# 冪等：可重複跑。
set -e
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"

echo "== [1] SSH server =="
sudo apt-get install -y openssh-server
sudo systemctl enable --now ssh

echo "== [2] 生命線：關閉閒置自動休眠（保 SSH 不斷）=="
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type nothing
gsettings set org.gnome.desktop.session idle-delay 0

echo "== [3] 終端護眼（gnome-terminal，電子紙最佳）=="
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

echo "== [4] apt 地基：hold GNOME 48（不追 GNOME 大版本，避開開機災難）=="
# 🔴 不跑 full-upgrade。PNDeb 簽章 key 短命(1-6月過期)，失效時重裝官方 keyring：
#    wget <release>/pinenote-custom-repo-and-keyring_X_all.deb && sudo dpkg -i ...（先驗指紋）
sudo apt-mark hold gnome-shell gnome-shell-common gnome-shell-extension-prefs \
  gnome-shell-extension-user-theme gnome-shell-extensions-common \
  mutter-common mutter-common-bin 2>/dev/null || true

echo "== [5] 常用工具 =="
sudo apt-get install -y git tmux vim

# ── TODO（要盯螢幕才能調，留待有人看效果時做）──
#  • e-ink 波形：/sys/module/rockchip_ebc/parameters/*（root:video、user 在 video group→免 sudo 可寫）
#    治「打字全螢幕刷」。bw_mode=1 純黑白最適文字。runtime 不持久→開機自動套要寫 modprobe.d。
#  • 藍牙 Keychron K6 卡頓：疑 2.4G Wi-Fi/BT 共存干擾 → Wi-Fi 切 5GHz。
#  • suspend（mem_sleep=deep，2024 批 bug）：高風險、動底層，留最後、或那時才考慮 os2/備份當網。

echo "== done =="
