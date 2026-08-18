#!/usr/bin/env bash
# PineNote 輸入法：拼音（輸出繁體）＋ 日本語（羅馬字），都掛在 IBus 上。
#
# 🔴 為什麼是 IBus 不是 fcitx5 —— 這不是偏好，是通不通。
#    這台沒有實體鍵盤，主要輸入裝置是 pn-osk 那副螢幕鍵盤，而它是 patch GNOME
#    Shell 自己的 Keyboard（import 的就是 resource:///org/gnome/shell/ui/keyboard.js）。
#    OSK 送字走 Clutter InputMethod → IBus。fcitx5 自己畫候選窗、不走這條路，
#    收不到 OSK 的鍵。
#
# 🔴 為什麼拼音是 RIME 不是 libpinyin。
#    libpinyin 的繁體是「簡體詞庫 ＋ OpenCC 事後轉換」，一簡對多繁必錯
#    （發/髮、乾/幹/干、麵/面、後/后）。朙月拼音的詞庫本身就是繁體，簡體才是
#    opencc 轉出去的（simplification 開關）——方向相反，沒有轉換損失。
#
#    而且用 _tw 變體：實測 /usr/share/rime-data/luna_pinyin.dict.yaml 的詞彙
#    本來就偏台灣（軟體在、軟件不在；網路七筆、網絡零筆），_tw 再疊一層 t2tw
#    把字形也校正（裡/裏、著/着、為/爲）。這台的 opencc 沒有 t2twp.json，
#    但詞彙那一層本來就不需要，所以不缺。
#
# 🔴 為什麼日文是 Mozc 不是 RIME 的日文方案。
#    RIME 的假名漢字變換很弱。Mozc 才有真正的文節變換和學習。
#    兩個引擎掛同一個 IBus，用 pn-panel 那顆 pn-input 切換。
#
# 版面完全不用改：拼音、羅馬字、英文吃的是同一組 26 個字母。兩個引擎的
# ibus 宣告都是 layout=default，pn-osk 的 _composeLayout 會走
# `${groupName}-extended` → `us-extended` 的 fallback 接住它們，所以切換
# 輸入源時 k6 不會變形。沒有那行 fallback 這件事不成立。
set -euo pipefail

echo "== [1] 套件 =="
# 先模擬。這台的 gnome-shell 曾經被 apt-mark hold 過（見 setup.sh [4]），
# 而「0 to remove」是唯一值得信的保證。實測這串只會升 libibus 1.5.31→1.5.32，
# gnome-shell 和 mutter 都不動。
sudo apt-get install -s ibus ibus-rime ibus-mozc fonts-noto-cjk \
  | grep -E "^[0-9]+ upgraded|^Remv" || true
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ibus ibus-rime ibus-mozc fonts-noto-cjk

# fonts-noto-cjk 不是可選的：這台原本只有 Droid Sans Fallback，候選字會是
# 湊出來的字形。227dpi 上 CJK 本來就好讀，缺的只是字型本體。

echo "== [2] RIME：朙月拼音·臺灣正體 =="
mkdir -p "$HOME/.config/ibus/rime"
cat > "$HOME/.config/ibus/rime/default.custom.yaml" <<'EOF'
# 由 setup/ime.sh 產生。理由寫在那支腳本裡，這裡只留跟這台硬體綁著的兩條。
#
# page_size 5 —— RIME 的預設值，改過一次又改回來。
#
# 🔴 曾經是 9（2026-08-17），理由是「k6 有完整數字列，九個候選按數字直選」。
#    那個理由對，但輸給了另一件事：橫排的候選列只有 936 邏輯像素寬，而拼音是
#    整句打的 —— 第一個候選是「實際上打字時可能會一次打一大排」這種長度時，
#    九格擠不下，St 只能把每格 ellipsize 成「七...」「5 ...」，翻頁鈕直接被推出
#    視野。這是算術不是排版：不管對齊怎麼調，九個含長句的候選就是塞不進 936。
#    macOS 的做法是第一個候選要多長給多長、後面塞幾個算幾個、剩的往下翻 ——
#    page_size 5 就是往那個方向靠。1-5 照樣數字直選，6-9 變成翻一頁。
#
# 🔴 候選字走兩條路，而它們的選字方式不一樣 —— 這台實際跑的
#    ibusCandidatePopup.js 裡，_updateVisibility() 是
#        isVisible = !Main.keyboard.visible && (...)
#    螢幕鍵盤開著時浮動窗不出現，候選改由 Main.keyboard.addSuggestion() 推進
#    OSK 上緣那條 suggestions strip。而 addSuggestion(text, callback) 不帶 index
#    標籤（indexes 只送給浮動窗），所以 OSK 那條是**用點的**，數字鍵選不到。
#    （pn-osk 已經把那個條件拿掉、讓浮動窗兩種情況都服務，見它的
#    _pnDockCandidatePopup；但這段留著，因為它解釋了為什麼要那樣做。）
#
# schema_list 只留一個是刻意的：RIME 的方案切換是 Ctrl+`，而 k6 的 portrait
# topRow 是 "1234567890-=" 沒有反引號（landscape 的 "`1234567890-=" 才有）。
# 不要讓自己依賴一個轉個方向就消失的鍵。
patch:
  schema_list:
    - schema: luna_pinyin_tw
  menu/page_size: 5
EOF

# 候選字橫排。這是 **ibus-rime 前端自己的**設定，不是 default.yaml、也不是方案。
#
# 🔴 位置試錯了兩次，記下來省得別人再走一遍：
#      default.custom.yaml         → 沒用，ibus-rime 不讀 default.yaml 的 style
#      luna_pinyin_tw.custom.yaml  → 也沒用，它也不讀方案的 style
#      ibus_rime.custom.yaml       → 對。/usr/share/rime-data/ibus_rime.yaml 是
#                                    前端的設定檔，出廠寫著 horizontal: false；
#                                    binary 裡 "ibus_rime.yaml" 和
#                                    "style/horizontal" 兩個字串就排在一起。
#
#    怎麼確認的：從外部建一個 IBus input context 收 update-lookup-table，直接讀
#    table.get_orientation()。改對之前是 2（SYSTEM），之後是 0（HORIZONTAL）。
#    而 GNOME 的 _candidateArea.setOrientation() 把 SYSTEM 和 VERTICAL 歸成同一
#    類畫直排 —— 所以「shell 不聽話」是假象，真相是 RIME 從來沒設過那個值。
cat > "$HOME/.config/ibus/rime/ibus_rime.custom.yaml" <<'EOF'
patch:
  "style/horizontal": true
EOF

# build/ 是編好的快取。改了 custom.yaml 不刪它的話，下次啟動仍然吃舊的。
rm -rf "$HOME/.config/ibus/rime/build" "$HOME/.config/ibus/rime/user.yaml"

# 🔴 刪完**不要**自己跑 rime_deployer --build。
#    那支只編方案和 default.yaml，不會產生 build/ibus_rime.yaml —— 而它跑完會
#    寫下 user.yaml 的 last_build_time，於是前端啟動時看到「沒有變更」，跳過那次
#    會產生前端設定檔的維護。結果是 build/ibus_rime.yaml 永遠不存在，引擎退回去
#    讀共用的那份（horizontal: false），橫排就這樣悄悄失效。
#    交給前端自己部署：重啟 ibus，等它編完（這顆 SoC 上約 20 秒）。

echo "== [3] 輸入源 =="
# 🔴 順序有兩層意思。('xkb','us') 一定放第一個：終端一律回到它，不要靠引擎的
#    內部英數模式 —— Mozc 若改成 Kotoeri keymap（見 [4]），Ctrl+J/K/L 會跟
#    readline 的換行／砍到行尾／清畫面全撞，而這台整副 OSK 本來就是為終端做的。
#
#    後面兩個排 JP 再 TW，於是 pn-input 戳出來的循環是 US → JP → TW → US。
#    照 A-Z 記得住，照「常用度」記不住。
# 🔴 日文用 mozc-on 不是 mozc-jp。mozc-jp 啟用時停在直接入力，打羅馬字直接吐
#    英文字母（看起來就像輸入法沒裝好），而 k6 版面沒有半角/全角鍵切不出來。
#    mozc-on（Mozc:あ）一啟用就是假名。等同 macOS 把「かな」「英数」分成兩個
#    輸入源的做法。
gsettings set org.gnome.desktop.input-sources sources \
  "[('xkb','us'),('ibus','mozc-on'),('ibus','rime')]"

# GNOME 下不需要設 GTK_IM_MODULE／XMODIFIERS：Wayland 的 shell 自己就是 IM，
# ibus-daemon 由 org.freedesktop.IBus.session.GNOME.service 隨 session 起來
# （ibus 套件裝好時就把它連進 gnome-session.target.wants 了）。

echo "== [3a] 其他 CJK 語言（選用，預設不掛進 sources）=="
# 這台的維護者用不到這兩個，但這副鍵盤常常要服務其他 CJK 使用者。引擎先裝好、
# pn-panel 的標籤先備著，要用的人只差一行 gsettings —— 而「裝了引擎卻掉標籤」
# 是最難查的那種半殘，所以標籤不跟著選用走。
#
# 兩個都吃 US 鍵位，k6 版面完全不用動：
#   chewing（新酷音，注音）宣告 layout=us，自己把 US 鍵位映射成注音
#   hangul（韓文）宣告 layout=kr，_composeLayout 沒有 kr-extended 會退回
#          us-extended，而二式韓文本來就是用拉丁鍵位打字母
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ibus-hangul ibus-chewing

# 要掛進循環的話，把要的加進去（順序就是 pn-input 戳一下的順序）：
#
#   gsettings set org.gnome.desktop.input-sources sources \
#     "[('xkb','us'),('ibus','rime'),('ibus','chewing'),('ibus','mozc-on'),('ibus','hangul')]"
#
# ⚠️ 一顆按鈕循環五個源＝最遠要戳四下。維護者自己那三個是刻意留短的。
#
# 注音也可以走 RIME（rime-data-bopomofo 已經隨 librime-data 進來了，
# bopomofo / bopomofo_tw / bopomofo_express 三個方案都在），但那樣它會跟拼音
# 擠在同一個 `rime` 引擎裡，要用 Ctrl+` 在方案之間切 —— 而 k6 的 portrait
# 沒有反引號。所以獨立引擎的 chewing 才是這台上對的選擇。

echo "== [3b] IBus registry cache =="
# 裝完新引擎重建一次，mozc 自己的 component XML 就建議這麼做。便宜、無害。
#
# 🔴 歸因更正（2026-08-18）：這裡一度寫成「不重建的話 gsettings 看得到那個源、
#    面板切得過去，但打字沒反應」。那個症狀是真的，原因不是這個 —— 實測
#    `ibus list-engine` 在 write-cache **之前**就已經列出 rime 和 mozc-jp。
#    真正的原因是引擎選錯（mozc-jp 停在直接入力，見上面 [3]），跟 cache 無關。
#    留著這一步，但不要再用它解釋那個症狀。
ibus write-cache || true
ibus restart 2>/dev/null || true

echo "== [3c] 實體鍵盤的兩個鍵 =="
# 行為在 pn-panel 的 _pnInstallKeybindings 裡（它挾持這兩個綁定，把 MRU 循環
# 換成清單順序循環）。這裡只寫 accel。
#
# Ctrl+Space → 循環 US → JP → TW → US（順序來自上面的 sources）
gsettings set org.gnome.desktop.wm.keybindings switch-input-source "['<Control>space']"
# Caps → 回到 US（已經在 US 就跳回剛才那個源，macOS 的行為）
gsettings set org.gnome.desktop.wm.keybindings switch-input-source-backward "['Menu']"

# 🔴 Caps 本身要先變成一個「按得到」的鍵。它原本是鎖定修飾鍵，沒有可綁定的
#    keysym，所以 mutter 根本收不到它。caps:menu 讓它送出 Menu 而且不再鎖定
#    —— Menu 在這台上沒有別的用途（k6 版面沒有這顆鍵）。
#
#    先確認這個選項名字在這台的 xkeyboard-config 裡真的存在，不要盲設：
if grep -qE '^\s*caps:menu\b' /usr/share/X11/xkb/rules/evdev.lst; then
  gsettings set org.gnome.desktop.input-sources xkb-options "['caps:menu']"
  echo "   caps:menu 已設定"
else
  echo "   ⚠️ 這台的 xkeyboard-config 沒有 caps:menu，Caps 那個鍵不會生效。"
  echo "      可用的候選：grep -E '^\s*caps:' /usr/share/X11/xkb/rules/evdev.lst"
  echo "      挑一個會送出真 keysym 又不鎖定的，然後改上面那行 accel。"
fi
# ⚠️ 待驗：pn-osk 那顆 caps lock 鍵應該不受影響 —— 它是 shell 端的層級鎖存，
#    不是 Caps_Lock keysym。但這句話還沒在玻璃上驗過。

cat <<'EOF'

== [4] 剩下這一步是手動的，而且只能在玻璃上做 ==

Mozc 的 keymap 改成 Kotoeri，在裝置上跑：

    /usr/lib/mozc/mozc_tool --mode=config_dialog

    → キー設定の選択／Keymap style → Kotoeri

Kotoeri 給你 Ctrl+J = ひらがな、Ctrl+K = カタカナ、Ctrl+L = 英数，這三個鍵
k6 版面全都有。預設的 MS-IME keymap 用的是 F6/F7/F8 和半角/全角鍵，那些鍵
這副鍵盤沒有——不改就只能靠 Space 翻到候選列後段去拿片假名。

為什麼腳本不做：keymap 存在 ~/.config/mozc/config1.db，是二進位 protobuf，
沒有官方的文字設定或命令列開關可以寫。硬去改那個檔比手點一次危險。
（mozc-utils-gui 是 ibus-mozc 的相依，已經跟著裝好了，不必另外抓 Qt。）

EOF

# ── 日文 JIS 鍵盤 ───────────────────────────────────────────────────────
# 沒有做，而且建議不要做。理由分兩半：
#
#   實體 JIS 鍵盤 —— 根本不需要這個 repo 做任何事。加一個 xkb 源就好：
#       ('xkb','jp')
#     mozc 照樣是同一個引擎，變的只是鍵位對應。
#
#   螢幕鍵盤的 JIS 版面 —— 要為它多養一套 composed layout，而這個 repo 的
#     立場是「一個版面兩個方向勝過兩個各自調校的」（README 的鍵盤那節）。
#     跨語言時這條更強：拼音、注音、羅馬字、韓文二式、英文吃的是同一組 26 個
#     字母，一套 k6 全包。為了 JIS 破例，換到的是「在玻璃上摸得到 JIS 鍵位」
#     ——而玻璃上本來就沒有觸感，那正是實體 JIS 鍵盤唯一的賣點。
#
# 而且日文使用者在電腦上多數用羅馬字（維護者自己也是），JIS 直接輸入假名的
# 需求在這台上更低。

echo "ime.sh done — 重新登入或 systemctl restart gdm3 之後生效"
