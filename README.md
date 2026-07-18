# PineNote Setup（dogfood）

PineNote 記錄／重放**自己**的調教。目標：把乾淨的 PNDeb os1 調成
「護眼 SSH 終端 ＋ 保留手寫 GNOME（Xournal++/Wacom）」的一機二職，
不必另建 os2。

## 用法
```sh
./setup.sh    # 冪等，可重複跑；乾淨重刷 / 將來若建 os2 也一跑重放
```

## 現狀（2026-07-18 起步）
- ✅ 已固化：SSH server、關閉閒置休眠（SSH 生命線）、gnome-terminal 護眼、
  apt 地基（hold GNOME 48）、常用工具。
- ⏳ 待調（要盯螢幕）：e-ink 波形（治打字全螢幕刷）、藍牙 K6 卡頓、suspend。見 `setup.sh` 末 TODO。

## 保險
- 本地 git（這裡）。⏳ **待設**：push 到 GitHub 當異地備援 —— 用 PineNote **專用 deploy key**
  （只授權這一個 repo，裝置遺失也只影響它，不碰整個帳號）。在那之前這 repo 只在 os1、無備援。
- 不可逆的 VCOM=1.17V 已另備份於 `~/vcom-backup.txt`。

## 紀律
- 🔴 不跑 `full-upgrade`（GNOME 48 有開機災難前例；PNDeb key 每 1-6 月過期＝維護稅）。
- 設定層（波形/護眼/dotfiles）放心改，git 可回滾；動 kernel/bootloader 屬高風險，留最後。
- 🔴 穩定度是否決門：硬體若隨機崩，一切白搭 → 先觀察期、再決定深耕還是 RMA。
