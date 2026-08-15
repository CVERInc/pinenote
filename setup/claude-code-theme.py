#!/usr/bin/env python3
"""Generate a Claude Code theme that lets each terminal choose the colours.

Claude Code exposes ~70 colour tokens. The version this replaced computed a
value for 66 of them — a hue solved onto this panel's six-value luma grid, so
that one theme could be read from a white-ground panel and a dark-ground colour
screen at once. It worked and it was the wrong shape: every mid-level role
ended up jammed onto one luma step, which on a colour screen reads as mud.

`dark-ansi`, Claude Code's own ANSI-only preset, does not name colours at all.
It names one of the sixteen ANSI slots per token and lets the terminal's palette
say what that is. That is the answer to the two grounds this repo kept trying to
reconcile inside one file: the colour machine's palette is already tuned by
whoever uses it, and this panel's palette is set by `setup/setup.sh` [3] to
`#000000` for slots 0–14 with `#FFFFFF` at 15. Every hue therefore arrives here
as crisp black on white with no dithering, for free, and none of it is our
arithmetic any more.

What is left is the handful of tokens where a slot's *role* and this panel's
ground disagree. That is what this file is: `dark-ansi` plus six overrides.

    python3 setup/claude-code-theme.py                # the config dir in use
    python3 setup/claude-code-theme.py --check        # what the panel paints
    python3 setup/claude-code-theme.py --swatch       # ask the terminal itself
    python3 setup/claude-code-theme.py --stdout       # print, write nothing

Claude Code reads its config from $CLAUDE_CONFIG_DIR, falling back to
~/.claude. Themes live in <config dir>/themes/<slug>.json and the directory is
watched, so a write lands in a running session — unless themes/ did not exist
when that session started, which needs one restart.

If you keep several accounts with clikae (github.com/CVERInc/clikae), each has
its own config dir and a theme installed in one is invisible to the others:

    python3 setup/claude-code-theme.py --tanks x,l    # named claude tanks
    python3 setup/claude-code-theme.py --all-tanks    # every one, plus ~/.claude
"""

import json
import os
import re
import sys
from pathlib import Path

SLUG = "lumalock"
BASE = "dark-ansi"

# 🔴 An override lands only if the key exists in the base preset AND the value
# parses. Anything else is dropped in silence — which is how the theme this
# replaced spent months setting `background`, a token Claude Code does not
# define. Accepted forms are `#rgb`, `#rrggbb`, `rgb(r,g,b)`, `ansi256(n)` and
# `ansi:<name>`; everything below stays in the last form on purpose, so that no
# value in this file outranks the palette of the terminal reading it.
ANSI_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan",
              "white", "blackBright", "redBright", "greenBright",
              "yellowBright", "blueBright", "magentaBright", "cyanBright",
              "whiteBright"]
SLOT = {name: i for i, name in enumerate(ANSI_NAMES)}

# Where the panel and `dark-ansi` disagree. Each entry says which slot the token
# has to move to and why, and every one of them is about this device: on a
# colour screen the inherited value was already fine.
OVERRIDES = {
    # 🔴 The one that decides whether the session is legible here at all.
    # `text` is slot 15, the only white in this panel's palette, because
    # dark-ansi assumes a dark ground. Here that is white on white.
    #
    # It moves to slot 7 rather than the palette's 15 moving to black: 15 is
    # every other TUI's reverse-video white and not ours to spend. On a colour
    # screen slot 7 is the palette's off-white instead of its pure white, which
    # is the only visible change this file makes there.
    "text": "ansi:white",
    # 🔴 `text` and the plate under it are one decision, not two. Inherited,
    # they pair as white-on-dark, which does survive this panel — as a solid
    # black band per message, which is the area accumulation the rest of this
    # repo exists to remove. So the pair is flipped rather than half-fixed:
    # text to slot 7 above, the plate onto slot 0, leaving the message unplated
    # here and plated there.
    #
    # 🔴 Every plate goes to slot 0 and nothing else, because slot 0 is the one
    # slot this panel can afford to paint white (setup.sh [3]). The version that
    # also whitened slot 8 was measured on the glass and was wrong: slot 8 is
    # where this whole ecosystem keeps dim text — Claude Code's own code
    # comments, git's secondary output — and whitening it deleted all of them.
    # A plate slot and a text slot are not interchangeable just because both
    # look dark on a dark screen.
    "userMessageBackground": "ansi:black",
    "memoryBackgroundColor": "ansi:black",
    "composerSidebarBackground": "ansi:black",
    # The empty half of the usage meter is slot 7 and the fill is slot 3, both
    # black here, so the meter read as full whatever it said.
    "rate_limit_empty": "ansi:black",
    # The one plate that stays on slot 8, and the exception proves the rule:
    # hover is a state that needs a pointer, so this panel can never enter it.
    # Only the colour screen ever draws this, and there slot 8 lifts one step
    # off slot 0 exactly as a hover should.
    "userMessageBackgroundHover": "ansi:blackBright",
    # Shimmer is the lighter half of an animated gradient. Setting each equal to
    # its own base value stops the repaint without disabling anything — the
    # spinner still spins. These two are also the remaining slot-15 tokens, so
    # the same line does both jobs.
    "promptBorderShimmer": "ansi:white",     # == promptBorder in dark-ansi
    "inactiveShimmer": "ansi:white",         # == inactive in dark-ansi
}

# ── The audit ────────────────────────────────────────────────────────────────
# `--check` answers "what does this panel paint each token as", which needs the
# base preset's slot per token. That table is a snapshot of somebody else's
# build and will rot; it is dated, and re-derivable in one line:
#
#   strings "$(readlink -f "$(which claude)")" | grep -o 'Y1b={[^}]*}'
#
# Only the tokens whose slot this panel can get wrong are listed — a fg on a
# white slot, or a plate on a black one. Read against Claude Code 2.1.233.
INHERITED = {  # token -> ansi slot name, from dark-ansi (2.1.233, 2026-08-15)
    "promptBorder": "white", "inactive": "white", "subtle": "white",
    "inverseText": "black", "clawd_background": "black",
    "bashMessageBackgroundColor": "black",
    "selectionBg": "blue", "rate_limit_fill": "yellow",
    "diffAdded": "green", "diffAddedDimmed": "green", "diffAddedWord":
    "greenBright", "diffRemoved": "red", "diffRemovedDimmed": "red",
    "diffRemovedWord": "redBright",
}

# What the palette has to be for any of the above to hold, measured on the glass
# on 2026-08-15 rather than reasoned about. This is the part of the audit that is
# about the device rather than about Claude Code: every other program on it draws
# with these slots too, and two of the three rules below were learnt by breaking
# them.
PALETTE_SHAPE = [
    (0, "#FFFFFF", "the plate slot: every background this theme sets lands "
                   "here, and a black plate is a solid band"),
    (8, "#000000", "dim text lives here — code comments, git's secondary "
                   "output. Whitening it deletes all of them at once"),
    (15, "#FFFFFF", "reverse video, which belongs to every other program"),
]

# Tokens that fill an area rather than draw a mark. The distinction is the whole
# audit: on a white ground a mark is broken when its slot is white, and a plate
# is broken when its slot is black.
PLATES = {"userMessageBackground", "userMessageBackgroundHover",
          "composerSidebarBackground", "bashMessageBackgroundColor",
          "memoryBackgroundColor", "selectionBg", "clawd_background",
          "rate_limit_empty",
          "diffAdded", "diffAddedDimmed", "diffAddedWord",
          "diffRemoved", "diffRemovedDimmed", "diffRemovedWord"}

# 🔴 Marks that never sit on the ground. `inverseText` is the label inside a
# coloured badge, and every badge slot is black here — so white is the right
# answer for it and the rule above is exactly inverted. A token is only broken
# against the surface it is actually painted on; the version of this audit that
# forgot that reported the one correct value in the file as the broken one.
ON_PLATE = {"inverseText"}

# Known, priced, and left alone — printed so they stay visible, not silenced.
# `rate_limit_fill` is deliberately absent: it is the filled part of the bar,
# a mark rather than a plate, and black on the white track is what it is for.
#
# 🔴 Photographed 2026-08-15: the diff rows below were predicted to come out as
# black bands and did not, because the numbered diff an auto-mode session draws
# paints no plate at all. The slot is still black and the token is still on it —
# what was wrong was the assumption that anything paints with it. They stay
# listed rather than deleted; a prediction that survives contact is worth less
# than one that gets corrected, and something else may yet draw them.
WATCH = {
    "userMessageBackgroundHover": "black here and meant to be: hover needs a "
                                  "pointer, so this device never draws it",
    "selectionBg": "still unobserved. The all-black drag-selection found on "
                   "the panel was tmux's copy-mode, not this token — and it "
                   "reads as white on black now that slot 0 is white",
    "diffAdded": "slots 1/2 stay black on purpose — see setup.sh [3]. "
                 "No plate observed on the numbered diff (2026-08-15)",
    "diffAddedDimmed": "same",
    "diffAddedWord": "same, word-level; the +/- gutter carries it",
    "diffRemoved": "same",
    "diffRemovedDimmed": "same",
    "diffRemovedWord": "same, word-level; the +/- gutter carries it",
}

SETUP_SH = Path(__file__).resolve().parent / "setup.sh"
TANK_ROOT = Path.home() / ".clikae" / "profiles" / "claude"


def panel_palette():
    """The sixteen values setup.sh writes, read from setup.sh.

    Not a copy of them. The palette is the other half of this theme, and two
    files that must agree are two files that will not.
    """
    text = SETUP_SH.read_text()
    m = re.search(r"gsettings set \"\$T\" palette \"\[(.*?)\]\"", text, re.S)
    if not m:
        sys.exit(f"no palette line in {SETUP_SH} — has [3] been rewritten?")
    values = re.findall(r"#[0-9A-Fa-f]{6}", m.group(1))
    if len(values) != 16:
        sys.exit(f"{SETUP_SH}: palette has {len(values)} values, expected 16")
    return [v.upper() for v in values]


def build():
    for token, value in OVERRIDES.items():
        if not value.startswith("ansi:") or value[5:] not in SLOT:
            sys.exit(f"{token}: {value} is not an ansi: name")
    return {"name": "Lumalock", "base": BASE, "overrides": dict(OVERRIDES)}


def check(theme):
    """Every token this panel can get wrong, and what it paints it as.

    The ground here is white and the default foreground is black, so a mark on a
    white slot is gone and a plate on a black slot is a solid band with black
    text on it. Both are invisible in a screenshot taken from the colour machine
    and both are obvious on the glass — which is what --swatch is for.
    """
    pal = panel_palette()

    shape = [(i, want, why) for i, want, why in PALETTE_SHAPE if pal[i] != want]
    for i, want, why in shape:
        print(f"🔴 slot {i} is {pal[i]}, has to be {want} — {why}")
    if shape:
        print()

    rows = [(t, v[5:], True) for t, v in theme["overrides"].items()]
    rows += [(t, s, False) for t, s in INHERITED.items()]

    print(f"{'token':30} {'slot':16} {'panel':8} {'kind':6}  verdict")
    broken, watched = 0, 0
    for token, name, ours in sorted(rows, key=lambda r: (not r[2], r[0])):
        drawn = pal[SLOT[name]]
        plate, white = token in PLATES, pal[SLOT[name]] == "#FFFFFF"
        if plate:
            verdict = "no plate" if white else "solid black band"
            wrong = not white
        elif token in ON_PLATE:
            verdict = "white on its badge" if white else "lost in its badge"
            wrong = not white
        else:
            verdict = "invisible on paper" if white else "black on paper"
            wrong = white
        if wrong:
            if token in WATCH:
                watched += 1
                verdict = "⚠️  " + verdict
            else:
                broken += 1
                verdict = "🔴 " + verdict
        kind = "plate" if plate else "mark"
        print(f"{'*' if ours else ' '}{token:29} {name:16} {drawn:8} "
              f"{kind:6}  {verdict}")

    if watched:
        print()
        for token, why in sorted(WATCH.items()):
            print(f"⚠️  {token:28} {why}")

    print("\n* = set by this file; the rest is inherited from "
          f"{BASE} and listed only where the panel can get it wrong.")
    print(f"{broken} unexplained, {watched} priced above."
          if broken else f"nothing unexplained; {watched} priced above.")
    print("\n⚠️  Arithmetic against setup.sh's palette. Marks and plates were "
          "photographed on\n    2026-08-15 and agreed; the terminal's own "
          "selection was checked by hand and\n    fixed there, not here. The "
          "usage meter and selectionBg remain unseen, and\n    --swatch is "
          "still the only thing that asks a real terminal.")


def swatch(theme):
    """Every token painted in its own slot, by the terminal in front of you.

    The audit above knows what this panel's palette says. It does not know what
    the terminal you are reading from says, and with an ANSI theme that is the
    only thing that decides. A row whose right half is missing is a token that
    cannot be seen here.
    """
    rows = [(t, v[5:], True) for t, v in theme["overrides"].items()]
    rows += [(t, s, False) for t, s in INHERITED.items()]
    print("\n  token                          slot              "
          "← painted in it →\n")
    for token, name, ours in sorted(rows, key=lambda r: (not r[2], r[0])):
        i = SLOT[name]
        fg = 30 + i if i < 8 else 90 + i - 8
        bg = fg + 10
        mark = "*" if ours else " "
        painted = (f"\033[{bg}m  {token}  \033[0m" if token in PLATES
                   else f"\033[{fg}m{token}\033[0m")
        print(f"  {mark}{token:29} {name:16}  {painted}")
    print("\n  Plates are painted as a background, marks as text. A row you "
          "cannot read\n  is a row this terminal cannot show.\n")


def current_config_dir():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))


def all_config_dirs():
    dirs = [Path.home() / ".claude"]
    if TANK_ROOT.is_dir():
        dirs += sorted(d for d in TANK_ROOT.iterdir() if d.is_dir())
    return dirs


def named_tanks(names):
    if not TANK_ROOT.is_dir():
        sys.exit(f"no clikae claude tanks at {TANK_ROOT}")
    have = sorted(p.name for p in TANK_ROOT.iterdir() if p.is_dir())
    dirs = []
    for n in names:
        if n not in have:
            sys.exit(f"no such tank: {n} (have: {', '.join(have)})")
        dirs.append(TANK_ROOT / n)
    return dirs


def resolve_targets(argv):
    if "--all-tanks" in argv:
        return all_config_dirs()
    for i, a in enumerate(argv):
        if a == "--tanks" and i + 1 < len(argv):
            return named_tanks(argv[i + 1].split(","))
        if a.startswith("--tanks="):
            return named_tanks(a.split("=", 1)[1].split(","))
    return [current_config_dir()]


if __name__ == "__main__":
    theme = build()
    if "--swatch" in sys.argv:
        swatch(theme)
    elif "--check" in sys.argv:
        check(theme)
    elif "--stdout" in sys.argv:
        print(json.dumps(theme, indent=2))
    else:
        payload = json.dumps(theme, indent=2) + "\n"
        for cfg in resolve_targets(sys.argv):
            out = cfg / "themes" / f"{SLUG}.json"
            fresh = not out.parent.is_dir()
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(payload)
            print(f"wrote {out}" + ("  (new themes/ — restart that one once)" if fresh else ""))
        print(f"{len(theme['overrides'])} overrides on {BASE}; "
              f"pick \"{theme['name']}\" in /theme")
