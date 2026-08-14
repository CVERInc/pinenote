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

SLUG = "lumalock"

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

# ── Hue, locked to those values ──────────────────────────────────────────────
# The six above are what the panel can draw. They are not what a colour screen
# has to be told. A colour and a grey of the same luma arrive at this panel as
# the same grey, so hue can be spent freely on the machines that have it as
# long as the luma never leaves the grid. That is the whole idea: colour is
# free where it exists and costs nothing where it does not.
#
# 🔴 Two different quantities, and using the wrong one puts a value on the
# wrong step. `luminance()` below is WCAG relative luminance, gamma-decoded,
# and it answers "is this readable" — keep using it for the contrast audit.
# What the panel does when it flattens a frame is a weighted sum of the
# gamma-encoded bytes, which is `luma()`. Rec.601 and Rec.709 disagree about
# the weights, so `tint()` solves against 601 and `--check` prints both; a
# colour is only accepted when the two land on the same step, which makes the
# exact formula in the driver something we do not have to know.
#
# ⚠️ Verified by arithmetic, not against the glass. Nothing here has been
# photographed off the panel yet. If a hue reads as the wrong step in use, the
# suspect is the driver's weights, not the role table.
HUES = {                       # direction only; tint() sets the level
    "red": (1.0, 0.05, 0.05),
    "green": (0.05, 1.0, 0.25),
    "amber": (1.0, 0.55, 0.0),
    "blue": (0.15, 0.35, 1.0),
    "violet": (0.65, 0.25, 1.0),
    "teal": (0.0, 0.75, 0.75),
    "pink": (1.0, 0.3, 0.6),
    "olive": (0.6, 0.6, 0.0),
}


def luma(value):
    """What the panel sees: Rec.601 over the gamma-encoded bytes, 0–255."""
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
    return 0.299 * r + 0.587 * g + 0.114 * b


def luma709(value):
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def tint(hue, step):
    """The named hue, at exactly `step`'s luma.

    Darken toward black while the hue is bright enough to reach the step on its
    own; past that there is no darkening left to do, so fade toward white. Both
    directions keep the hue and move only the level, which is what has to hold.
    """
    target = luma(step)
    base = HUES[hue]
    full = luma("#%02x%02x%02x" % tuple(round(c * 255) for c in base))
    if target <= full:
        t = target / full if full else 0.0
        rgb = [c * t * 255 for c in base]
    else:
        s = (target - full) / (255 - full)
        rgb = [(c + (1 - c) * s) * 255 for c in base]
    out = "#%02x%02x%02x" % tuple(max(0, min(255, round(c))) for c in rgb)
    # Rounding to bytes can move the luma by a level; nudge the channel with the
    # most leverage until it lands. Without this a value silently sits between
    # two steps and --check has to fail it.
    for _ in range(24):
        err = target - luma(out)
        if abs(err) < 0.5:
            break
        r, g, b = (int(out[i:i + 2], 16) for i in (1, 3, 5))
        g = max(0, min(255, g + (1 if err > 0 else -1)))
        out = "#%02x%02x%02x" % (r, g, b)
    return out

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
    # Status. This is where the hue lock pays for itself. These three used to be
    # ink and sunk with their wording left to say which was which, because grey
    # cannot carry red-versus-green. Held at sunk's luma they still cannot — the
    # panel gets one grey for all three, exactly as before — while a colour
    # screen gets the distinction back for nothing.
    "success": tint("green", SUNK),
    "error": tint("red", SUNK),
    "warning": tint("amber", SUNK),
    "merged": tint("violet", SLATE),
    # Input box and mode indicators. These are separators and borders, which is
    # what slate is for.
    "promptBorder": SLATE,
    "planMode": INK,
    "autoAccept": tint("teal", SUNK),
    "bashBorder": INK,
    "ide": tint("blue", SLATE),
    "fastMode": tint("amber", SUNK),
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
# as hues the panel resolves into greys nobody chose. Rotating three readable
# values keeps neighbours apart here; putting a hue on each keeps all eight
# apart on a screen that has hues, and the rotation still decides what the
# panel sees. These are static labels, not an animation, so unlike the shimmer
# pairs and the rainbow below there is no repaint to buy back.
SUBAGENT_CYCLE = [INK, SUNK, SLATE]
SUBAGENT_HUES = ["red", "blue", "green", "amber",
                 "violet", "olive", "pink", "teal"]
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
        step = SUBAGENT_CYCLE[i % len(SUBAGENT_CYCLE)]
        hue = SUBAGENT_HUES[i % len(SUBAGENT_HUES)]
        # Ink has no hue to give — a colour at luma 0 is black — so the first of
        # every three stays grey rather than pretending otherwise.
        ov[f"{name}_FOR_SUBAGENTS_ONLY"] = step if step == INK else tint(hue, step)
    for name in RAINBOW:
        ov[f"rainbow_{name}"] = INK
        ov[f"rainbow_{name}_shimmer"] = INK
    return {"name": "Lumalock", "base": "light", "overrides": ov}


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

    # The old audit asked whether every value was one of the six greys. With hue
    # in play the question is whether every value still *flattens* to one of
    # them — and whether it does so under either set of weights, since we do not
    # know which the driver uses. A value that lands on different steps under
    # 601 and 709 is one the panel could put anywhere, so it fails.
    steps = sorted({round(luma(v)) for v in (INK, SUNK, SLATE, SHADOW, WASH, PAPER)})

    def nearest(y):
        return min(steps, key=lambda s: abs(s - y))

    print(f"\n{'token':32} {'value':9} {'601':>5} {'709':>5}  step")
    bad = 0
    for token, value in sorted(theme["overrides"].items()):
        y6, y7 = luma(value), luma709(value)
        s6, s7 = nearest(y6), nearest(y7)
        off = abs(y6 - s6) > 1.5 or s6 != s7
        if off:
            bad += 1
        if value not in (INK, SUNK, SLATE, SHADOW, WASH, PAPER) or off:
            mark = f"  ✗ {'off-grid' if abs(y6 - s6) > 1.5 else '601/709 disagree'}" if off else ""
            print(f"{token:32} {value:9} {y6:5.1f} {y7:5.1f}  #{s6:02x}{mark}")
    print("\nluma locked to the grid:",
          "yes" if not bad else f"no — {bad} value(s) off")


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
