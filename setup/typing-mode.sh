#!/usr/bin/env bash
# PineNote typing mode: flashless A2 typing + two orthogonal clear triggers
P=/sys/module/rockchip_ebc/parameters
set_p(){ echo "$2" | sudo tee "$P/$1" >/dev/null; }
# 🔴 bw_mode and default_waveform are deliberately **not** set here.
#
# They belong to the tone button on the panel (values held in pnhelper's gsettings,
# applied at login). Writing them here again means two processes race for the same two
# parameters at boot, and the last write wins. We saw greyscale survive a reboot once,
# but it won a race rather than winning by design, and the next boot was not
# guaranteed.
#
# Initial boot values are given by /etc/modprobe.d/rockchip_ebc.conf. Upstream's
# _change_bw_mode pairs A2 and GC16 on its own.
set_p refresh_waveform 4       # GC16: used for clearing, ugly but thorough
set_p prepare_prev_before_a2 1 # Required toggle for proper A2 inversion

# Clearing has two triggers. They cover two different paths, and both are needed:
#   1. Time — idle-refresh.sh: clears after 8 seconds of idle. It catches typing,
#      or a pause at the end of a page.
#   2. Area — kernel auto_refresh: clears once threshold screen areas accumulate.
#      It catches continuous scrolling and page turns — updates that redraw most of
#      the screen and never wait 8 seconds.
#
# 🔴 auto_refresh used to be set to 0 here because "typing never hits the threshold".
#    That measurement was correct, but the conclusion was too broad: typing a
#    character repaints 0.0001 screens, and scrolling repaints 1 screen. They are
#    separated by three orders of magnitude, so the same threshold works for both.
#    Turning it off threw away the scrolling half.
#
# The threshold unit is screen areas, which maps to pages read. The stock 20
# assumes apps like evince/xournalpp that redraw continuously; reading a book
# took 20 pages to clear. 4 was chosen after testing (roughly every three pages).
set_p auto_refresh 0
set_p refresh_threshold 4
echo "typing-mode applied"
