#!/usr/bin/env bash
# Turn a photograph into the picture the PineNote sleeps under.
#
#   ./make-offscreen.sh cat.jpg screen.bin
#   scp screen.bin pinenote:~/offscreen/screen.bin && ssh pinenote 'setup/setup.sh'
#
# Run it wherever ImageMagick lives (a laptop is fine) — nothing here needs the device.
# Needs: ImageMagick 7 (`magick`) and python3 with Pillow.
#
# ── Orientation ───────────────────────────────────────────────────────────────
# Two separate rotations, and confusing them costs an afternoon:
#
#   ROTATE     rotates your *photograph*, purely a framing choice. A 4:3 landscape
#              photo rotated 90° becomes 3:4 — which matches the 1404x1872 upright
#              frame exactly, so it fills the screen with nothing cropped and no
#              margins. That is the default, and it reads correctly when you hold
#              the device in landscape.
#   -flop -rotate 90   maps the upright frame onto the panel buffer. Fixed, not a
#              preference: the buffer is stored mirrored, and the stock PINE64
#              image only comes out readable with that exact pair. Verified
#              pixel-for-pixel against it — do not adjust it to taste.
#
# ── Tone, and why the defaults look like this ─────────────────────────────────
# 16 grey levels on a reflective panel is a harsher medium than it sounds. A white
# cat on a pale floor arrives with almost no separation (std ≈ 0.09), and e-ink's
# white reflects perhaps 40% — so anything that measures "fine" on a monitor comes
# out flat and grey in the hand.
#
#   CONTRAST   sigmoidal curve, pulls the subject off the background. The pivot
#              (the % after the comma) is the brightness that stays put; put it
#              just under the background so the background lifts rather than sinks.
#   WHITE      white point. Lowering it brightens — but it brightens by pushing
#              highlights to pure white, and that is where fur detail dies first.
#   GAMMA      brightens the midtones instead, which is where "grey" actually
#              lives. It lifts the blacks too, hence:
#   BLACK      black point, clawing back the darkest few percent that GAMMA lifted.
#              Without it the one genuinely dark thing in the frame stops anchoring
#              the picture.
#
# The script prints the distribution it produced. Judge by those numbers, not by
# your monitor: median is "how grey", near-white is "how much detail got flattened",
# and p1 is whether anything still reads as black.
set -e

SRC="${1:?usage: make-offscreen.sh <image> [output.bin]}"
OUT="${2:-screen.bin}"

ROTATE="${ROTATE:-90}"
CONTRAST="${CONTRAST:-7,65%}"
BLACK="${BLACK:-4%}"
WHITE="${WHITE:-84%}"
GAMMA="${GAMMA:-1.25}"
SHARPEN="${SHARPEN:-0x1.2+0.7+0.01}"

command -v magick >/dev/null || { echo "need ImageMagick 7 (magick)"; exit 1; }
D="$(cd "$(dirname "$0")" && pwd)"
python3 -c "import PIL" 2>/dev/null || { echo "need python3 Pillow"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The 16 levels the buffer can hold. Dithering against exactly these means the
# encoder's own quantisation is a no-op instead of a second, undithered pass.
python3 "$D/pnimg.py" palette "$TMP/pal16.png"

magick "$SRC" -auto-orient -rotate "$ROTATE" -colorspace Gray \
  -sigmoidal-contrast "$CONTRAST" -level "$BLACK","$WHITE" -gamma "$GAMMA" \
  -resize '1404x1872!' -unsharp "$SHARPEN" \
  -dither FloydSteinberg -remap "$TMP/pal16.png" -depth 8 "$TMP/upright.png"

magick "$TMP/upright.png" -flop -rotate 90 "$TMP/panel.png"
python3 "$D/pnimg.py" encode "$TMP/panel.png" "$OUT"

python3 - "$TMP/upright.png" "$OUT" <<'PY'
import sys
from PIL import Image
d = sorted(Image.open(sys.argv[1]).convert("L").getdata()); n = len(d)
levels = len(set(d)); stray = sum(1 for v in set(d) if v % 17)
print(f"wrote {sys.argv[2]}")
print(f"  levels {levels}/16, off-ramp values {stray} (must be 0)")
print(f"  p1 {d[n//100]}  median {d[n//2]}  mean {sum(d)//n}")
print(f"  reads as black {sum(1 for v in d if v <= 51)/n*100:.1f}%   "
      f"near-white {sum(1 for v in d if v >= 238)/n*100:.1f}%")
PY
