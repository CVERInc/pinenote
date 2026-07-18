#!/usr/bin/env bash
# PineNote 打字模式：A2 打字不閃 + 停手才清殘影
P=/sys/module/rockchip_ebc/parameters
set_p(){ echo "$2" | sudo tee "$P/$1" >/dev/null; }
set_p bw_mode 1                # BW+Dither：icon 保留層次
set_p default_waveform 1       # A2：打字不閃 ← GUI 選單給不了的關鍵
set_p refresh_waveform 4       # GC16：清除時用，醜但清得乾淨
set_p prepare_prev_before_a2 1 # A2 正確翻轉的必要開關
set_p auto_refresh 0           # 關掉面積累積清除，改由閒置腳本負責時機
echo "typing-mode applied"
