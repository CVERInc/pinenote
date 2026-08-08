The PNEink theme is what makes this device readable, and it is all rights
reserved — not by decision, but because a placeholder was never filled in.

`LICENSE` in [PNDeb/PNEink](https://github.com/PNDeb/PNEink) is present and zero
bytes: blob `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, which is git's empty
object. `debian/copyright` carries the same hash, and the installed package ships
`/usr/share/doc/pneink/copyright` at 0 bytes.

## How one empty file became two

From that repository's README:

```
dh_make -p pneink_1.0 --indep -c custom --copyrightfile "${PWD}"/LICENSE --createorig
```

`--copyrightfile` copies `LICENSE` into `debian/copyright`. One unfilled
placeholder produced both, and filling `LICENSE` in fixes both at once. That is
the useful half of this report: the symptom is two files, the cause is one.

## What it costs

Nothing about installing or using it. Everything about carrying it: the theme
cannot be forked, redistributed, or taken into another project, which is why our
overrides live in our own extension's stylesheet rather than in a fork of the
theme. Two PRs have been open against that repository since May and July 2025, so
people do want to send work back.

## The bug we found while looking

`.workspace-background` is styled with `background-color: #000000`,
`border: 2px solid #000000` and `border-radius: 5px`, while the shell clips the
wallpaper inside it with a much larger radius. The two radii do not agree, and the
gap shows as a black wedge in each corner of the workspace preview in the
overview.

Measured along the top edge, GNOME 48 at scale 2: 4 device pixels of black away
from the corner — the theme's 2px border, correct — swelling to 33 near the
corner and taking about 40 pixels to come back down.

Dropping the background colour is enough. The wallpaper keeps its own rounded
corners, which the shell draws and which were never wrong.

## Where it went, and one thing done wrong

Issues are disabled on PNDeb/PNEink, and discussions with them. The only channel
that repository offers is a pull request, and the two sitting there are unmerged.
So this was raised on `pinenote-debian-image` instead, which is the same
maintainer and is actively worked on — pushed within the last month, seventy open
issues.

Both findings went into the one issue, which breaks the first rule in this
directory: one report per defect. The reasoning was that a licence request and a
CSS measurement are both factual, that neither can drag the other down, and that
the maintainer's attention is scarce enough that two notifications would cost more
than they return. That may be right, but it was a judgement against a rule that
exists for a reason, and it belongs in the record rather than in a shrug.

## Context

- PNDeb is a community Debian image project for the PineNote, maintained by an
  individual. It is not Pine64, who sell the hardware.
- `pinenote-debian-image` is GPL-3.0 and alive. `pinenote-gnome-extension` and
  `PNEink` both report NOASSERTION and were last pushed in 2025-04 and 2024-11.
  The core is maintained; the edges have gone quiet.
