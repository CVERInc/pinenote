#!/usr/bin/env python3
"""Generate a Claude Code theme drawn only in the panel's six values.

Claude Code exposes ~60 colour tokens. Setting them one at a time in `/theme`
is how you end up with three of them set and the rest inherited from a screen
theme — so this derives all of them from the six values in the README and one
role table. Change a role, regenerate; never hand-edit the JSON.

    python3 setup/claude-code-theme.py                # the config dir in use
    python3 setup/claude-code-theme.py --check        # contrast + off-grid audit
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
import sys
from pathlib import Path

SLUG = "pinenote"

# The six values, verbatim from the README. The panel has sixteen levels — 0 to
# 255 in steps of 17 — so a grey is on the grid exactly when it is writable as
# #NNN. Anything else is quantised on its way to the panel and mid-tones turn
# into noise. These six are a vocabulary of roles, not a brightness ramp.
INK = "#000"     # text, emphatic borders, icons
SUNK = "#333"    # components that recede
SLATE = "#777"   # separators, secondary containers, disabled states
SHADOW = "#aaa"  # container beds, panel beds
WASH = "#ddd"    # the faintest emphasis, sitting on paper
PAPER = "#fff"   # ground, foreground components

# Token -> value. Claude Code's own token names on the left, so this table reads
# against the colour reference in its docs; the six roles on the right, so it
# reads against the README. Anything not listed falls through to the `light`
# base preset.
ROLES = {
    # Text and accent. On paper there is nothing brighter than ink to make an
    # accent out of, so hierarchy is built by receding, never by standing out.
    "text": INK,
    "claude": INK,
    "inverseText": PAPER,
    "inactive": SUNK,
    "subtle": SLATE,
    "suggestion": INK,
    "permission": INK,
    "remember": SUNK,
    # Status. Grey cannot carry red-versus-green, so success and error both go
    # to ink and let their own wording say which it is.
    "success": INK,
    "error": INK,
    "warning": SUNK,
    "merged": SLATE,
    # Input box and mode indicators. These are separators and borders, which is
    # what slate is for.
    "promptBorder": SLATE,
    "planMode": INK,
    "autoAccept": SUNK,
    "bashBorder": INK,
    "ide": SLATE,
    "fastMode": SUNK,
    # Speaker labels and the usage meter
    "briefLabelYou": SLATE,
    "briefLabelClaude": INK,
    "rate_limit_fill": SUNK,
    "rate_limit_empty": WASH,
}

# Diff backgrounds. Six values and no hue: added and removed cannot both be
# faint and still be told apart, so they are staggered one step and the +/-
# gutter carries the rest. Context lines get no plate at all — on e-ink an
# unpainted line is also one less area to refresh.
DIFF = {
    "diffAddedDimmed": PAPER,
    "diffAdded": WASH,
    "diffAddedWord": SHADOW,
    "diffRemovedDimmed": PAPER,
    "diffRemoved": SHADOW,
    "diffRemovedWord": SLATE,
}

# Fullscreen mode plates. wash is a thirteen-percent dot pattern in
# black-and-white mode, which is why it is used for areas here and never for a
# hairline.
SURFACES = {
    "userMessageBackground": WASH,
    "userMessageBackgroundHover": SHADOW,
    "bashMessageBackgroundColor": WASH,
    "memoryBackgroundColor": WASH,
    "selectionBg": SHADOW,
}

# Every shimmer token is the lighter half of an animated gradient. Setting each
# one to its own base value stops the animation without disabling anything: the
# spinner still spins, it just stops repainting a region of e-ink to do it.
SHIMMER_PAIRS = ["claude", "warning", "permission", "promptBorder", "inactive",
                 "fastMode", "autoAccept"]

# Eight named colours distinguish concurrent subagents. Left alone they arrive
# as hues the panel resolves into greys nobody chose; three readable values in
# rotation at least keeps neighbours apart.
SUBAGENT_CYCLE = [INK, SUNK, SLATE]
SUBAGENT_COLORS = ["red", "blue", "green", "yellow",
                   "purple", "orange", "pink", "cyan"]

# The seven-colour gradient behind `ultrathink`, flattened. It is the most
# expensive element on the screen and the least legible one here.
RAINBOW = ["red", "orange", "yellow", "green", "blue", "indigo", "violet"]

# Judged at 3:1 rather than 4.5:1, because none of these is prose. The speaker
# labels are here on purpose: they repeat above every message, and which one it
# is comes from the word itself — the value only has to separate them, so slate
# at 4.48 is the right answer rather than a rounding error to argue with.
UI_ONLY = {"promptBorder", "subtle", "ide", "merged", "briefLabelYou"}
# One track, meant to recede until the fill crosses it.
DECORATIVE = {"rate_limit_empty"}

TANK_ROOT = Path.home() / ".clikae" / "profiles" / "claude"


def build():
    ov = dict(ROLES)
    ov.update(DIFF)
    ov.update(SURFACES)
    for base in SHIMMER_PAIRS:
        ov[base + "Shimmer"] = ov[base]
    for i, name in enumerate(SUBAGENT_COLORS):
        ov[f"{name}_FOR_SUBAGENTS_ONLY"] = SUBAGENT_CYCLE[i % len(SUBAGENT_CYCLE)]
    for name in RAINBOW:
        ov[f"rainbow_{name}"] = INK
        ov[f"rainbow_{name}_shimmer"] = INK
    return {"name": "PineNote", "base": "light", "overrides": ov}


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


def luminance(value):
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)

    def chan(n):
        n /= 255
        return n / 12.92 if n <= 0.03928 else ((n + 0.055) / 1.055) ** 2.4

    r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast(fg, bg):
    hi, lo = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def check(theme):
    print(f"{'token':32} {'value':7} {'on paper':>9}")
    for token in sorted(ROLES):
        if token == "inverseText":
            continue
        value = theme["overrides"][token]
        ratio = contrast(value, PAPER)
        if token in DECORATIVE:
            note = "  decorative"
        else:
            floor = 3.0 if token in UI_ONLY else 4.5
            note = ("  border, 3:1" if token in UI_ONLY else "") \
                if ratio >= floor else f"  ✗ under {floor}:1"
        print(f"{token:32} {value:7} {ratio:8.2f}:1{note}")

    print(f"\n{'plate':32} {'value':7} {'ink on it':>9}")
    for token, value in {**DIFF, **SURFACES}.items():
        ratio = contrast(INK, value)
        flag = "" if ratio >= 4.5 else "  ✗ too dark to read ink on"
        print(f"{token:32} {value:7} {ratio:8.2f}:1{flag}")

    six = {INK, SUNK, SLATE, SHADOW, WASH, PAPER}
    stray = {t: v for t, v in theme["overrides"].items() if v not in six}
    print("\nsix values only:",
          "yes" if not stray else f"no — {len(stray)} stray: {list(stray.items())[:5]}")


if __name__ == "__main__":
    theme = build()
    if "--check" in sys.argv:
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
        print(f"{len(theme['overrides'])} tokens; pick \"{theme['name']}\" in /theme")
