#!/usr/bin/env bash
# PineNote 打字模式：A2 打字不閃 + 兩個正交的清除觸發器
P=/sys/module/rockchip_ebc/parameters
set_p(){ echo "$2" | sudo tee "$P/$1" >/dev/null; }
set_p bw_mode 1                # BW+Dither：icon 保留層次
set_p default_waveform 1       # A2：打字不閃 ← GUI 選單給不了的關鍵
set_p refresh_waveform 4       # GC16：清除時用，醜但清得乾淨
set_p prepare_prev_before_a2 1 # A2 正確翻轉的必要開關

# 清除有兩個觸發器，管的是兩種不同的情境，缺一不可：
#   ① 時間軸 — idle-refresh.sh：停手 8 秒清一次。管打字、管讀完一頁停下來。
#   ② 面積軸 — 核心 auto_refresh：累積滿 threshold 個「整片螢幕」就自己清。
#      管連續捲動與翻頁——那些每一下都弄髒接近一整片，8 秒的閒置永遠等不到。
#
# 🔴 當初 auto_refresh 被設成 0，是因為「打字累積不到門檻」——那個觀察沒錯，
#    但結論下太寬：打字一個字約 0.0001 片，捲動一次約 1 片，差三個數量級。
#    同一個門檻對兩者自動成立，關掉它等於把捲動那半也一起丟了。
# threshold 的單位是「整片螢幕的倍數」，對翻頁式閱讀約等於「幾頁洗一次」。
# 原廠 20 是給 evince/xournalpp 那種一直重畫的 app 用的，翻頁閱讀要翻二十頁。
# 4 是維護者實測選的（體感約三頁一次）。
set_p auto_refresh 1
set_p refresh_threshold 4
echo "typing-mode applied"
