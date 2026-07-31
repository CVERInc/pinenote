#!/usr/bin/env python3
"""Codec for the PineNote off-screen image.

The kernel EBC driver loads /lib/firmware/rockchip/rockchip_ebc_default_screen.bin
and pushes it to the panel as the display powers down — the picture you are left
looking at while the device sleeps. It is a raw buffer, not an image format:

    1872 x 1404, 4 bits per pixel, two pixels per byte, high nibble first
    => exactly 1,314,144 bytes

Quantisation matches PNDeb's own /etc/off_and_suspend_screen/1_convert_png.py
(value // 17), so a PNG already reduced to the 16 levels 0, 17, ... 255 survives
encoding untouched. Feed it anything else and it is quantised a second time,
which is how a carefully dithered image turns back into banding.

    ./pnimg.py encode panel.png screen.bin   # PNG in panel orientation -> buffer
    ./pnimg.py decode screen.bin panel.png   # buffer -> PNG (to see what is in it)
    ./pnimg.py palette pal16.png             # the 16-level ramp to dither against
    ./pnimg.py selftest [stock.png stock.bin]   # verify against the stock PINE64 image

selftest defaults to the stock pair under /etc/off_and_suspend_screen/ — that is
on the device, and the device has no Pillow. Copy the two files to wherever you
run this and pass them as arguments instead:

    scp pinenote:/etc/off_and_suspend_screen/{Pinenotebg3.png,pn_bg_3.bin} .
    ./pnimg.py selftest Pinenotebg3.png pn_bg_3.bin
"""
import sys
from PIL import Image

PANEL_W, PANEL_H = 1872, 1404
NBYTES = PANEL_W * PANEL_H // 2

# The stock image ships as both PNG and buffer, which makes it a golden sample:
# encoding the one must reproduce the other byte for byte.
STOCK_PNG = "/etc/off_and_suspend_screen/Pinenotebg3.png"
STOCK_BIN = "/etc/off_and_suspend_screen/pn_bg_3.bin"


def encode(png_path, bin_path):
    im = Image.open(png_path).convert("L")
    if im.size != (PANEL_W, PANEL_H):
        raise SystemExit(f"expected {PANEL_W}x{PANEL_H}, got {im.size[0]}x{im.size[1]}")
    vals = [v // 17 for v in im.tobytes()]
    out = bytes((vals[i] << 4) | vals[i + 1] for i in range(0, len(vals), 2))
    assert len(out) == NBYTES, f"wrong output size: {len(out)}"
    with open(bin_path, "wb") as fh:
        fh.write(out)


def decode(bin_path, png_path):
    raw = open(bin_path, "rb").read()
    if len(raw) != NBYTES:
        raise SystemExit(f"expected {NBYTES} bytes, got {len(raw)}")
    vals = bytearray()
    for b in raw:
        vals.append((b >> 4) * 17)
        vals.append((b & 0x0F) * 17)
    Image.frombytes("L", (PANEL_W, PANEL_H), bytes(vals)).save(png_path)


def palette(png_path):
    im = Image.new("L", (16, 1))
    im.putdata([i * 17 for i in range(16)])
    im.save(png_path)


def selftest(png=STOCK_PNG, binary=STOCK_BIN):
    import filecmp
    import tempfile
    import os

    for p in (png, binary):
        if not os.path.exists(p):
            raise SystemExit(f"missing golden sample {p} — see --help for how to supply one")
    tmp = tempfile.mktemp(suffix=".bin")
    encode(png, tmp)
    ok = filecmp.cmp(binary, tmp, shallow=False)
    os.unlink(tmp)
    print("selftest:", "PASS — re-encoded the stock image byte for byte" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    mode = sys.argv[1]
    if mode == "selftest":
        sys.exit(selftest(*sys.argv[2:4]))
    if mode == "palette":
        palette(sys.argv[2])
    elif mode in ("encode", "decode"):
        (encode if mode == "encode" else decode)(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(__doc__)
