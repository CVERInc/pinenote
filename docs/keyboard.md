# The keyboard it types on

Part of [pinenote](../README.md).

GNOME's on-screen keyboard reserves a band the full width of the monitor and a
third of its height in landscape, then draws the keys inside a container that
preserves the layout's column-to-row ratio and centres whatever it cannot fill.
On this panel the keys got 1207 of 1872 pixels. The top 98 of the band's 468
pixels belong to a word-suggestions strip that a terminal never fills. And the
keys were narrow enough that the terminal layout's own labels ellipsized: `Tab`
rendered as `T…`, `Ctrl` as `C…`, `?123` as `?…`. They were not mystery keys.
They were keys that could not spell their names.

![The keyboard, landscape and portrait](../extensions/pn-osk@cver.net/keyboard.png)

`extensions/pn-osk@cver.net` makes the keys use the band that was already being
paid for, and rebuilds the terminal layout as a 65% keyboard: the digits with
their shifted faces, the punctuation where fingers expect it, an inverted-T, and
a navigation column down the right edge. Portrait gets the same keyboard: one
layout in both orientations is worth more than two tuned ones, and rotating the
tablet no longer moves a key. The modifiers are named in lower case on both — the
words fit once the label size is trimmed, and a key that can spell itself beats a
glyph you have to learn. Escape keeps `⎋` in portrait, where the column is
narrowest. Renames live in `labels` (both orientations) and `portrait.labels`
(upright only), the second layered over the first.

It also adds an Escape key, which the stock terminal layout does not have in any
of its four levels. That gap is [three years old
upstream](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2551).

Caps Lock says which state it is in. Pressing it latches the whole shift level —
that part works — but GNOME only ever paints a key as *latched* on the
long-press-Shift path, and the caps key is not in the list that gets told. The
state was real and invisible at once. A `:latched` rule in the stylesheet was
tried first and did nothing, because the pseudo class never arrives. So the key
is named after what it is doing instead: `caps lock` becomes `caps locked`. On a
panel with two colours and no animation, words are the signal that survives.

## Chords

A latched modifier reaches only half of GNOME's keyboard. `keyboard.js` hands
`this._modifiers` to `commit()`, which is the path a character key takes, and
does not hand it to the branch immediately above:

```js
} else if (key.keyval) {
    button.connect('keyval', (_actor, keyval) => {
        this._keyboardController.keyvalPress(keyval);        // modifiers never read
} else {
    button.connect('commit', (_actor, str) => {
        this._keyboardController.commit(str, this._modifiers);
```

Every key carrying a keyval goes through the first branch — Tab, Escape, Enter,
the arrows, Home, End, Page Up, Page Down. So `Ctrl+C` worked and `Ctrl+Left` did
nothing, and from the outside those two look the same: a key that was pressed and
had no effect.

Shift was not a modifier at all. Upstream's Shift is a `levelSwitch` — it changes
which faces are drawn on the keys, and there is no instant at which Shift is
being held. `Shift+Tab` could not exist. Not "did not work": could not exist.

Both halves are fixed here. The controller is patched rather than `_addRowKeys`,
because that keyval handler is a closure connected inside upstream's build loop
and there is nothing left to reach once a key exists — but every one of those
closures ends up in `keyvalPress`. And the row's right-hand Shift becomes a real
`Shift_L`. Two Shifts is a habit inherited from keyboards you play with ten
fingers; nobody chords with two thumbs on a tablet. The left one still switches
levels, the right one latches like the `ctrl` and `alt` beside it, one key at a
time, and then lets go.

Letters still arrive capitalised through it: with a modifier held, `commit()`
sends raw keyvals instead of going through the input method, and the compositor
resolves the letter at the level Shift selects. The only visible difference is
that the right Shift no longer flips the faces on screen — the latched paint says
so instead.

Forwarding a real modifier is also why the result is right rather than merely
close. Sending the shifted keysym directly would produce `ISO_Left_Tab` with no
modifier set, which is not what a keyboard sends. This is what an application
receives now:

```
press   keyval=Shift_L (0xffe1)       keycode=50   state=-
press   keyval=ISO_Left_Tab (0xfe20)  keycode=23   state=SHIFT
release keyval=ISO_Left_Tab (0xfe20)  keycode=23   state=SHIFT
release keyval=Shift_L (0xffe1)       keycode=50   state=SHIFT
```

Nothing sent `ISO_Left_Tab`. Tab was sent, and the compositor resolved it at the
shifted level by itself, because Shift was genuinely down. Measured the same way:
`Shift`+`→` arrives as `Right`+SHIFT, `ctrl`+`←` as `Left`+CTRL, and
`ctrl`+`Shift`+`c` as `C`+SHIFT+CTRL — which is the terminal's copy.

## Pressing a key from a machine

The keyboard can only be pressed by a finger, and a finger cannot report what
arrived. "Shift+Tab works now" is otherwise a sentence someone has to be standing
next to the tablet to say, which is how the shadow experiments in this repo went
wrong twice.

So the keyboard grew a way to be pressed and a way to be read:

- `TapKey` and `Keys` on `org.cver.PnOsk`. `TapKey` presses a key with the same
  two calls the touch handler makes — `Key._press` and `Key._release` on the same
  actor — so the path from the button to the application is the real one. A key
  is named by its label (`tab`), its icon (`osk-shift-symbolic`), its keyval
  (`0xff09`), or `#N` from the `Keys` inventory; the two Shifts differ in nothing
  else.
- `setup/keylog.py` is the other end: a window that prints what the application
  actually got, keyval and keycode and modifier mask, and prints separately the
  text that arrived through the input method without ever being a key event.

The pair runs over SSH, which is the point. The first run with them found that
every keystroke was going into the overview's search box rather than the logger —
visible immediately in a `Capture()` screenshot, with the candidates up and a
stray `b` sitting in the search field. An instrument that says nothing is not
evidence that nothing happened.

## On GNOME 48

48 renames every keyboard-specific OSK icon to an `osk-` prefix —
`keyboard-enter-symbolic` becomes `osk-enter-symbolic`, and likewise for shift,
caps lock, hide, layout, emoji and delete. The generic `go-*-symbolic` arrows are
left alone. The extension matches both spellings, so one copy runs on 47 and 48.

Only one of those renames actually mattered, and it is worth knowing why: `enter`
is the single icon behind `_composeLevel`'s `return null`. One failed lookup
dropped the entire layout back to stock while the extension still reported
`ACTIVE`, still answered on D-Bus, still read its config, and composed exactly
zero rows. Nothing in the journal said so. If this keyboard is ever silently the
stock one again, `trace` in the config prints what `_updateLayout` was handed and
whether `_addRowKeys` ever saw a composed row — that is the shortest path back.

The keyboard also sits past the bottom of its band, and it is tempting to file
that under 48. It is not. Measured on both systems: keys are 94 physical pixels
on 47 against 96 on 48, five rows overflow by six either way, and `font-size` is
`1.455em` in both themes. **47 has been overflowing since the first day.** What 48
changed is the scale — rotating the tablet makes it write `scale=2` into
`monitors.xml` — so the same six logical pixels arrive as twelve physical ones
and stop being invisible. `stylesheet.css` trims label and icon, which takes keys
to 92 and the overflow to four, and is also what lets `caps locked` fit its three
columns.

This was first written up the other way round, as *48 enlarges the key font*,
from numbers that looked twice as large on one side — because they were logical
pixels under a 2x scale on one system and physical pixels under 1x on the other.
Two coordinate systems, read as one measurement. Correcting it cost a reboot into
the older install and one more look, which is the practical argument for keeping
that install around: a second system is not only a way back, it is the only
control group this device has.

The gap above the screen edge costs width: `AspectContainer` holds a ratio, so
every pixel taken off the band returns as roughly two pixels of margin on each
side. Loosening `.key-container` padding does not help, and neither does an
explicit `height` — only the font size moves a key's height, and that is a
legibility budget, not a layout knob.

Every width lives in `~/.config/pn-osk.json` and is re-read on each rebuild, so
changing the shape of the keyboard costs a JSON edit and a D-Bus call rather
than a session restart. **Read
[GEOMETRY.md](../extensions/pn-osk@cver.net/GEOMETRY.md) before changing one** —
half a column is the smallest width this keyboard can express, and finer values
are truncated without complaint.

The extension also exposes `Capture` and `Geometry` on
`org.cver.PnOsk`. That is not a debugging leftover: GNOME refuses screenshots to
callers outside the shell, and `/dev/fb0` on this device holds whatever plymouth
last drew rather than the live desktop, so there was no way to see this layout
over SSH except by photographing the glass. `setup/oskshot` counts down and then
takes the picture, which leaves your hands free to rotate the tablet or hold
shift while it fires.

## What the measurements could not tell us

The instrumentation found the 17 columns, the 0.5 grid, and an override that was
silently doing nothing because an unallocated actor reports its box as
`±Infinity` and `|| fallback` does not catch that.

It did not find any of this:

- that the keys should **not** be aligned — the left edge of a real keyboard is
  a staircase, and a straight one is harder to type on
- that up and down should be wider than left and right, but only where they are
  not sitting next to each other
- that `` ` ~ `` cannot leave the number row, whatever it costs elsewhere
- that a forward delete key never needed to exist

Every one of those came from looking at the glass, and three of them reversed
what the arithmetic was busy doing at the time. The layout in the screenshot is
not a design that was computed. It is what two ways of being wrong converged on.

# The languages it types in

`setup/ime.sh`, run from `setup.sh`. Pinyin and bopomofo that output
traditional characters, and Japanese by romaji, on the same on-screen keyboard
— plus Korean installed for anyone who needs it.

**IBus, not fcitx5.** This is not a preference. There is no physical keyboard
here, so the primary input device is `pn-osk`, which patches GNOME Shell's own
`Keyboard` class; the OSK commits through Clutter's input method, which is wired
to IBus. fcitx5 draws its own candidate window and never sees those keys.

**RIME, not libpinyin.** libpinyin's traditional output is a simplified lexicon
with an OpenCC pass on the end, so one-simplified-to-many-traditional has to
guess: 發/髮, 乾/幹/干, 麵/面. RIME's 朙月拼音 dictionary is *already*
traditional and simplified is the converted direction, so there is nothing to
guess. The schema is `luna_pinyin_tw`, which adds `t2tw` on top for Taiwan glyph
forms (裡/裏, 著/着, 為/爲). The vocabulary needed no help: grepping the shipped
dictionary, `軟體` is present and `軟件` is not, `網路` seven times and `網絡`
zero.

**`mozc-on`, not `mozc-jp`.** ibus-mozc declares three engines — `mozc-jp`
(generic), `mozc-on` (Mozc:あ), `mozc-off` (Mozc:A_). Wire up `mozc-jp` and it
sits in direct-input mode, so romaji comes out as latin letters and looks exactly
like an input method that failed to install; the k6 layout has no
hankaku/zenkaku key to get out of it. `mozc-on` activates in kana. This is the
same split macOS makes between かな and 英数.

**One layout for all of them.** Pinyin, romaji, bopomofo, Korean 2-set and
English consume the same 26 letters. Both CJK engines declare `layout` values the
OSK has no page for — `default` for rime and mozc, `kr` for hangul — and
`_composeLayout`'s fall-through to `us-extended` catches every one of them. That
fall-back was written for a missing terminal layout; it is the only reason the
k6 keyboard survives switching engines at all.

## The candidate window took four fixes, and they were four different bugs

Each one looked like the previous fix not having worked.

**It never appeared with the OSK up.** Upstream treats the floating popup and
the keyboard as mutually exclusive — `isVisible = !Main.keyboard.visible && …` —
and hands candidates to the OSK's suggestion strip instead. That strip is real
and visible, but `fillWidth` pins the AspectContainer's ratio to the whole
band (`setRatio(keyboard.width, keyboard.height)`), so the keys claim the full
234px and the strip is allocated nothing. Both paths dead at once, which is why
a physical keyboard worked and the OSK did not.

**It was vertical.** `style/horizontal` was patched into `default.custom.yaml`,
then into the schema. Neither is read. ibus-rime has its own frontend config,
`/usr/share/rime-data/ibus_rime.yaml`, which ships `horizontal: false`; the
binary carries `"ibus_rime.yaml"` and `"style/horizontal"` as neighbours.

**Patching the right file still did nothing.** `rime_deployer --build` does not
produce `build/ibus_rime.yaml` — but it does write `user.yaml`'s
`last_build_time`, so the frontend then sees nothing to do and skips the
maintenance pass that would have built it. Delete `build/` and `user.yaml` and
let ibus-rime deploy on its own; do not run the deployer by hand.

**It landed inside the keyboard.** `St.Side.TOP` means the arrow is on top and
the *box hangs below*, so anchoring at the keyboard's top edge drew the
candidates over the number row. That was the last time BoxPointer's own
positioning was argued with.

## And then it stopped being a bubble

BoxPointer is right for something that points at a thing and wrong for a bar
that lives on an edge, and every remaining fault was that mismatch wearing a
different face. Position is computed by `pn-osk` now, not by `_reposition`:
`resX` came from `natWidth`, so the bar wandered whenever the candidates changed
length (624 / 652 / 696 measured) — that was the drift. `y` is computed inside
`_reposition` from the allocation box, because that is the only moment the
height is *this* batch's height; computed after `open()` and before the content
laid out, it read the previous batch and put the bar 34px low, over the Esc row.

The `...` was never width. `St.Label` ellipsizes at END by default and
`BoxLayout` shrinks every child toward its minimum in proportion, so one
sentence-length candidate turned all five into `1 ...`. Ellipsize is off on the
sixteen labels the area builds up front; what does not fit is clipped, and the
page buttons — `x_expand` + `END` — stay pinned on the right, which is the point
when something has been clipped. `page_size` went back to 5 for the same reason:
when the first candidate is 你好暗暗幾歲住哪要不要喝咖啡, nine cells do not fit in
936 logical pixels no matter how they are aligned. macOS gives the first
candidate what it needs and pages the rest; five is that shape.

The popup went *into* the posteriser and then came out again. In, because
`addTopChrome()` puts it outside the quantiser and it arrived Adwaita-dark with a
blue selection that has no grey to dither into. Out, because the keyboard is not
in that list, so no CSS value could make the selected cell match the keyboard's
`#aaa` — it would draw as `#555`. Physics to the quantiser, design to CSS: the bar
is part of the typing surface now, and its colours are written next to the
keyboard's.

**The one that hid.** Upstream `_reposition` must run before the origin is
overwritten. It fills `_sourceExtents` and `_workArea`, and `vfunc_allocate`
calls `_updateFlip` right after it, which reads them. Replacing `_reposition`
wholesale left them unset; `_updateFlip` threw inside the vfunc, GJS swallowed
it, and the journal said nothing — while `Geometry()` reported visible, mapped,
sourceMapped all true, five candidates present, opacity 255, and `box: None`.
Everything there, no allocation. Three rounds of "0 JS ERROR" were evidence of
nothing. The diagnostic fields on `Geometry()` are what caught it, and they stay.

The result keeps the numbers: `addSuggestion(text, callback)` carries no index,
so the OSK's own strip could only ever be tapped, while the bar has 1-5 — and
this keyboard has a real digit row to press them with.

**One correction worth keeping.** The first diagnosis of the invisible strip was
"`kb._suggestions` is null". It is not, and it never was. `Geometry()` had no
field for it yet, and the reader collapsed *key absent* and *value null* into the
same `None`. Adding the field and measuring again gave visible=true,
children=0, naturalHeight=0 — present, and squeezed to nothing. `Geometry()`
reports `suggestions` and `candidates` now, and `PanelInfo()` reports
`inputSources`, because the thing that caught the mistake was having a number to
look at.

## Switching

One tap on `pn-input` cycles US → JP → TW → US in list order — alphabetical, which is what you can hold in your head. Not MRU, which is
what GNOME's own `switch-input-source` does: with three sources and one button,
MRU bounces between the two most recent and the third becomes unreachable.

`Ctrl+Space` runs the same cycle — the binding is hijacked with
`setCustomKeybindingHandler` rather than adding one, which would have required
this extension to carry a GSettings schema for two keys. `switch-input-source-backward`
is borrowed for Caps Lock, which returns to US and, if already there, goes back
to where it came from. That is macOS's behaviour, and the alternative — one
direction only — makes Caps a key with no way back.

Caps Lock has no bindable keysym of its own; `caps:menu` turns it into a Menu key
and drops the lock behaviour, and `ime.sh` checks that the option exists in this
device's `xkeyboard-config` rather than setting it blind.

Korean (`ibus-hangul`) is installed and labelled but not in the list; `pn ime add
hangul` puts it in. Five sources
on one button is four taps to the far end. The labels ship anyway, because an
engine that works while its button shows the wrong name is the worst of the
three states.

## Bopomofo, and the three layers it made us name

Bopomofo goes through RIME, not chewing. Chewing is the Microsoft-Bopomofo
lineage — it converts silently as you type and asks only on arrow-down — and no
option changes that without also discarding its phrase model. The maintainer's
hands are iPad's, which shows candidates as you go. RIME's `bopomofo_tw` does
exactly that, on the same engine, the same bar and the same dictionary as the
pinyin: `PREEDIT 'ㄏㄠˇ' → LOOKUP first='好'`, measured. Chewing stays installed
for anyone whose hands are Windows'; `pn ime add chewing`.

That decision forced a naming question, and the answer is worth keeping.
*Pinyin* and *bopomofo* are two transcriptions of one language; *romaji* and
*kana* are two of another; *latin* is the alphabet pinyin and romaji both
happen to print. Three layers:

| layer | values | who owns it |
|---|---|---|
| language | `US` `JP` `TW` | the top-bar label stops here |
| input method — the *face* | `TW: pinyin, bopomofo` · `JP: romaji` (kana goes in the same slot) | `pn-panel` |
| alphabet — what the caps print | pinyin, romaji → latin · bopomofo → 注音 · kana → 假名 | `pn-osk`, derived from the face |

So the label is `TW` for both faces — an earlier `ㄅ` (a flick at 11px) and then
`BP` were both the input-method layer leaking into the language layer — and the
thing that tells them apart is the keyboard: the standard 大千式 keyboard is the
US keyboard with a second symbol per key, chewing and RIME both take US keysyms,
and `pn-osk` relabels level 0 through `PN_BOPOMOFO` when the face is bopomofo.
Only bopomofo on the cap; two glyphs in a 109px key are both too small. Physical
keyboard, OSK down, no caps to look at: type one key and you know, as on macOS.

**One engine, two faces.** IBus will not list one engine twice and ibus-rime
declares exactly one, so pinyin and bopomofo cannot be two sources. `pn-input`
cycles *faces* — `US → JP → TW(pinyin) → TW(bopomofo)` — and switching between
the two TW faces means switching RIME's schema. That is one synthesised
keypress: `ime.sh` binds `F7 → select luna_pinyin_tw` and `F8 → select
bopomofo_tw` through librime's `key_binder`, whose `select` action switches
schema directly — no menu, no intermediate state. F7/F8 because the k6 layout
has no F keys: a human cannot press them, only `pn-panel` can.

It was not one keypress for most of a day. The first design drove RIME's F4
switcher menu — open it, hide the candidate bar while it is up, read its rows,
read the cursor, walk with Down/Up, commit with space, read back 600ms later to
see whether it took, retry if not. Every step was a race, and each fix exposed
the next: the menu opened under the user's in-progress candidates and an Escape
meant to close it cleared their input instead; space landed before the cursor
had finished moving; the verification ran before the menu had closed; a
commit-first guard that re-checked the preedit either hung the switch forever
(the round trip is slower than the check on this SoC) or, in its recursive
form, pumped 169 Enters a minute into the terminal. The lesson is the design:
when driving another program's UI takes seven steps, the fix is not better
steps, it is finding the one-step door — and `key_binder`'s `select` was there
all along.

What survives from that day: switching is *lazy* (RIME only handles keys while
an input box has focus — gated on `Main.inputMethod.currentFocus`, because the
IM context exists from session start and gating on it blocks nothing — so a
tap in the overview records the face as pending and `focus-in` flushes it), it
*commits first* (F8 mid-composition silently discards what the user typed — no
commit-text event, probed — so a tap while composing sends Return, waits one
beat, then switches, with no verification and no retry: both keys go to the
same context, and if one arrives both do), and on enable the label's face is
set pending because RIME remembers its last schema across restarts and we do
not.

RIME does not report its schema over IBus properties, and an external IBus
context cannot see the shell's — sessions are per-context, so a probe reading
"pinyin" says nothing about what the terminal is on. Every reading taken that
way during this work was noise. The probe *can* exercise engine machinery —
key acceptance, orientation, what F8 does to a composition — and that is what
it is for. The face is pn-panel's truth, and the only verification is typing
on the glass: `su3cl3` → ㄋㄧˇ ㄏㄠˇ in the preedit, 你好安安超讚的 in the bar,
`TW` on the top bar, nothing else ever seen.

Bopomofo through RIME would have been free — `rime-data-bopomofo` is already
there — but it would share the single `rime` engine slot and need `Ctrl+`` ` `` to
switch schemas, and the k6 portrait layout has no backtick. A separate engine is
the right shape here.

**JIS is deliberately absent.** For a physical JIS keyboard this repository needs
to do nothing: add `('xkb','jp')`. For the on-screen keyboard it would mean a
second composed layout, against the rule that earned itself in *The keyboard it
types on* — and that rule is stronger across languages than across orientations,
because all five input methods above eat the same 26 letters. What a JIS layout
buys is muscle memory for key positions, on a surface that has no keys to feel.
