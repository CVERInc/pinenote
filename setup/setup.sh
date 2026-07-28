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

echo "== [2] 生命線：接電不休眠（保 SSH 不斷）／電池閒置 10 分鐘 suspend =="
# 🔴 AC 與電池要分開設。原本兩邊都 nothing ＝ 拔電後不到一天耗盡電池，
#    而這台沒電關機後只有實體電源鍵能開機（reset 路徑全封，見 vault）。
# 接電不吃電池 → 維持不睡，保留「插著電遠端長跑」的能力。
# 電池 → 閒置 10 分鐘 deep suspend。實測 2026-07-28：清醒約 49.5mA、睡著約 6.7mA。
#   10 分鐘而非 5：在 e-ink 上讀東西可以很久沒有任何輸入。
# idle-delay 維持 0（不 blank）：e-ink 上 blank 會洗掉正在看的畫面；
#   suspend 本身就會關前光又保留畫面，讓它一步到位即可。
# ✅ suspend/resume 實測可靠：deep 進得去、RTC 與電源鍵都叫得醒、
#   resume 後 Wi-Fi 自動重連約 14 秒（brcmfmac 韌體重載），SSH 自己回來。
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type suspend
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-timeout 600
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

echo "== [6] Typing Mode：波形 + 兩個 user service + dbus 服務防呆 =="
# 🔴 這一段以前不存在——README 說「一行就裝好 Typing Mode」，但 setup.sh 根本沒裝，
#    那些 service 是當初手動放上去的。重刷一次就只剩終端配色，招牌功能不會回來。
D="$(cd "$(dirname "$0")" && pwd)"

# runtime 的波形設定不持久，開機要靠 modprobe.d
sudo tee /etc/modprobe.d/rockchip_ebc.conf >/dev/null <<'EOF'
options rockchip_ebc bw_mode=1 default_waveform=1 refresh_waveform=4 auto_refresh=0 prepare_prev_before_a2=1
EOF

mkdir -p "$HOME/.config/systemd/user"
install -m 0644 "$D/pn-typing-mode.service" "$D/pn-idle-refresh.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now pn-typing-mode.service pn-idle-refresh.service

# pinenote-dbus-service 會因 gpio-keys 開機競態而 panic，連帶讓「停手才清殘影」
# 整條鏈安靜地死掉。理由寫在 drop-in 檔頭。
sudo mkdir -p /etc/systemd/system/pinenote-dbus-service.service.d
sudo install -m 0644 "$D/10-ensure-gpio-keys.conf" \
  /etc/systemd/system/pinenote-dbus-service.service.d/10-ensure-gpio-keys.conf
sudo systemctl daemon-reload

echo "== [7] 生命線（SSH 金鑰／Wi-Fi／持久 journal／免密碼 sudo）=="
# 免輸入的部分自動套（持久 journal——沒有它，下次崩潰的遺言會跟著崩潰一起消失）；
# 其餘需要參數或明確 opt-in，lifeline.sh 會印出怎麼開。
"$(dirname "$0")/lifeline.sh"

# ── TODO（要盯螢幕才能調，留待有人看效果時做）──
#  • e-ink 波形：/sys/module/rockchip_ebc/parameters/*（root:video、user 在 video group→免 sudo 可寫）
#    治「打字全螢幕刷」。bw_mode=1 純黑白最適文字。runtime 不持久→開機自動套要寫 modprobe.d。
#  • 藍牙 Keychron K6 卡頓：疑 2.4G Wi-Fi/BT 共存干擾 → Wi-Fi 切 5GHz。
#  • suspend（mem_sleep=deep，2024 批 bug）：高風險、動底層，留最後、或那時才考慮 os2/備份當網。

echo "== done =="

# ── 試過、放棄的（別重踩）──
#  • lid「蓋上就睡」：試過 logind 的 HandleLidSwitchExternalPower=ignore，想做成
#    「插電不睡、電池才睡」→ 無效。疑 logind 不認為 USB-C 供電算「外部電源」。
#    結論：維持系統預設，需要遠端連線時別蓋。
#  🔴 別在活著的 session 上跑 systemctl restart systemd-logind — 會弄掉 GNOME session。
#     救援：從 SSH 跑 sudo systemctl restart gdm3。改 lid 只能「寫檔 + 重開機」。
#  🔴 電子紙的 TTY 字太小太糊、不堪用 — 若要走「開機直進 SSH 的極簡系統」，
#     console 字型是必須先解的第一關。
