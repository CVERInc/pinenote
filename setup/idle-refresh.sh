#!/usr/bin/env bash
# Typing Mode 的行為核心：打字時不打斷你，停手才清殘影。
# A2 負責打字順；停手 IDLE_MS 毫秒後清一次。
#
# 2026-08-12：清除方式從「全螢幕黑白閃」換成**互補抖動**（pn-wave 擴充的 Clear）。
#   一半像素翻黑、另一半翻白，下一格對調 ⇒ 每個像素都拿到完整的黑↔白擺盪
#   （跟全閃逐像素等價），但畫面平均亮度全程停在中灰、從來沒有整片翻轉。
#   不舒服來自整個視野一起改變亮度，不是來自清除本身。
#   🔴 fallback 一定要留：擴充沒載入時得退回 TriggerGlobalRefresh，
#      不然就變成「安靜地什麼都沒清」——這支歷史上已經那樣壞過一次。
#
# 🔴 這支曾經同時壞在兩個地方，而且都是安靜地壞（2026-07-23 才發現）：
#
#  1. 閒置時間用 `grep -oE "[0-9]+"` 從 `(uint64 342896,)` 撈——**"uint64" 裡的 64
#     也被撈出來**，於是 $idle 是兩行、每次比較都 "integer expression expected"。
#     上一次開機光這個錯誤就 173,975 次，全都乖乖躺在 journal 裡沒人看。
#     ⇒ 閒置偵測從裝上那天起就沒運作過，殘影一次都沒清。
#  2. dbus 那行掛著 `2>/dev/null`。pinenote-dbus-service 一 panic，這支就對著
#     空氣喊了三天，安靜地成功了每一次。
#
# 所以：解析要精確（認 uint64 後面那個數，不是「任何數字」），失敗要出聲
# （但只在狀態轉變時出一次，別再產生十七萬行沒人讀的東西）。
IDLE_MS=${1:-3000}
# 第二個觸發器：連續捲動永遠等不到 IDLE_MS 那麼長的停頓，於是完全不會被清。
# （核心的 auto_refresh 本來管這一半，但它只會產生原廠全閃，所以已經關掉。）
# 距上次清除超過 STALE_MS 之後，就改用一個**短很多**的停頓門檻 SOFT_IDLE_MS。
# 🔑 為什麼不直接在活躍中清：清除會在你正在讀的畫面上蓋 1.4 秒。挑一個
#    自然的微停頓（兩次滑動之間一定有）就完全不必打斷任何動作。
STALE_MS=${2:-90000}
SOFT_IDLE_MS=${3:-1500}
dirty=0
failing=0
warned_parse=0
used_fallback=0
soft_hits=0
in_grey=0

now_ms() { date +%s%3N; }

# 灰階模式（bw_mode=0）底下不需要我們清。
#
# 那顆色調按鈕切的不只是色調：它會連帶把預設波形換成 GC16，而 GC16 是完整的重置
# 波形——於是**每一次畫面更新本身就是一次清除**，殘影根本疊不起來。在那個模式下
# 再插一個看得見的 1.4 秒抖動清除，是在清一個已經乾淨的螢幕。
# 黑白模式用 A2：快又安靜，但會累積，那才是這支存在的理由。
#
# 讀 sysfs 而不是 D-Bus：每秒一次，要便宜。
GREY_ONLY_PARAM=/sys/module/rockchip_ebc/parameters/bw_mode
greyscale() { [ "$(cat "$GREY_ONLY_PARAM" 2>/dev/null)" = "0" ]; }

# 決策抽成純函式，才驗得到——這支的兩個歷史缺陷都是「分支從來沒被走過」。
# 回傳：0=不清 1=一般停頓 2=久沒清了，接受短停頓
decide() {  # dirty idle stale
  [ "$1" -eq 1 ] || { echo 0; return; }
  [ "$2" -ge "$IDLE_MS" ] && { echo 1; return; }
  [ "$3" -ge "$STALE_MS" ] && [ "$2" -ge "$SOFT_IDLE_MS" ] && { echo 2; return; }
  echo 0
}

# 被 --selftest 叫的時候只驗決策表，不碰螢幕
if [ "${1:-}" = "--selftest" ]; then
  IDLE_MS=8000; STALE_MS=90000; SOFT_IDLE_MS=1500
  fail=0
  check() { r=$(decide "$1" "$2" "$3")
            if [ "$r" = "$4" ]; then echo "  ✓ dirty=$1 idle=$2 stale=$3 → $r  ($5)"
            else echo "  ✗ dirty=$1 idle=$2 stale=$3 → $r，應該是 $4  ($5)"; fail=1; fi; }
  echo "決策表："
  check 0 20000 999999 0 "沒髒就不清，再久也不清"
  check 1  9000     0  1 "一般規則：停手夠久"
  check 1  2000     0  0 "停頓不夠久、也還沒過期 → 不清"
  check 1  2000 95000  2 "過期了：短停頓就夠 ← 這條是新的，捲動靠它"
  check 1  1000 95000  0 "過期了但連短停頓都沒有（手指還在動）→ 仍然不清"
  check 1  9000 95000  1 "兩條都成立時算一般規則"
  exit $fail
fi

clear_screen() {
  # 先試抖動清除；擴充不在就退回原廠全閃，並且**說出來**。
  if out=$(gdbus call --session --dest net.cver.PnWave \
             --object-path /net/cver/PnWave \
             --method net.cver.PnWave.Clear "{}" 2>&1); then
    [ "$used_fallback" -eq 1 ] && {
      echo "idle-refresh: pn-wave 回來了，改用抖動清除" >&2; used_fallback=0; }
    return 0
  fi
  if [ "$used_fallback" -eq 0 ]; then
    echo "idle-refresh: pn-wave 叫不到（$out），退回全螢幕閃" >&2
    used_fallback=1
  fi
  dbus-send --system --dest=org.pinenote.ebc /ebc \
            org.pinenote.ebc.TriggerGlobalRefresh 2>&1
}

last_clear=$(now_ms)
while true; do
  raw=$(gdbus call --session --dest org.gnome.Mutter.IdleMonitor \
    --object-path /org/gnome/Mutter/IdleMonitor/Core \
    --method org.gnome.Mutter.IdleMonitor.GetIdletime 2>/dev/null)
  idle=$(printf '%s' "$raw" | sed -n 's/.*uint64 \([0-9]*\).*/\1/p')

  # 沒解析出乾淨的整數就不要硬比——那正是上一版每秒噴兩行錯誤的原因。
  if ! [ "$idle" -eq "$idle" ] 2>/dev/null; then
    if [ "$warned_parse" -eq 0 ]; then
      echo "idle-refresh: cannot read idle time (is GNOME running?); raw=[$raw]" >&2
      warned_parse=1
    fi
    sleep 2
    continue
  fi
  [ "$warned_parse" -eq 1 ] && { echo "idle-refresh: idle time readable again" >&2; warned_parse=0; }

  [ "$idle" -lt 1000 ] && dirty=1

  # 色調按鈕按下去的那一刻，維護策略跟著換。出聲一次，不洗版——不然這條守衛
  # 一旦哪天讀錯了參數，症狀會是「清除安靜地停掉」，而那正是這支歷史上壞過的樣子。
  if greyscale; then
    [ "$in_grey" -eq 0 ] && {
      echo "idle-refresh: 灰階模式（GC16 每次更新都在自清）→ 暫停清除" >&2; in_grey=1; }
    dirty=0
    last_clear=$(now_ms)
    sleep 1
    continue
  fi
  [ "$in_grey" -eq 1 ] && {
    echo "idle-refresh: 回到黑白模式（A2 會累積）→ 恢復清除" >&2; in_grey=0; }

  stale=$(( $(now_ms) - last_clear ))
  why=$(decide "$dirty" "$idle" "$stale")
  if [ "$why" -ne 0 ]; then
    if err=$(clear_screen); then
      [ "$failing" -eq 1 ] && { echo "idle-refresh: clearing works again" >&2; failing=0; }
      # 只有新的那條規則出聲，而且它最多每 STALE_MS 一次——不會洗版。
      [ "$why" -eq 2 ] && {
        soft_hits=$((soft_hits + 1))
        echo "idle-refresh: 久沒清了（${stale}ms），趁 ${idle}ms 的微停頓清一次"\
             "（第 $soft_hits 次）" >&2; }
      dirty=0
      last_clear=$(now_ms)
    elif [ "$failing" -eq 0 ]; then
      echo "idle-refresh: 清除失敗 — 殘影不會被清掉: $err" >&2
      echo "idle-refresh: check 'systemctl status pinenote-dbus-service'" >&2
      failing=1
    fi
  fi
  sleep 1
done
