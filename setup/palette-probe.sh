#!/bin/bash
# One row per colour mechanism, printed into whatever terminal you run it in.
#
# A palette audit can tell you what a slot is set to. It cannot tell you which
# mechanism a program used to ask for a colour, and on this panel that is the
# only question that matters: slot 8 and a truecolor grey look identical on a
# desktop and land on opposite sides of legible here. Every row is labelled in
# plain text, so a row that disappears still has a number next to it.
#
# Run it over SSH into the panel's own terminal — not a fresh one you launched
# to test with — and photograph the result. What it found on 2026-08-15:
# [2] gone entirely (slot 8 had been whitened for plates, which cost every code
# comment on the device), [3] gone by design, [5] and [6] faint, the rest fine.
#
#   ssh pinenote                      # then, in the terminal on the glass:
#   bash setup/palette-probe.sh
#
# Under tmux the rows still tell you the truth about the terminal underneath;
# [8] is there because tmux paints its own selection with those two colours, and
# a selection you cannot read is the failure this card was written for.
clear
printf '\n  WHICH OF THESE CAN YOU READ\n\n'
printf '  [1] \033[37mSGR 37 . slot 7 . white\033[0m\n'
printf '  [2] \033[90mSGR 90 . slot 8 . blackBright . dim text lives here\033[0m\n'
printf '  [3] \033[30mSGR 30 . slot 0 . black . the plate slot\033[0m\n'
printf '  [4] \033[2mSGR 2 .. dim, a blend and not a slot\033[0m\n'
printf '  [5] \033[38;5;244mSGR 38;5;244 . ansi256 grey\033[0m\n'
printf '  [6] \033[38;2;136;136;136mSGR 38;2;136;136;136 . truecolor 888888\033[0m\n'
printf '  [7] \033[7mSGR 7 .. reverse video\033[0m\n'
printf '  [8] \033[43;30m bg=yellow fg=black . tmux mode-style \033[0m\n'
printf '  [9] plain, no escape at all\n\n'
