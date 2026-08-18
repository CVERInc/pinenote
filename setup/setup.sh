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
# 電池 → 閒置 10 分鐘 deep suspend。
# 🔴 耗電要在「拔電」下量，接電時量的全是假象（充電器補電流，charge_now 掉得慢）：
#   拔電 deep suspend 實測約 32mA ＝ 19.4%/天 ⇒ 滿電約 5 天（2026-07-28，pn 的 hook 記錄）。
#   接電時同一支 hook 量到 8.5mA／20 天，樂觀了四倍。同理接電量到的「清醒 49.5mA」也偏低，
#   以維護者實測「不到一天耗盡」回推，真實清醒約 170-200mA。
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

# 16 色 ANSI 調色盤：畫線的格子全黑，鋪底的格子留白。
# 🔴 為什麼不是「調成好看的灰階」：這台跑 bw_mode=1，面板只有兩階，任何中間灰
#    都會被抖成網點，小字的筆畫因此散掉。GNOME 預設的第 7 格是 #d0cfcc，而很多
#    TUI（含 Claude Code 的 light 主題）拿第 7 格當「次要文字」——在白底上那等於
#    看不見。實測：只換這一格以外的顏色沒有用，換了它整個畫面才讀得出來。
# 🔴 第 7 格必須是黑的：它在白底終端機裡被當前景用。設成白色會讓半個畫面消失
#    （試過，畫面上只剩標題列）。
# 🔴 只有 0 號要白，8 號不可以。0 號在 TUI 裡幾乎只當底色用，留黑的話白底上就是
#    一塊實心黑：字看不見，而且大面積黑正是這個 repo 在消滅的累積來源。設成白＝
#    「不上底」，跟 diff 的 context 行不上底是同一個判斷。15 一樣留白（深色底上
#    的白字，例如反白標頭）。
# 🔴 8 號是文字格不是底色格，在面板上實測過：漂白它，Claude Code 的程式碼註解、
#    git 的次要輸出、所有 dim 文字會整批消失（測試圖第 [2] 行整行不見）。主題那邊
#    因此把底色全部指到 0 號，8 號只留給「深色終端機才看得到的那一階」。
# 🔴 1（紅）和 2（綠）不動。它們在 Claude Code 裡是 diff 的底色，漂白很誘人，
#    但同兩格也是 git／ls／grep 的紅綠前景——漂白等於那些字從「黑」變成「消失」，
#    換來的只是這一個程式的 diff 底。代價不對等，所以 diff 底在這台維持黑塊。
# 代價：編輯器的語法上色在這台上會全部變黑。1-bit 螢幕本來就承載不了那個資訊。
#      另外 8 格在別的 TUI 是「暗色次要文字」，這台上會跟著消失。
# 捲軸關掉：它在右邊佔掉約 50px，而左邊沒有對應的留白——畫面因此看起來偏左。
# 量出來的：文字左緣在第 2px，右緣停在 x≈1819，右邊空著 52px。
# 電子紙上捲軸既用不到（用鍵盤或觸控捲）又會跟著內容一起留殘影。
gsettings set "$T" scrollbar-policy never

# 左右留白。終端機只顯示整數欄，除不盡的餘數全部空在右邊：這台是 936 邏輯 px
# ÷ 84 欄、每格 11.14px，84 欄用掉 924，剩 12px（24 實體 px）堆在右緣，於是整個
# 畫面看起來偏左。量到的是左 2px、右 20px。把餘數分一半到左邊就對稱了，而且不
# 損失任何一欄——那些像素本來就沒人用。
#
# 🔴 GTK 只在啟動時讀 gtk.css，而 gnome-terminal 的所有視窗共用一個 server，
#    所以這一步要等終端機整個重啟才看得到（重開機也算）。
# 🔴 既有的 gtk.css 絕不覆寫：那是使用者自己的檔案，我們只追加自己那一段，
#    而且用標記判斷有沒有加過。
GTKCSS="$HOME/.config/gtk-3.0/gtk.css"
mkdir -p "$(dirname "$GTKCSS")"
if [ -f "$GTKCSS" ] && grep -q "pinenote:terminal-padding" "$GTKCSS"; then
  echo "   -> gtk.css 已有終端機留白，保留"
else
  cat >> "$GTKCSS" <<'PNCSS'

/* pinenote:terminal-padding — see setup/setup.sh [3] */
vte-terminal {
  padding-left: 6px;
  padding-right: 6px;
}
PNCSS
  echo "   -> 已加終端機留白（要重啟終端機才生效）"
fi
gsettings set "$T" bold-is-bright false
gsettings set "$T" palette "['#FFFFFF', '#000000', '#000000', '#000000', \
'#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', \
'#000000', '#000000', '#000000', '#000000', '#FFFFFF']"

# 反白（拖選）。🔴 這三個要一起設，只設顏色不設開關等於沒設：highlight-colors-set
# 是 false 時，VTE 只把底換成「前景色」而保留字本身的顏色——白底黑字的終端機上
# 那就是黑底黑字，選起來整段變全黑。面板上實測過，值本來就對，差的是那個開關。
gsettings set "$T" highlight-background-color "#000000"
gsettings set "$T" highlight-foreground-color "#FFFFFF"
gsettings set "$T" highlight-colors-set true

echo "== [4] apt 地基：hold 住 GNOME shell/mutter（真正的理由是不跑 full-upgrade）=="
# 🔴 歸因更正（2026-08-01）：這裡以前寫「GNOME 48 有開機災難」，那是錯的。
#    手上唯一的證據是上游 PNDeb/pinenote-debian-image#89 "Cannot boot after update"，
#    開於 2024-11，而 GNOME 48 是 2025-03 才發布——時間對不上，它談的是跑 dist-upgrade
#    之後裝不回 gdm3。⇒「別跑 full-upgrade」成立；「GNOME 48 危險」沒有證據。
#    hold 有代價：gnome-shell 47.3-1+pn1 已無來源(只剩 dpkg status)＝孤兒、不會再有安全更新。
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
options rockchip_ebc bw_mode=1 default_waveform=1 refresh_waveform=4 auto_refresh=0 refresh_threshold=4 prepare_prev_before_a2=1
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
#  • 藍牙 Keychron K6 卡頓：疑 2.4G Wi-Fi/BT 共存干擾 → Wi-Fi 改走 5GHz（見 [11]）。
#  • ✅ suspend 已驗（2026-07-28，不再是未知）：deep 進得去、RTC 與掀開蓋子都叫得醒、
#    resume 後 Wi-Fi 自動重連約 14 秒（brcmfmac 韌體重載）SSH 自己回來。拔電睡眠約 19.4%/天
#    ⇒ 滿電約 5 天。電池閒置自動 suspend 已在真實條件（拔電＋不碰）下看它開火過。🔴 驗證要走 logind（systemctl suspend），rtcwake -m mem 直寫
#    /sys/power/state 會繞過 systemd-suspend.service，system-sleep hooks 一個都不會跑。

echo "== [8] 修 PNDeb 的 suspend 耗電記錄（我們這台的 image 上每次睡眠都 NameError）=="
# /usr/lib/systemd/system-sleep/pn_record_power_usage.py 用 platform 路徑找電池。
#   我們的 image：硬編碼 rk817-charger.6.auto，這台是 .7.auto（實例編號會漂移）
#   → 兩條候選都不存在 → bat_dir 從未賦值 → 每次 suspend 拋 NameError，
#     這支儀表從第一天就沒運作過（/root/energy_use.dat 一行都沒有）。
#   上游現版：已改用 glob 找實例目錄，主 bug 修掉了——但仍 assert，一旦沒命中
#     照樣在每次 suspend 拋例外。
# 兩種形狀都換成穩定的 /sys/class/power_supply/rk817-battery ＋ 找不到就安靜退出。
# 已送上游 PNDeb/pinenote-debian-image#129；在它落地前（以及任何舊 image）靠這裡補。
# dpkg -S 查不到擁有者＝套件管理不管它，重刷後不會自己回來。
sudo python3 "$D/patch-pn-power-usage.py"

echo "== [9] 睡眠畫面（有 ~/offscreen/screen.bin 才裝）=="
# 蓋上／按鎖定／關機後停在螢幕上的那張圖不是 GNOME 鎖屏，是 kernel EBC driver 的
# off-screen：面板斷電前，driver 把 /lib/firmware/rockchip/rockchip_ebc_default_screen.bin
# 直接推給控制器。GNOME 那邊的 org.gnome.desktop.screensaver picture-uri 是死 key
# （shell 只讀它的 user-switch-enabled），改它什麼都不會發生。
# 圖是私人照片，不進這個公開 repo；配方在 setup/offscreen/，圖本身放 ~/offscreen/
# （/home 是獨立分割 p7，重刷 os1 不會跟著消失）。
# 🔴 不必重開機就能看：SetOfflineScreenFromFileTemporary 立刻套用執行期的圖。
#    在一台「任何 reset 路徑都終結於掉電、只有實體電源鍵能開機」的裝置上，這不是方便，
#    是唯一能在固化前先看一眼的辦法——不然每調一次亮度就要維護者到場開機一次。
# 🔴 但那個「固化」以前是假的（2026-08-04 一次重開機才抓到）：rockchip_ebc 是模組、
#    住在 initramfs 裡、t+1.3s 就 probe，request_firmware 解析到的是 **initramfs 內的
#    那份**，不是我們寫進 rootfs 的這份。initramfs 裡包的是出廠圖 → 重開機貓就沒了，
#    而 driver 一句警告都不會印（對它來說什麼都沒失敗）。
#    ⇒ 寫檔 + 開機時用同一支 D-Bus 呼叫補回來；真正的固化是 update-initramfs，見下。
FW=/lib/firmware/rockchip/rockchip_ebc_default_screen.bin
if [ -f "$HOME/offscreen/screen.bin" ]; then
  sudo cp -n "$FW" "$FW.bak-pine64"          # 原廠 PINE64 圖，只備份一次（-n 保冪等）
  sudo install -m 0644 "$HOME/offscreen/screen.bin" "$FW"

  sudo install -m 0755 "$D/offscreen/restore-offscreen.sh" /usr/local/sbin/pn-restore-offscreen
  sudo install -m 0644 "$D/offscreen/pn-offscreen.service" /etc/systemd/system/pn-offscreen.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now pn-offscreen.service
  echo "   已裝；原廠圖備份在 $FW.bak-pine64；開機由 pn-offscreen.service 補回"

  # initramfs 才是 driver 真正讀得到的地方。預設不動它：這台沒有遠端救援，
  # 壞掉的 initramfs ＝ 只剩磁鐵 maskrom，而且 extlinux 選單目前是隱藏的（挑不到舊 kernel）。
  # 要固化就明講一聲再開（重生完務必在人在現場時重開機驗一次）：
  #   PINENOTE_OFFSCREEN_INITRAMFS=1 setup/setup.sh
  if [ "${PINENOTE_OFFSCREEN_INITRAMFS:-0}" = "1" ]; then
    sudo cp -n "/boot/initrd.img-$(uname -r)" "/boot/initrd.img-$(uname -r).bak-offscreen"
    sudo update-initramfs -u -k "$(uname -r)"
    echo "   initramfs 已重生（舊的備份在 /boot/initrd.img-$(uname -r).bak-offscreen）"
  else
    echo "   initramfs 未重生＝driver 開機時讀到的仍是出廠圖；要固化見上方註解"
  fi
else
  echo "   跳過：沒有 ~/offscreen/screen.bin（用 setup/offscreen/make-offscreen.sh 產一張）"
fi

echo "== [10] 藍牙鍵盤：關掉 BT 控制器的 runtime 休眠 =="
# ⚠️ **假設，尚未驗證**（2026-07-31）：Keychron K6 打字卡頓的候選根因之一。
# 實測 BT 控制器 runtime PM 是 auto、autosuspend 5s，44 分鐘 uptime 有 98.4% 在 suspended。
# 🔴 但那份數字**不是證據**——量的時候鍵盤根本沒連線，98.4% 只證明它閒著。
#    要證實得在「鍵盤連線期間」看它會不會反覆進出 suspend，那需要真人打字。
# 另一個候選是 Wi-Fi/BT 共存：BCM43455 是單晶片、共用天線，而 Wi-Fi 在 2.4G(ch6)。
#    若同一 AP 有 5GHz 可用就切過去，但這台沒有遠端救援，切頻段要維護者在場才做。
# 代價：只在清醒時多一點點耗電；deep suspend 時整個系統停，不影響「拔電 5-7 天」。
sudo tee /etc/udev/rules.d/50-bt-no-autosuspend.rules >/dev/null <<'EOF'
# BT controller runtime PM off — a sparse-input device (keyboard) pays the wake
# latency on every first keystroke after an idle gap. BCM43455 sits on UART/serdev.
ACTION=="add", SUBSYSTEM=="serial", KERNEL=="serial0-0", ATTR{power/control}="on"
EOF
sudo udevadm control --reload
C=/sys/class/bluetooth/hci0/device/power/control
[ -e "$C" ] && echo on | sudo tee "$C" >/dev/null   # 立即生效，不必等重開機
echo "   BT autosuspend 已關（規則已驗證會在 add 時開火）"

echo "== [11] 讓 Wi-Fi 優先走 5GHz（給藍牙讓出 2.4GHz）=="
# BCM43455 是 Wi-Fi + 藍牙的**單晶片、共用天線**。Wi-Fi 待在 2.4GHz 時，藍牙鍵盤會
# 斷線／掉鍵／連發（掉 key-up 後核心自動重複）。同一支鍵盤在 Mac 上完全穩定，
# 環境干擾因此排除——爭用的是這台自己的兩個 radio。
# ⚠️ 證據等級：維護者實測 5GHz 下明顯穩定，客觀面 down/up 事件成對；但這不是對照
#   嚴謹的實驗（2.4GHz 那組沒能在相同條件下取樣）。長期看 /var/log/bt-band-trial.log
#   與 `dmesg | grep -c "BLUETOOTH HID"`（重連次數）才是硬指標。
# 不指名任何網路：讀目前在用的連線、複製一份把 band 釘在 5GHz 的，PSK 也從既有連線
# 帶過去不落地。對任何人的任何網路都適用。
A=$(nmcli -t -f NAME,TYPE con show --active 2>/dev/null | awk -F: '$2=="802-11-wireless"{print $1; exit}')
# 已經釘在 5GHz 的連線不必再複製（否則每跑一次就長出一條 -5g 尾巴）
B=""; [ -n "$A" ] && B=$(nmcli -g 802-11-wireless.band con show "$A" 2>/dev/null)
if [ "$B" = "a" ]; then
  echo "   目前連線已釘在 5GHz，跳過"
elif [ -n "$A" ] && ! nmcli -g NAME con show 2>/dev/null | grep -qx "${A}-5g"; then
  S=$(nmcli -g 802-11-wireless.ssid con show "$A" 2>/dev/null)
  P=$(sudo nmcli -s -g 802-11-wireless-security.psk con show "$A" 2>/dev/null)
  if [ -n "$S" ] && [ -n "$P" ]; then
    # 🔴 WPA2/WPA3 transition 網路要明寫 wpa-psk（sae 與簡寫都關聯不上，見 lifeline.sh）
    sudo nmcli con add type wifi con-name "${A}-5g" ifname wlan0 ssid "$S" \
      wifi.band a wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$P" \
      connection.autoconnect yes connection.autoconnect-priority 10 >/dev/null 2>&1 \
      && sudo nmcli con mod "$A" connection.autoconnect-priority 0 \
      && echo "   已建 ${A}-5g（5GHz 優先；原連線留著當 fallback）"
    unset P
  else
    echo "   跳過：讀不到現用連線的 SSID/PSK"
  fi
else
  echo "   已存在或無使用中的 Wi-Fi，跳過"
fi

echo "== [12] Mac 模式的藍牙鍵盤：把左 Alt 與左 Super 換回 PC 佈局 =="
# 三模鍵盤切在 Mac 模式時，對主機自稱是 Apple 鍵盤（vendor 05AC），鍵位對應本身**是正確的**：
#   control -> Ctrl / option -> Alt / command -> Super
# 問題出在**實體順序**，兩種佈局的最後兩顆是相反的：
#   PC 佈局   ... Ctrl  Super  Alt   [space]      <- Alt 貼著空格
#   Mac 佈局  ... Ctrl  Alt    Super [space]      <- Super 貼著空格
# 所以手指去按空格旁邊想要 Alt+Tab，送出的是 Super。鍵盤上的實體 Mac/Win 開關做的就是這個
# 交換——這裡改成由主機端做，就不必為了換機器去撥開關（那是個看不見的裝置狀態，會咬人）。
# 只換左邊：65% 佈局右下通常沒有右 Alt 可換（實測該鍵盤右側只有第二顆 command）。
# ⚠️ 這是**全域**設定，會套用到任何接上的鍵盤；要精確到單一裝置得用 keyd 綁 device id。
# 🔴 **修正只能存在於一個地方**（2026-08-01 實測）：把鍵盤撥到 Windows 模式時，它在韌體層
#    就把那兩顆的 keycode 換好了（實測 option→Super、command→Alt＝PC 順序），這時這條 XKB
#    再換一次會**繞回 Mac 佈局＝全錯**。⇒ 用這條就把鍵盤留在 Mac 模式。
#    順帶一提：撥開關**不會**改變鍵盤宣告的身分（兩種模式都是 vendor 05ac、同一個 HID 實例，
#    沒有重新枚舉），變的只有送出的 keycode。
# 🔴 kernel 這邊本來有更對的解：`hid_apple` 驅動帶 `swap_opt_cmd` 參數，但這顆 kernel
#    `# CONFIG_HID_APPLE is not set`，所以鍵盤只能落到 hid-generic，那些參數不存在。
#    XKB 這條是使用者空間的繞法，不需要動 kernel。
# 🔴 用加的，不要整個陣列蓋掉：ime.sh 也會往這個 key 放 caps:menu（Caps→US），
#    兩支各自寫死陣列的話後跑的蓋前面的（2026-08-18 真的發生：Mac 鍵盤那條被
#    蓋掉了，沒人發現，因為它只在接 Mac 鍵盤時才看得出來）。
python3 - <<'PY'
import subprocess, ast
cur = ast.literal_eval(subprocess.check_output(["gsettings","get","org.gnome.desktop.input-sources","xkb-options"], text=True).strip())
if "altwin:swap_lalt_lwin" not in cur:
    cur.append("altwin:swap_lalt_lwin")
subprocess.check_call(["gsettings","set","org.gnome.desktop.input-sources","xkb-options", repr(cur)])
print("   xkb-options =", cur)
PY
echo "   已套用（驗證只能靠人：XKB 在 evdev 之上，evdev 層的 keycode 不會變）"

echo "== [18] 輸入法（PINENOTE_NO_IME=1 跳過）=="
# 拼音、注音、日文。以前是「想要再自己跑」，但重刷之後少了它這台就打不了中日文，
# 而 pn-input 那顆按鈕會指著不存在的東西 —— 這不是可選的。不要的人設環境變數。
if [ "${PINENOTE_NO_IME:-0}" = "1" ]; then
  echo "   跳過（PINENOTE_NO_IME=1）"
else
  "$D/ime.sh"
fi

echo "== done =="

# ── 試過、放棄的（別重踩）──
#  • lid「蓋上就睡」：試過 logind 的 HandleLidSwitchExternalPower=ignore，想做成
#    「插電不睡、電池才睡」→ 無效。當時猜「logind 不認為 USB-C 算外部電源」——猜錯了。
#    🔑 真根因（2026-07-28 查明）：gpio-keys 報的是 SW_MACHINE_COVER(0x10)、不是 SW_LID，
#    而 logind 的 HandleLidSwitch* 只認 SW_LID → 怎麼設都不會生效。真正在處理蓋子的是
#    PNDeb 自己的 pinenote_sleep_on_cover_close.sh，聽到 cover close 就叫 logind suspend。
#    行為結論不變（需要遠端連線時別蓋），但要改行為的對象是那支 daemon，不是 logind。
#  🔴 別在活著的 session 上跑 systemctl restart systemd-logind — 會弄掉 GNOME session。
#     救援：從 SSH 跑 sudo systemctl restart gdm3。改 lid 只能「寫檔 + 重開機」。
#  🔴 電子紙的 TTY 字太小太糊、不堪用 — 若要走「開機直進 SSH 的極簡系統」，
#     console 字型是必須先解的第一關。

echo "== [14] 自動旋轉：接通加速度計 =="
# 這台有加速度計（silan sc7a20），但出廠狀態下自動旋轉是死的，死在兩個地方。
#
# ① iio-sensor-proxy 沒裝 ⇒ GNOME 看不到那顆晶片，快速設定裡的 Auto Rotate
#    開關雖然在，卻是灰的。
sudo apt-get install -y iio-sensor-proxy
#
# ② systemd 的 /usr/lib/udev/hwdb.d/60-sensor.hwdb 有一條標著 PineTab2 的
#    ACCEL_MOUNT_MATRIX，比對鍵是 of:N<節點>T<型別>C<compatible> —— 裡面只有
#    晶片，沒有機器身分。PineNote 用同一顆 silan,sc7a20、裝的方向不同，於是
#    PineTab2 的校正被套過來，蓋掉裝置樹裡正確的值。
#    症狀：四個實體方向被壓成兩個，而且兩個都是橫向（transform 0 與 2）。
sudo install -m 0644 "$D/udev/61-sensor-pinenote.rules" /etc/udev/rules.d/
sudo udevadm control --reload
# 🔴 只觸發那一顆裝置。--subsystem-match=iio 會連 saradc 一起重發 ADD，而
#    電源鍵（adc-keys）掛在那條 ADC 上 —— 實測會把機器弄睡。
for d in /sys/bus/iio/devices/iio:device*; do
  [ "$(cat "$d/name" 2>/dev/null)" = "sc7a20" ] && sudo udevadm trigger --action=add "$d"
done
sudo systemctl restart iio-sensor-proxy 2>/dev/null || true
gsettings set org.gnome.settings-daemon.peripherals.touchscreen orientation-lock false
echo "   已接通；Auto Rotate 在快速設定裡（面板上那顆旋轉鈕也會顯示目前模式）"

echo "== [13] pn-osk：把虛擬鍵盤換成 65% 版面（GNOME 47 與 48 都吃） =="
# 🔴 這一步以前不在腳本裡：README 有一整節在講這個鍵盤，而重刷後它不會回來。
#    跟 Typing Mode 當年同一個形狀的 phantom feature。
# 冪等：檔案直接覆蓋；設定檔已存在就不動（那是使用者調過的）。
E="$HOME/.local/share/gnome-shell/extensions/pn-osk@cver.net"
mkdir -p "$E"
install -m 0644 "$D/../extensions/pn-osk@cver.net/extension.js" \
                "$D/../extensions/pn-osk@cver.net/metadata.json" \
                "$D/../extensions/pn-osk@cver.net/stylesheet.css" "$E/"
# 自製圖示（面板的刷新鈕）。漏掉的話那顆按鈕會是空白的，而空白按鈕看起來就是壞掉。
mkdir -p "$E/icons"
install -m 0644 "$D/../extensions/pn-osk@cver.net/icons/"*.svg "$E/icons/"
if [ ! -f "$HOME/.config/pn-osk.json" ]; then
  install -m 0644 "$D/../extensions/pn-osk@cver.net/pn-osk.example.json" \
                  "$HOME/.config/pn-osk.json"
  echo "   -> 已放上預設 ~/.config/pn-osk.json"
else
  echo "   -> ~/.config/pn-osk.json 已存在，保留"
fi
# 新裝的擴充目錄要重啟 session 才掃得到，所以 enable 這一步可能先失敗；
# 直接把 uuid 寫進清單，下次 shell 起來就會載入。用 python 而不是 sed 改這個
# 陣列：清單為空時是 "@as []"，字串接合會生出 "@as [, 'x']" 這種壞語法。
pn_enable_extension() {
  # 新裝的擴充目錄要重啟 session 才掃得到，所以 enable 這一步可能先失敗；
  # 直接把 uuid 寫進清單，下次 shell 起來就會載入。用 python 而不是 sed 改這個
  # 陣列：清單為空時是 "@as []"，字串接合會生出 "@as [, 'x']" 這種壞語法。
  gnome-extensions enable "$1" 2>/dev/null && return 0
  PN_UUID="$1" python3 - <<'PYEOF'
import os, subprocess

UUID = os.environ["PN_UUID"]
cur = subprocess.run(["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
                     capture_output=True, text=True).stdout.strip()
body = cur[cur.index("[") + 1:cur.rindex("]")]
items = [s.strip().strip("'") for s in body.split(",") if s.strip()]
if UUID in items:
    print("   -> %s 已在 enabled-extensions 內" % UUID)
else:
    items.append(UUID)
    val = "[" + ", ".join("'%s'" % i for i in items) + "]"
    subprocess.run(["gsettings", "set", "org.gnome.shell",
                    "enabled-extensions", val], check=True)
    print("   -> %s 已加入 enabled-extensions" % UUID)
PYEOF
}

pn_enable_extension pn-osk@cver.net

echo "== [15] pn-panel：頂列三顆 e-ink 控制（刷新／旋轉／色調） =="
# 這三顆本來住在 pn-osk 裡，跟鍵盤和啟動器共用一個擴充卻不共用任何狀態。
# 拆出來是為了讓只想要這三顆的人不必連帶接受一副被重造的鍵盤。
P="$HOME/.local/share/gnome-shell/extensions/pn-panel@cver.net"
mkdir -p "$P/icons"
install -m 0644 "$D/../extensions/pn-panel@cver.net/extension.js" \
                "$D/../extensions/pn-panel@cver.net/metadata.json" \
                "$D/../extensions/pn-panel@cver.net/stylesheet.css" "$P/"
# 自製圖示。漏掉的話按鈕會是空白的，而空白按鈕看起來就是壞掉。
install -m 0644 "$D/../extensions/pn-panel@cver.net/icons/"*.svg "$P/icons/"
pn_enable_extension pn-panel@cver.net

echo "== [15b] pn：一個地方看現況、開關功能 =="
# setup/pn 是統一入口，不擁有狀態 —— 每個功能的真值留在它原本的家，pn 只是
# 讀寫它們。所以這裡只放一個 symlink：~/.local/bin 在 Debian 的 .profile 裡
# 本來就在 PATH 上。
mkdir -p "$HOME/.local/bin"
ln -sf "$D/pn" "$HOME/.local/bin/pn"
chmod +x "$D/pn"

echo "== [16] pn-wave：把全螢幕閃換成互補抖動清除 =="
# 清除量沒有變少，變的是分配：原廠讓所有像素同時翻黑再同時翻白；這個讓一半
# 翻黑、一半翻白，下一格對調。逐像素的待遇一模一樣（同樣的 GC16 全擺盪），
# 但畫面平均亮度全程停在中灰、一次都沒有整片翻轉——不舒服來自後者，不是前者。
W="$HOME/.local/share/gnome-shell/extensions/pn-wave@cver.net"
mkdir -p "$W"
install -m 0644 "$D/../extensions/pn-wave@cver.net/extension.js" \
                "$D/../extensions/pn-wave@cver.net/metadata.json" "$W/"
pn_enable_extension pn-wave@cver.net

# 🔴 核心的 auto_refresh 一定要關：它那條路徑產生的是原廠全閃，我們改不了它的樣子。
#    而 auto_refresh 的**真正主人是 pnhelper** —— 值記在它自己的 gsetting，每次
#    session 起來就拿記住的值覆寫驅動。只寫 sysfs 或只寫 modprobe.d 都活不過
#    一次 shell 重載（實測：改完 D-Bus 值，restart gdm3 之後它就被打開回去）。
PNH=/usr/share/gnome-shell/extensions/pnhelper@m-weigand.github.com/schemas
if [ -d "$PNH" ]; then
  gsettings --schemadir "$PNH" set org.gnome.shell.extensions.pnhelper auto-refresh false
  echo "   -> pnhelper 的 auto-refresh 已設為 false（否則它會用全閃搶先開火）"
else
  echo "   -> 找不到 pnhelper schemas，跳過；auto_refresh 仍由 modprobe.d 關著" >&2
fi
