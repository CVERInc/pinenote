# The shape of this keyboard

Numbers you need before changing a width in `pn-osk.json`. All of them were
measured on the device, on a 1872x1404 e-ink panel at 227dpi.

## Half a column is the smallest thing that exists

`KeyContainer.appendKey` attaches keys to a `Clutter.GridLayout`:

```js
const KEY_SIZE = 2;
this._gridLayout.attach(key, left * KEY_SIZE, top * KEY_SIZE,
                        width * KEY_SIZE, height * KEY_SIZE);
```

`GridLayout.attach` takes integers, so a width has to survive being multiplied
by two. **Every width must be a multiple of 0.5.** Anything finer is truncated
downward, silently: 1.25 renders as 1, 2.25 as 2, 3.25 as 3.

This is worth stating loudly because it does not fail — it just quietly gives
you a narrower key than you asked for. A navigation column set to 1.25 spent
several revisions looking exactly half a column too narrow, and every attempt to
widen it by a quarter did nothing at all. The extension now rounds to the grid
and says so in the journal rather than letting the fraction disappear.

## One column

| | Portrait (1404px) | Landscape (1872px) |
|---|---|---|
| 1 column | 82px = **9.2mm** | 109px = **12.2mm** |
| 1 row | 93px = **10.4mm** | 93px = **10.4mm** |

A column is 25% narrower in portrait, which is why the same number feels
different depending on which way the tablet is held. It is also why portrait
labels the modifier keys with symbols and landscape spells them out.

## What a label needs

Measured by trying it, not by counting characters — a capital D is not a 1.

| Label | Needs a pitch of | Portrait | Landscape |
|---|---|---|---|
| One glyph (`⌃`, `↖`, `⌄`) | anything | 1 | 1 |
| Three characters (`Del`, `123`) | ~105px | 1.5 | 1 |
| Four characters (`Ctrl`, `?123`) | ~130px | 2 | 1.5 |

The three-character threshold sits between 102px and 109px: `Del` fits one
landscape column and does not fit 1.25 portrait columns, and those are 7px
apart.

## What each row has left to spend

Every row totals 17 columns. The letter and punctuation keys are 1 column each
and are not negotiable, so this is the budget for everything else:

| Row | Fixed keys | **Free** | Spent on |
|---|---|---|---|
| Digits | 13 | **4.0** | Esc, Backspace, nav |
| qwerty | 12 | **5.0** | Tab, `\`, nav |
| asdf | 11 | **6.0** | Caps, Enter, nav |
| zxcv | 10 | **7.0** | both Shifts, `↑`, nav |
| Bottom | 0 | **17.0** | ten keys and the space bar |

One key per row is elastic and absorbs whatever the others leave over —
Backspace, `\`, Enter, the right Shift, and the space bar. Set a width anywhere
and its row still lands on 17; the elastic key pays for it. If the fixed keys
add up to more than 16, the elastic key would fall below one column, and the
extension refuses and warns rather than shipping a key too small to hit.

## The current shape, and why

```
⎋ 1     ` 1 2 3 4 5 6 7 8 9 0 - =      ⌫ 2       ↖ 1
⇥ 1.5    q w e r t y u i o p [ ]        \ 2.5     ↘ 1
⇧ 2       a s d f g h j k l ; '          ↵ 3      ⇞ 1
⇧ 2.5      z x c v b n m , . /    ⇧ 2     ↑ 1.5   ⇟ 1
⌃ 1.5  123 1.5  ⌥ 1.5  ——— space 6 ———  😀 ⚙ ⌨   ← ↓ 1.5 →
```

The two `⇧` on the fourth row are not the same key. The left one switches
levels, the way GNOME's does. The right one is a real `Shift_L` that latches
beside `⌃` and `⌥`, so that Shift+Tab and Shift+arrow exist at all — see
[*Chords*](../../docs/keyboard.md#chords). They are drawn identically because they do the same
thing to a letter; they differ only on the keys that never had a shifted face.

The left edge is a staircase, not a line: 1, 1.5, 2, 2.5, and then Ctrl back
down to 1.5. That is what a physical keyboard does, and an earlier revision of
this file had them all set to the same width because a straight edge looks
tidier in a screenshot. Aligned keyboards are harder to type on. The stagger is
the point.

Up and down are 1.5 against 1.0 for left and right, because up and down carry
the shell history and the scrollback. `↑` and `↓` both start at column 14.5, so
the inverted-T reads as one.

There is no forward delete. It went through three rounds of sizing — a wider
cell, a text label, a mirrored icon — before anyone asked whether it would ever
be pressed. On a Mac there is no such key.
