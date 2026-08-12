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
dirty=0
failing=0
warned_parse=0
used_fallback=0

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

  if [ "$idle" -ge "$IDLE_MS" ] && [ "$dirty" -eq 1 ]; then
    if err=$(clear_screen); then
      [ "$failing" -eq 1 ] && { echo "idle-refresh: clearing works again" >&2; failing=0; }
      dirty=0
    elif [ "$failing" -eq 0 ]; then
      echo "idle-refresh: 清除失敗 — 殘影不會被清掉: $err" >&2
      echo "idle-refresh: check 'systemctl status pinenote-dbus-service'" >&2
      failing=1
    fi
  fi
  sleep 1
done
