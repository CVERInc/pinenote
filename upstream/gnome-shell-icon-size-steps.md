# App grid icon size can land well below what fits, because the candidates are a fixed list

**Component:** gnome-shell — icon grid
**Version:** 48.7 (Debian trixie, aarch64)
**Hardware:** Pine64 PineNote — 10.3" e-ink tablet, 936×702 logical in landscape,
702×936 in portrait

## Summary

`IconGridLayout._findBestIconSize()` picks the first size from a fixed list that
fits, so when the space available falls between two entries the grid takes the
lower one and leaves the difference as empty space. On this panel that is the
difference between a 56px icon and a 48px icon, in a cell with room for 56.

## What happens

In `js/ui/iconGrid.js`:

```js
const IconSize = {
    LARGE: 96, MEDIUM: 64, MEDIUM_SMALL: 48,
    SMALL: 32, SMALLER: 24, TINY: 16,
};
...
const iconSizes = Object.values(IconSize).sort((a, b) => b - a);
for (const size of iconSizes) {
    ...
    if (emptyHSpace >= 0 && emptyVSpace > 0)
        return size;
}
```

The steps from 96 to 64 to 48 are large, and the loop takes the first that fits
rather than the largest that fits.

## Measured on this device

Portrait, four columns by six rows, with the app display given the full page:

| quantity | value |
|---|---|
| per-cell height budget | 120.5 px |
| cell overhead (label plus tile padding) | 64 px |
| largest icon that fits | 56 px |
| icon chosen | 48 px |

56 is not on the list, so the grid falls to 48 and every cell carries 8px of
vertical space it cannot use. In landscape the same arithmetic gives a budget of
129.5 and the chosen size is 64, which happens to be close; the size therefore
also *changes* when the tablet is rotated, from 64 to 48, which reads as the
icons resizing under you.

## Reproducing

Any display whose per-cell budget falls between two entries in `IconSize`. The
budget is

```
(pageHeight - pagePadding.top - pagePadding.bottom - rowSpacing * (rows - 1)) / rows
```

minus the cell overhead, and the values come from `.icon-grid` in the theme along
with the tile padding, so a display size and a font size are enough to land in
the gap.

## Possible directions

1. **Compute the largest size that fits** rather than testing a fixed list. The
   fit test is already arithmetic; the list is what discretises it.
2. **Keep a list, but a denser one.** Cheaper, and it narrows the gap without
   changing behaviour anywhere the current list already lands well.
3. **Leave the automatic path alone and document `fixed-icon-size`.** The
   property exists and takes any integer, but nothing in the shell sets it, and
   it is not obvious from the outside that it is the intended escape hatch.

## What we did locally

We set `fixed-icon-size` to the largest size that fits in *both* orientations, so
the icons stop changing when the device is rotated. That is a tablet-specific
concern and probably not something the shell should do by default.

Our notes and measurements are at https://github.com/CVERInc/pinenote (MIT), in
case any of it is useful.
