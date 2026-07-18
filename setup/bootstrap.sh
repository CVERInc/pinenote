#!/usr/bin/env bash
# One line on a clean PineNote:
#   curl -sL https://raw.githubusercontent.com/CVERInc/pinenote/main/setup/bootstrap.sh | bash
set -e
REPO="${PINENOTE_REPO:-https://github.com/CVERInc/pinenote.git}"
DIR="$HOME/pinenote"
command -v git >/dev/null 2>&1 || sudo apt-get install -y git
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR/setup" && ./setup.sh
echo "✅ PineNote setup applied"
