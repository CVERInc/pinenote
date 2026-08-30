#!/usr/bin/env bash
# The core behaviour of Typing Mode: never interrupt typing, clear ghosting only
# when the hands stop.
# A2 keeps typing smooth; clear once after IDLE_MS milliseconds of rest.
#
# 2026-08-12: The clear method changed from a full-screen flash to **complementary
# dither** (the pn-wave extension's Clear).
#   Half the pixels flip to black, the other half white, swapping on the next frame
#   => every pixel receives a full black<->white swing (pixel-for-pixel equivalent
#   to a full flash), but the screen's mean luminance stays at mid-grey throughout,
#   never flipping entirely.
#   Discomfort comes from the entire visual field changing brightness at once, not
#   from the clearing itself.
#   🔴 The fallback must stay: if the extension fails to load it must fall back to
#      TriggerGlobalRefresh, or it becomes "quietly clearing nothing" — which is
#      how this script broke once historically.
#
# 🔴 This script once broke in two places simultaneously, both silently
#    (found on 2026-07-23):
#
#  1. Idle time was extracted using `grep -oE "[0-9]+"` from `(uint64 342896,)` —
#     **the 64 in "uint64" was extracted too**, making $idle two lines, so every
#     comparison yielded "integer expression expected".
#     On the previous boot this error alone fired 173,975 times, all resting quietly
#     in the journal unread.
#     => Idle detection never worked from the day it was installed. Ghosting was
#        never cleared once.
#  2. The dbus line was suffixed with `2>/dev/null`. When pinenote-dbus-service
#     panicked, this script shouted into the void for three days, succeeding
#     silently every time.
#
# Therefore: parsing must be precise (match the number after uint64, not just any
# number), and failures must be loud (but only once upon state transition, to avoid
# producing another 170,000 unread lines).
IDLE_MS=${1:-3000}
# The second trigger: continuous scrolling never pauses for as long as IDLE_MS,
# so it would never be cleared.
# (The kernel's auto_refresh used to handle this half, but it only produces the
# stock flash, so it is turned off.)
# After STALE_MS has elapsed since the last clear, it switches to a **much
# shorter** pause threshold, SOFT_IDLE_MS.
# 🔑 Why not clear directly while active: clearing overlays 1.4 seconds on the
#    screen you are reading. Picking a natural micro-pause (there is always one
#    between two swipes) completely avoids interrupting any action.
STALE_MS=${2:-90000}
SOFT_IDLE_MS=${3:-1500}
dirty=0
failing=0
warned_parse=0
used_fallback=0
soft_hits=0
in_grey=0

now_ms() { date +%s%3N; }

# Greyscale mode (bw_mode=0) does not need us to clear.
#
# That tone button toggles more than just tone: it also changes the default
# waveform to GC16, and GC16 is a complete reset waveform — so **every screen
# update is itself a clear**, and ghosting cannot accumulate. Injecting a
# visible 1.4-second dither clear in that mode is clearing a screen that is
# already clean.
# Black-and-white mode uses A2: fast and quiet, but it accumulates, which is
# why this script exists.
#
# Reading sysfs rather than D-Bus: once a second, it needs to be cheap.
GREY_ONLY_PARAM=/sys/module/rockchip_ebc/parameters/bw_mode
greyscale() { [ "$(cat "$GREY_ONLY_PARAM" 2>/dev/null)" = "0" ]; }

# The decision is extracted into a pure function so it can be tested — both
# historical defects in this script were "a branch was never taken".
# Returns: 0=no clear 1=normal pause 2=stale, accept short pause
decide() {  # dirty idle stale
  [ "$1" -eq 1 ] || { echo 0; return; }
  [ "$2" -ge "$IDLE_MS" ] && { echo 1; return; }
  [ "$3" -ge "$STALE_MS" ] && [ "$2" -ge "$SOFT_IDLE_MS" ] && { echo 2; return; }
  echo 0
}

# When called by --selftest, only test the decision table, do not touch the screen
if [ "${1:-}" = "--selftest" ]; then
  IDLE_MS=8000; STALE_MS=90000; SOFT_IDLE_MS=1500
  fail=0
  check() { r=$(decide "$1" "$2" "$3")
            if [ "$r" = "$4" ]; then echo "  ✓ dirty=$1 idle=$2 stale=$3 → $r  ($5)"
            else echo "  ✗ dirty=$1 idle=$2 stale=$3 → $r, expected $4 ($5)"; fail=1; fi; }
  echo "Decision table:"
  check 0 20000 999999 0 "Not dirty means no clear, regardless of duration"
  check 1  9000     0  1 "General rule: paused long enough"
  check 1  2000     0  0 "Pause too short and not stale → no clear"
  check 1  2000 95000  2 "Stale: short pause is sufficient ← this is new, scrolling relies on it"
  check 1  1000 95000  0 "Stale but lacks short pause (finger still moving) → still no clear"
  check 1  9000 95000  1 "Qualifies as general rule when both apply"
  exit $fail
fi

clear_screen() {
  # Try dither clear first; if missing, fall back to stock full flash and **say so**.
  if out=$(gdbus call --session --dest net.cver.PnWave \
             --object-path /net/cver/PnWave \
             --method net.cver.PnWave.Clear "{}" 2>&1); then
    [ "$used_fallback" -eq 1 ] && {
      echo "idle-refresh: pn-wave returned, switching to dither clear" >&2; used_fallback=0; }
    return 0
  fi
  if [ "$used_fallback" -eq 0 ]; then
    echo "idle-refresh: pn-wave failed ($out), falling back to full-screen flash" >&2
    used_fallback=1
  fi
  dbus-send --system --dest=org.pinenote.ebc /ebc \
            org.pinenote.ebc.TriggerGlobalRefresh 2>&1
}

last_clear=$(now_ms)
while true; do
  raw=$(gdbus call --session --dest org.gnome.Mutter.IdleMonitor \
    --object-path /org/gnome/Mutter/IdleMonitor/Core \
    --method org.gnome.Mutter.IdleMonitor.GetIdletime 2>/dev/null)
  idle=$(printf '%s' "$raw" | sed -n 's/.*uint64 \([0-9]*\).*/\1/p')

  # Do not force the comparison if a clean integer was not parsed — that is exactly
  # what caused the previous version to spew two errors a second.
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

  # The maintenance strategy switches the moment the tone button is pressed.
  # Speak once, do not spam — otherwise, if this guard ever misreads the parameter,
  # the symptom is "clearing silently stops", exactly how this script broke before.
  if greyscale; then
    [ "$in_grey" -eq 0 ] && {
      echo "idle-refresh: Greyscale mode (GC16 clears itself on every update) → suspending clear" >&2; in_grey=1; }
    dirty=0
    last_clear=$(now_ms)
    sleep 1
    continue
  fi
  [ "$in_grey" -eq 1 ] && {
    echo "idle-refresh: Returned to black and white mode (A2 accumulates) → resuming clear" >&2; in_grey=0; }

  stale=$(( $(now_ms) - last_clear ))
  why=$(decide "$dirty" "$idle" "$stale")
  if [ "$why" -ne 0 ]; then
    if err=$(clear_screen); then
      [ "$failing" -eq 1 ] && { echo "idle-refresh: clearing works again" >&2; failing=0; }
      # Only the new rule speaks, and at most once per STALE_MS — it will not spam.
      [ "$why" -eq 2 ] && {
        soft_hits=$((soft_hits + 1))
        echo "idle-refresh: Uncleared for a long time (${stale}ms), clearing during ${idle}ms micro-pause"\
             "(Count $soft_hits)" >&2; }
      dirty=0
      last_clear=$(now_ms)
    elif [ "$failing" -eq 0 ]; then
      echo "idle-refresh: Clear failed — ghosting will not be removed: $err" >&2
      echo "idle-refresh: check 'systemctl status pinenote-dbus-service'" >&2
      failing=1
    fi
  fi
  sleep 1
done
