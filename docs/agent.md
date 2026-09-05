# The agent it codes with

Part of [pinenote](../README.md).

`setup/claude-code-theme.py`, which writes a theme called **Lumalock** — six
overrides on `dark-ansi`, Claude Code's own ANSI-only preset. It used to be
sixty-six computed colours, and why it is not any more is the useful half of
this section.

Claude Code has around seventy colour tokens. Setting them by hand through its
`/theme` picker is a job nobody finishes — the version this all replaced had
three set, one of which was `background`, not a token it defines, silently
ignored since the day it was written. That is the general rule and not an
anecdote: **an override lands only if the key exists in the base preset and the
value parses, and anything else is dropped without a word.** A theme file is
one of the few places where a typo produces no error, no fallback and no
symptom, so it is generated from one table rather than hand-edited.

## The palette is the theme

The version before this one computed a value for every token: a hue solved onto
this panel's six-value luma grid, so that a single file could be read from a
white-ground panel and a dark-ground colour screen at once. The arithmetic held.
The shape was wrong. Only the middle of the range survives both grounds, so
every role that draws a mark ended up on one luma step — and a screen with
colour got a palette that was picked to survive a screen without one. It read
as mud there, which is a fair description of what it was.

`dark-ansi` names no colours at all. Each token gets one of the sixteen ANSI
slots and the *terminal's* palette says what that slot is. The two grounds
therefore stop needing to be reconciled inside one file — the colour machine's
palette is already tuned by whoever reads it, and this panel's is set by
`setup.sh` [3]. Nothing here is our arithmetic any more; every hue arrives as
crisp black on white, undithered, for free.

That turns the palette into the interesting file. Sixteen slots, and this panel
gets three answers rather than one:

| slots | | why |
|---|---|---|
| 1–14 | `#000000` | everything that draws a mark. Colour is information a 1-bit panel cannot hold, so it is spent rather than dithered — syntax highlighting included. |
| 0 | `#FFFFFF` | the plate slot, and the only one. Every background this theme sets is pointed at it. Left black a plate is a solid band with black text on it, and a large black area is the accumulation the rest of this repo exists to remove. White means *no plate*, which is the same judgement as leaving diff context lines unpainted. |
| 15 | `#FFFFFF` | reverse video, which belongs to every other program on the device and is not ours to spend. |

🔴 **Slot 8 is not a plate slot, however dark it looks on a dark screen.** An
earlier version of this file whitened 0 and 8 together, on the reasoning that
both are "almost only ever backgrounds". Measured on the glass, slot 8 is where
this entire ecosystem keeps dim text — Claude Code's own code comments, git's
secondary output, every `--dim` in every tool — and whitening it deleted all of
them at once, silently, on a device whose whole point is reading text. Slot 0 can
be spent because the only thing that draws marks with it is `inverseText`, and
that is always inside a badge the panel paints black.

## The eight overrides

What is left is the handful of tokens whose slot and this panel's ground
disagree. Each is about this device; on a colour screen the inherited value was
already right.

| token | to | why |
|---|---|---|
| `text` | slot 7 | It is slot 15 in `dark-ansi`, which assumes a dark ground. Here that is white on white. Slot 7 rather than repainting slot 15, because 15 belongs to everyone else; the cost is the palette's off-white instead of its pure white on a colour screen, and that is the only visible change this file makes there. |
| `userMessageBackground` | slot 0 | 🔴 The same decision as the line above, not a second one. |
| `memoryBackgroundColor` | slot 0 | Inherited on slot 8, which is a text slot here. |
| `composerSidebarBackground` | slot 0 | Same. |
| `rate_limit_empty` | slot 0 | Track and fill were both black slots, so the meter read as full at any value. |
| `userMessageBackgroundHover` | slot 8 | The one plate left on a text slot, and the exception proves the rule: hover needs a pointer, so this device never draws it. Only the colour screen sees this, and there slot 8 lifts one step off slot 0 exactly as a hover should. |
| `promptBorderShimmer` | slot 7 | Equal to its own base value. |
| `inactiveShimmer` | slot 7 | Equal to its own base value. |

`text` and the plate under it are one decision. Inherited, they pair as white on
dark — which does survive this panel, as a solid black band per message. Fixing
either one alone breaks the other, so the pair is flipped rather than
half-fixed: black text, no plate here; off-white text on a dark plate there.

The last two are the one rule that outlived the rewrite. Every `*Shimmer` token
is the lighter half of an animated gradient — the spinner, and the seven-colour
ramp behind `ultrathink`. Setting the pair equal stops the repaint without
disabling anything; the spinner still spins. This is the same flash the rest of
the repo exists to remove, arriving one layer up. It costs nothing on a colour
screen, and those two happened to be the remaining slot-15 tokens, so one line
does both jobs.

## What is still wrong here, on purpose

**Diff plates are black bands.** Added and removed are slots 2 and 1, and
whitening those two would fix Claude Code's diff at the price of red and green
turning from black into *nothing* in `git`, `ls` and `grep` — a slot is the
whole device's, not one program's. The trade is not close, so the slots stay
black and the diff plates stay wrong. If they turn out to be unreadable on the
glass, the next move is to override the plates onto slots 0 and 8, which costs
the colour screen its red-and-green diff and is a real loss rather than a free
one.

**Selection may be unreadable.** `selectionBg` is slot 4 and the text on it is
black too. Reverse video wants a dark plate on a white ground, which is exactly
what slot 15 exists for and exactly what a theme cannot reach.

`--check` prints both of those as ⚠️ rather than 🔴, next to every other token
this panel can get wrong: what slot it is on, what the palette paints it as,
whether it is a mark or a plate, and therefore whether it survives. It reads the
palette out of `setup.sh` rather than keeping a copy — two files that must agree
are two files that will not. Its own ruler was wrong once and worth recording:
the first version scored `inverseText` as broken, which is the one token in the
file that is never painted on the ground at all. A token is only broken against
the surface it is actually painted on.

That is arithmetic against a palette file, not photography. `--swatch` is the
other half: it paints every token in its own slot and asks the terminal actually
in front of you, which with an ANSI theme is the only thing that decides. A row
you cannot read is a row that device cannot show.

## What the glass said

Photographed on 2026-08-15, through the panel's own D-Bus capture, on a session
that was already running rather than one launched to be photographed. Body text,
prompt border, mode line and the message that had just been sent all came out
black on paper with no plate under any of them — which is what the table above
predicts and is worth exactly as much as any prediction that is finally checked.

The thing the audit could not have told us was at the bottom of the screen.
Before the palette changed, the last row was a solid black band with nothing on
it. It is not Claude Code's: it is **tmux's status line**, whose foreground is
slot 0 on a background the palette also painted black. Whitening slot 0 for
Claude Code's plates gave that bar its text back on the same stroke — the window
title, the session list and the clock had been invisible on this device for as
long as tmux has been on it, and nobody was looking for them.

A palette is the whole device's, which is the argument for leaving slots 1 and 2
alone and, here, an argument that cuts the other way too. Both directions are
the same fact: this file stopped choosing colours and started choosing which
slot a role belongs to, and the slots are shared with every other program.

The predicted casualty did not turn up. A diff was put on the screen on purpose
and it came out as line numbers, a `+` gutter and black text on paper — no plate
under any of it. The audit says `diffAdded` is slot 2 and slot 2 is black here,
and it is right about both; this rendering simply does not paint that token. So
the price named above for leaving slots 1 and 2 alone was never charged, at
least not by the numbered diff an auto-mode session draws. The ⚠️ stays, because
the tokens exist and something draws with them, and because the difference
between "predicted broken" and "observed broken" is the whole reason to look.

Selection needed a finger rather than a capture, and it took three wrong answers
to reach. Drag across text and the whole run went solid black. Written down in
the order they were believed:

1. **VTE's highlight.** `highlight-colors-set` was `false`, and with it off VTE
   paints the selection background with the *foreground* colour and leaves the
   text its own — black on black on a white-ground terminal. A real defect,
   fixed in `setup.sh` [3], and not the one being looked for.
2. **tmux's copy-mode.** `mouse on`, and `mode-style bg=yellow,fg=black` with
   both of those on black slots. It fits perfectly and it is not what happens:
   polling `#{selection_present}` twice a second for a hundred seconds while the
   selection was on the glass never once returned 1. tmux never saw the drag.
3. **Claude Code itself**, which turns on mouse tracking and therefore receives
   the drag before either of them. Its `selectionBg` is slot 4 — black — and the
   text on it is black too.

The instrument that settled it was not a photograph. It was a second tab: the
same terminal, the same palette, a plain shell instead of Claude Code. Selection
there is white on black and always was. One variable, changed once.

`selectionBg` is now the only token in this file that is knowingly left broken.
Moving it to slot 0 works and was reverted: it buys legibility by deleting the
highlight, and you select text in order to copy it, not to read it — a block
whose ends you can see is worth more than a run you cannot find. Two levels
cannot both mark a span and keep it readable, and Claude Code exposes no
selection foreground to pair with the background. The device wins that one.

🩸 It is also the token this file's own audit had flagged twice as *unobserved*,
and it was talked off the suspect list twice before anyone looked at it — once
by fixing VTE, once by fixing tmux, both real fixes to things that were not the
fault. An audit that says "not checked" is not an invitation to reason about it.

Then the last complaint, and the one that mattered most: **grey text that had
vanished.** The answer was a test card rather than an argument — nine rows, one
colour mechanism each, printed into the real terminal through the real tmux and
photographed:

| | | |
|---|---|---|
| slot 7, slot 0-as-plate, plain, reverse, tmux's `mode-style` | ✅ | |
| **slot 8** | ❌ | invisible. This is the regression, and it is one line of this repo's own doing |
| `ansi256` grey, truecolor grey | ⚠️ | legible but faint; they are a blend, and a blend is a dot pattern here |
| SGR 2 `dim` | ✅ | VTE resolves it dark enough to read |

Slot 8 went back to black and every plate moved to slot 0, which is what the
table above now says. The rule that came out of it is worth more than the fix:
**a plate slot and a text slot are not interchangeable just because both look
dark on a dark screen.** Nothing in the audit could have said that, because the
audit only knows the tokens of one program and slot 8 belongs to all of them.

That is the same lesson twice over now. A token being wrong in the theme and a
role being wrong on the screen are different claims, and an audit over a palette
file can only ever make the first one. Of the three things eventually found on
this device, not one was a token in this file: a status bar, a multiplexer's
selection, and a slot shared with every other program.

Still unphotographed: the usage meter, which needs a session close enough to its
limit to draw one. The captures are on the device in `~/Pictures/palette/`; the
test card is `setup/palette-probe.sh`, and it is the fastest way to find out what
a change to that palette actually did.

One last limit, and it is the camera's rather than the panel's. `Capture()` reads
the framebuffer, and the dithering happens in the driver *below* it — so a
capture can prove that a token is white on black and still not tell you whether
those white strokes survive A2 on the glass. Everything above was confirmed by
someone looking at the device. Nothing here should be settled from a screenshot
alone.

Claude Code reads `$CLAUDE_CONFIG_DIR`, falling back to `~/.claude`, and
watches `themes/` — so a write lands in a running session, unless that
directory did not exist when the session started, which needs one restart.
Install it wherever Claude Code actually runs, which is not always this device:
driving it over SSH from the PineNote puts the theme on the far machine, while
the panel it has to be legible on is still this one. That split is why the theme
went ANSI-only and why the palette carries the device-specific half — the file
travels, the palette does not.

```sh
python3 setup/claude-code-theme.py           # then pick "Lumalock" in /theme
python3 setup/claude-code-theme.py --check   # what this panel paints
python3 setup/claude-code-theme.py --swatch  # what your terminal paints
```

It is deliberately outside `bootstrap.sh`. Everything that script installs is
about the device; this is about one program you may not run.
