# Upstream reports

Findings from this device that are defects in someone else's project rather than
choices we disagree with. Written as reports someone can file, not as patches
someone has to review — the reproducible part is the report.

| filed | where | state |
|---|---|---|
| [App names unreadable on a touch-only device](gnome-shell-app-name-touch.md) | [gnome-shell#9335](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/9335) | open |
| [Icon size lands below what fits](gnome-shell-icon-size-steps.md) | [gnome-shell#9336](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/9336) | closed as a duplicate of [#2173](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2173); the mechanism and the `fixed-icon-size` escape hatch were added there as a comment, since five years of that thread had not named either |
| [Accel matrix matched by chip, not board](systemd-hwdb-sc7a20-two-boards.md) | [systemd#43321](https://github.com/systemd/systemd/issues/43321) | open — maintainer asked for a PR; the current match key cannot express one, and the thread now has the `udevadm test` output showing why |
| [Tapping selected text does not raise the OSK](gtk-osk-selected-text.md) | [gtk#8345](https://gitlab.gnome.org/GNOME/gtk/-/issues/8345) | open |
| [A negative CSS margin aborts the shell](gnome-shell-negative-css-margin-abort.md) | gnome-shell, not filed yet | written 2026-08-08; searched and not a duplicate of #7339. Not yet reduced to a minimal extension, and the user-theme path is untested — both are named in the report rather than glossed |

## How these get written

- One report per defect. A UX argument and a piece of arithmetic do not belong in
  the same issue; the arguable one drags the other down.
- No patch attached. A patch asks to be reviewed and joins a queue; a report asks
  to be read.
- Measurements, not adjectives. Every claim here is a number somebody can check.
- Say what was tested and ruled out. "We tried X and it is not the cause" saves
  the next person a day, and costs one sentence.
- Say what is a guess. Three theories were stated confidently and wrongly on the
  evening these came from; separating the measured part from the guessed part is
  the cheapest honesty available.
- Search first. #9336 was a duplicate, and finding that out after filing is worse
  than finding it out before.
