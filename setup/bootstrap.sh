#!/usr/bin/env bash
# 一行重現 PineNote 調教（乾淨機器 / 重刷後 / 將來的 os2）：
#   curl -sL https://raw.githubusercontent.com/CVERInc/pinenote/main/bootstrap.sh | bash
set -e
REPO="${PN_SETUP_REPO:-https://github.com/CVERInc/pinenote.git}"
DIR="$HOME/pinenote-setup"
command -v git >/dev/null 2>&1 || sudo apt-get install -y git
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR" && ./setup.sh
echo "✅ PineNote 調教已重現"
