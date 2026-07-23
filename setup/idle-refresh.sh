#!/usr/bin/env bash
# Typing Mode 的行為核心：打字時不打斷你，停手才清殘影。
# A2 負責打字順；停手 IDLE_MS 毫秒後用 GC16 徹底清一次。
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
    if err=$(dbus-send --system --dest=org.pinenote.ebc /ebc \
               org.pinenote.ebc.TriggerGlobalRefresh 2>&1); then
      [ "$failing" -eq 1 ] && { echo "idle-refresh: global refresh working again" >&2; failing=0; }
      dirty=0
    elif [ "$failing" -eq 0 ]; then
      echo "idle-refresh: TriggerGlobalRefresh failed — ghosting will NOT be cleared: $err" >&2
      echo "idle-refresh: check 'systemctl status pinenote-dbus-service'" >&2
      failing=1
    fi
  fi
  sleep 1
done
