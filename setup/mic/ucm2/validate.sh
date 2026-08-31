#!/bin/bash
# Run the upstream UCM validator against our PineNote profile, on the PineNote.
#
# The validator loads libasound, so it only runs on the machine with ALSA --
# not on a mac. It has two passes and they answer different questions:
#   all      parses every profile in the tree, ours included (syntax)
#   configs  replays an alsa-info.sh dump to emulate the card and check the
#            profile against the controls and PCMs it actually has (semantics)
# The second is the one that catches a cset naming a control this board does
# not have, which is exactly the risk in a profile borrowed from a sibling board.
set -eu

W=${W:-$HOME/ucm-work}
mkdir -p "$W"
cd "$W"

[ -d alsa-ucm-conf ] || git clone -q --depth 1 https://github.com/alsa-project/alsa-ucm-conf
[ -d alsa-tests ]    || git clone -q --depth 1 https://github.com/alsa-project/alsa-tests

REPO=${REPO:-$HOME/pinenote}
SRC="$REPO/setup/mic/ucm2"
[ -d "$SRC" ] || { echo "no $SRC -- set REPO=/path/to/pinenote" >&2; exit 1; }

mkdir -p alsa-ucm-conf/ucm2/Rockchip/PineNote alsa-ucm-conf/ucm2/conf.d/simple-card
cp "$SRC/Rockchip/PineNote/PineNote.conf" "$SRC/Rockchip/PineNote/HiFi.conf" \
   alsa-ucm-conf/ucm2/Rockchip/PineNote/
ln -sf ../../Rockchip/PineNote/PineNote.conf \
   alsa-ucm-conf/ucm2/conf.d/simple-card/PineNote.conf

# The dump the validator emulates the card from, and which upstream wants as a
# file in alsa-tests, not as a PR attachment.
DUMP=alsa-tests/python/ucm-validator/configs/Rockchip/PineNote.txt
if [ ! -s "$DUMP" ]; then
  mkdir -p "$(dirname "$DUMP")"
  if [ -s /tmp/alsa-info.txt ]; then
    cp /tmp/alsa-info.txt "$DUMP"
  else
    echo "fetching alsa-info.sh"
    curl -sS -o /tmp/alsa-info.sh https://www.alsa-project.org/alsa-info.sh
    sh /tmp/alsa-info.sh --no-upload --output /tmp/alsa-info.txt >/dev/null 2>&1 || true
    [ -s /tmp/alsa-info.txt ] || { echo "alsa-info.sh produced nothing" >&2; exit 1; }
    cp /tmp/alsa-info.txt "$DUMP"
  fi
fi
echo "dump: $(wc -l < "$DUMP") lines"

cd alsa-tests/python/ucm-validator

# Neither pass aborts the script. Pass 1 is red on an untouched upstream tree
# (alsa-ucm-conf master carries a USB-Audio/USB-Audio.conf that alsa-tests
# master's parser rejects), so letting it stop us would hide the pass that
# actually judges this profile. Run both, report both, judge ours on pass 2.
set +e

echo
echo "=== pass 1: parse the whole tree (syntax) ==="
echo "    known red upstream, independently of this profile -- see UPSTREAM.md"
./ucm.py --level 0 all ../../../alsa-ucm-conf/ucm2 2>&1 | tail -3
p1=${PIPESTATUS[0]}
echo "pass 1 exit: $p1"

echo
echo "=== pass 2: emulate this card from the dump (semantics) ==="
echo "    this is the one that judges the PineNote profile"
./ucm.py --level 0 configs ../../../alsa-ucm-conf/ucm2 configs configs/Rockchip/PineNote.txt
p2=$?
echo "pass 2 exit: $p2  (0 and no output above = clean)"

exit $p2
