// PineNote OSK — make GNOME's on-screen keyboard stop wasting landscape.
//
// Measured on this 1872x1404 panel, before any of this:
//
//   Keyboard._relayout() reserves a band the full width of the monitor and a
//   third of its height in landscape. The keys are drawn inside an
//   AspectContainer, which preserves the layout's column:row ratio and centres
//   whatever it cannot fill, so the keys got 1207 of 1872 pixels. The top 98
//   pixels of that band belong to a word-suggestions strip that a terminal
//   never fills. And the keys were narrow enough that the terminal layout's own
//   labels ellipsized: "Tab" as "T...", "Ctrl" as "C...", "?123" as "?...".
//   They were not mystery keys. They were keys that could not spell their names.
//
// What this does:
//
//   fillWidth   override the ratio in landscape so the keys use the band that
//               was already being paid for
//   k6Layout    rebuild the terminal layout as a real 65% keyboard: the digits
//               with their shifted faces, the punctuation where fingers expect
//               it, an inverted-T, and a navigation column down the right edge.
//               The stock us-extended layout has no Escape key in any of its
//               four levels, which is a strange thing for a terminal keyboard.
//
// Everything below lives in ~/.config/pn-osk.json and is re-read on every
// keyboard rebuild, so tuning it costs no session restart. Changing THIS FILE
// does — GNOME caches extension modules, and only `systemctl restart gdm3`
// (autologin is on, so it comes back by itself) picks up a new one. The
// stylesheet is the exception: it reloads on disable/enable.
//
// The D-Bus interface is not a debugging leftover. This device is driven over
// SSH; GNOME refuses screenshots to callers outside the shell, and /dev/fb0
// holds whatever plymouth last drew rather than the live desktop. An extension
// runs inside the shell, so Capture() can take the picture and Geometry() can
// report the real allocation boxes. It earned itself within the hour: the ratio
// override was silently doing nothing, and one trace line said why.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import IBus from 'gi://IBus';

// App names are capped at two lines. A three-line name like "ImageMagick (color
// depth=q16)" is an outlier on this device. Truncating it prevents those
// names from stretching the height of every cell in the grid.
const PN_LABEL_LINES = 2;
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Keyboard} from 'resource:///org/gnome/shell/ui/keyboard.js';
import * as IBusManager from 'resource:///org/gnome/shell/misc/ibusManager.js';
import * as InputSourceStatus from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const BUILD = 29;

// These represent the panel's physics, as a default state rather than a toggle.
// They were previously applied manually over D-Bus because CSS overrides were
// masking the need. With the CSS overrides removed, these two constants are
// structural — without them, the session boots into stock dark Adwaita instead
// of the intended e-ink presentation.
const PN_POSTERISE_LEVELS = 6;
const PN_POSTERISE_INVERT = true;

// Logical pixels kept clear under the app grid so the page indicators are not
// flush with the screen edge.
const PN_PAGE_INDICATOR_ROOM = 28;

const DEFAULTS = {
    fillWidth: true,
    k6Layout: true,
    trace: false,

    // Renames that apply in both orientations. portrait.labels sits on top of
    // this one, so a key can read one way everywhere and another way only when
    // the tablet is upright.
    labels: {},

    // Caps Lock latches the whole shift level, but GNOME only ever paints a
    // key as latched on the long-press-Shift path, so the state is real and
    // invisible. Naming the key after its state is the cheaper signal: no
    // pseudo class to hunt, and it reads the same on a panel with two colours.
    // Set either string empty to keep the stock caps-lock icon instead.
    capsLabels: {default: "Caps Lock", latched: "Caps Locked"},

    // One key per character. The shift string lines up position for position
    // with its default: index N of one is the shifted face of index N of the
    // other, exactly as the two halves of a physical keycap.
    topRow: {default: '`1234567890-=', shift: '~!@#$%^&*()_+'},
    qwertyExtra: {default: '[]\\', shift: '{}|'},
    homeExtra: {default: ";'", shift: ':"'},
    bottomKeys: {default: ',./', shift: '<>?'},

    // The navigation column down the right edge. One column is 110px here,
    // which fits three characters: "End" and "Del" survive, "Home" and "PgUp"
    // ellipsize into "H..." and "P...". The symbols are what a Mac keyboard
    // prints on these very keys, and they fit. Set them back to words and
    // raise widths.nav to 1.5 if you would rather read them.
    navLabels: {
        esc: 'Esc',
        del: '\u2326',
        home: '\u2196',
        end: '\u2198',
        pgup: '\u21de',
        pgdn: '\u21df',
    },

    // U+2326 lives in three of the installed fonts, and the one that answers
    // draws it too large for a single column, so the key ellipsizes \u2014 the very
    // failure this whole layout exists to avoid. An icon is scaled to the key
    // instead of typeset into it, so it cannot overflow. Forward delete is the
    // backspace glyph mirrored, and the theme already ships that for RTL.
    // No forward delete. It went through three rounds of sizing before anyone
    // asked whether it would ever be pressed — on a Mac there is no such key,
    // and this keyboard is used by someone who has never had one.
    navIcons: {},

    // Portrait is 1404px wide, not 1872, so 17 columns leave 67px each and the
    // word keys ellipsize. The first answer here was to drop to a 13-column
    // layout in portrait, which was giving up on a symptom: what did not fit
    // was the labels, not the layout. Set k6 false to get that fallback back.
    portrait: {
        // The same layout in both orientations. Two layouts means relearning
        // where the keys are every time the tablet turns, which costs more
        // than the narrower keys do — 17 columns of 1404px is 7.5mm a key,
        // which is still a touch target.
        k6: true,

        // What actually broke at that width was the labels, not the layout:
        // "Esc", "Ctrl", "Alt" and "?123" ellipsize at 67px. These are the
        // glyphs a keyboard prints on those very keys, and they are one
        // character wide. Same medicine as the navigation column.
        labels: {
            Esc: '\u238b',
            Tab: '\u21e5',
            Ctrl: '\u2303',
            Alt: '\u2325',
            '?123': '123',
        },
        topRow: {default: '1234567890-=', shift: '!@#$%^&*()_+'},
        columns: 13,
        // The stock body's word keys do not fit 13 narrow columns either. The
        // space bar has the width to spare, and is the one key nobody misses
        // half a column of.
        widths: {tab: 1.5, ctrl: 1.5, symbolSwitch: 2},
    },

    // Every row is balanced to this many columns, or the navigation column
    // stops being a column: rows lay out from the left, so slack shows up as a
    // ragged right edge rather than as a gap where you wanted one.
    columns: 17,

    // Column widths. One key per row is elastic and absorbs whatever the rest
    // of that row leaves over, so changing any width here stays safe.
    widths: {
        nav: 1,
        // Every key this layout places reads its width from here, so tuning
        // the shape of the keyboard never needs the extension reloaded.
        esc: 1.5,
        // Up and down carry the history and the scrollback; left and right
        // only move the cursor. They do not have to be the same size.
        arrow: 1,
        arrowV: 1,
        hide: 1.25,
        ctrl: 1,
        alt: 1,
        emoji: 1,
        langMenu: 1,
        // The left shift matches Tab and Caps above it, so q, a and z stand in
        // one column. The right one stays wide; nothing lines up under it.
        leftShift: 1.5,
        // Wide enough that the icon is not wedged into its cell. Not wide
        // enough for the word "Del", which needs 1.5 — measured, not guessed.
        del: 1.25,
        backspace: 2,
        tab: 1.5,
        backslash: 2.5,
        capsShift: 1.5,
        enter: 3.5,
        shift: 2,
        symbolSwitch: 1.5,
        space: 7.5,
    },
};

const IFACE = `
<node>
  <interface name="org.cver.PnOsk">
    <method name="Capture">
      <arg type="s" name="path" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="Geometry">
      <arg type="s" name="json" direction="out"/>
    </method>
    <method name="Rebuild"/>
    <method name="ShowAppGrid"/>
    <method name="GoToPage">
      <arg type="i" direction="in" name="index"/>
    </method>
    <method name="OpenFolder"/>
    <method name="RenameFolder"/>
    <method name="GridInfo">
      <arg type="s" direction="out" name="info"/>
    </method>
    <method name="Posterise">
      <arg type="u" direction="in" name="levels"/>
      <arg type="b" direction="in" name="invert"/>
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Quantise">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Unquantise">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="SetInputFace">
      <arg type="s" direction="in" name="face"/>
    </method>
    <method name="SuppressCandidates">
      <arg type="b" direction="in" name="suppress"/>
    </method>
    <method name="ShowKeyboard"/>
    <method name="HideKeyboard"/>
    <method name="Palette">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="ArrowInfo">
      <arg type="s" name="json" direction="out"/>
    </method>
    <method name="HideOverview"/>
  </interface>
</node>`;

function configPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'pn-osk.json']);
}

function readConfig() {
    try {
        const [ok, bytes] = GLib.file_get_contents(configPath());
        if (ok) {
            const user = JSON.parse(new TextDecoder().decode(bytes));
            return {...DEFAULTS, ...user, widths: {...DEFAULTS.widths, ...user.widths}};
        }
    } catch (e) {
        // No file, or bad JSON: fall back to defaults rather than breaking the
        // keyboard. A typo in a config file must not cost you your input.
        if (!(e instanceof GLib.FileError))
            console.warn(`[pn-osk] ignoring bad config: ${e.message}`);
    }
    return {...DEFAULTS, widths: {...DEFAULTS.widths}};
}

// The shell's own KeyboardModel reads exactly this, and reading it again is how
// the action keys — delete, enter, the level switches, hide — get reused with
// their real fields instead of being guessed at and quietly rebuilt wrong.
function loadStockLayout(groupName) {
    const file = Gio.File.new_for_uri(
        `resource:///org/gnome/shell/osk-layouts/${groupName}.json`);
    const [, contents] = file.load_contents(null);
    return JSON.parse(new TextDecoder().decode(contents));
}

const charKeys = str => [...(str ?? '')].map(c => ({label: c, strings: [c]}));

// ── Bopomofo caps ───────────────────────────────────────────────────────────
// The standard Daqien bopomofo layout is not a separate geometry. It is the US
// layout with one bopomofo symbol printed on each key. 37 symbols plus 4 tones
// (first tone is Space) exactly fill the letters, the numbers, and - ; , . /.
// Chewing receives US keysyms and maps them itself, so the keyboard geometry
// needs no changes. Only the keycaps need relabelling. This table is that
// relabelling: when the current engine is chewing, every level 0 key gets a
// bopomofo label. The `strings` are untouched; the emitted keysyms are unchanged.
//
// Level 0 only: bopomofo has no shift level. Shift remains uppercase latin
// and symbols.
// Bopomofo only, no latin: a k6 key is 109px (82px in portrait), with 1.1em text.
// An iPad shows large bopomofo and small latin corners, because the reader looks
// for bopomofo. St.Label does not support two-tier layouts, and squeezing two
// characters into one keycap renders both unreadable. The US layout provides latin.
const PN_BOPOMOFO = {
    "1": "ㄅ", "q": "ㄆ", "a": "ㄇ", "z": "ㄈ",
    "2": "ㄉ", "w": "ㄊ", "s": "ㄋ", "x": "ㄌ",
    "e": "ㄍ", "d": "ㄎ", "c": "ㄏ",
    "r": "ㄐ", "f": "ㄑ", "v": "ㄒ",
    "5": "ㄓ", "t": "ㄔ", "g": "ㄕ", "b": "ㄖ",
    "y": "ㄗ", "h": "ㄘ", "n": "ㄙ",
    "u": "ㄧ", "j": "ㄨ", "m": "ㄩ",
    "8": "ㄚ", "i": "ㄛ", "k": "ㄜ", ",": "ㄝ",
    "9": "ㄞ", "o": "ㄟ", "l": "ㄠ", ".": "ㄡ",
    "0": "ㄢ", "p": "ㄣ", ";": "ㄤ", "/": "ㄥ",
    "-": "ㄦ",
    "6": "ˊ", "3": "ˇ", "4": "ˋ", "7": "˙",
};

// The active IBus engine name. InputSourceManager is internal to the shell,
// avoiding a D-Bus round trip.
function currentEngineId() {
    try {
        const src = InputSourceStatus.getInputSourceManager().currentSource;
        return src?.type === "ibus" ? src.id : null;
    } catch (e) {
        return null;
    }
}
const faceFor = (setting, level) =>
    level === 1 ? setting?.shift ?? setting?.default ?? '' : setting?.default ?? '';

// Widths are applied to copies: the originals are this build's model objects,
// and _addRowKeys consumes them by mutating their `strings`.
const sized = (key, width) => (key ? {...key, width} : null);

// Each row nominates one key to absorb the slack, so a width change anywhere
// cannot leave the right edge ragged. Returns the row with that key resized.
function balance(row, flexIndex, columns) {
    row = quantizeRow(row);
    const total = row.reduce((sum, k) => sum + (k.width ?? 1), 0);
    const slack = quantize(columns) - total;
    if (!slack || flexIndex < 0 || flexIndex >= row.length)
        return row;
    const flex = row[flexIndex];
    const width = quantize((flex.width ?? 1) + slack);
    if (width < 1) {
        console.warn(`[pn-osk] row does not fit in ${columns} columns; leaving it ragged`);
        return row;
    }
    return row.map((k, i) => (i === flexIndex ? {...k, width} : k));
}

// KeyContainer attaches keys to a Clutter.GridLayout with width * KEY_SIZE,
// KEY_SIZE is 2, and GridLayout.attach takes integers — so half a column is the
// finest this keyboard can express, and anything narrower is silently truncated
// down. 1.25 renders as 1, which is how a navigation column set to 1.25 spent
// several revisions looking exactly 0.5 columns too narrow.
const QUANTUM = 0.5;
const quantize = v => Math.max(QUANTUM, Math.round((v ?? 1) / QUANTUM) * QUANTUM);

function quantizeRow(row) {
    return row.map(k => {
        const w = quantize(k.width ?? 1);
        return w === (k.width ?? 1) ? k : {...k, width: w};
    });
}

// The app grid decides its column count first and then picks the largest icon
// size that still fits, so widening a cell is a matter of asking for fewer
// columns — not of setting icon-size, whose ceiling is 96 and which the layout
// does not consult anyway. Stock modes are 3/4/6/8 columns; on this panel the
// 8-column mode wins and app names ellipsize at about seven characters.
//
// Portrait is 5 columns instead of 6, so this is not a transpose. A transpose
// is tempting but physically impossible on this panel: the horizontal usable
// area is 936x578 and portrait is 702x807. After subtracting the fixed-height
// search bar, the two orientations are not inverses, and no transposed mode
// fits both. 6 columns of 120px is 720px squeezed into 723px, leaving 3px to
// distribute. The row spacing was crushed to 12.6px (compared to 24.6px in
// landscape), while leaving 148px dead space on the right since cells are
// square. Dropping to 5 columns means the largest icon size that fits both
// orientations is no longer constrained by portrait (56 -> 64), while landscape
// remains at 24 per page. The trade-off is differing capacities per page.
// Folders remain at the stock 3x3. 4x4 was tested: setGridModes only changes
// the layout, not the capacity. Pagination is persistent, so a 4-column layout
// still rendered 9 items per page — a folder of 11 left 2 on the second page
// and spawned a navigation arrow. _updatePages() only pushes overflows forward;
// _fillItemVacancies() failed to pull items back. Fixing that requires
// rewriting pagination entirely, and pagination is state, not geometry.

const PN_GRID_MODES = [
    {rows: 5, columns: 4},   // Portrait
    {rows: 4, columns: 6},   // Landscape
];

// ControlsState.APP_GRID. overviewControls.js does not export this enum, and an
// extension cannot import a module-scoped const. It is hardcoded here. These
// are the shell's public state ordinals (HIDDEN=0, WINDOW_PICKER=1,
// APP_GRID=2), not arbitrary values.
const PN_STATE_APP_GRID = 2;

// BaseAppViewGridLayout is not exported. The instance is attached to an
// internal container's layoutManager without a stable public path. It is found
// by feature detection, as the only layout with _getIndicatorsWidth.
function pnFindGridLayout(actor) {
    if (!actor)
        return null;
    const lm = actor.layoutManager ?? actor.layout_manager;
    if (lm && typeof lm._getIndicatorsWidth === "function")
        return lm;
    const children = actor.get_children ? actor.get_children() : [];
    for (const child of children) {
        const found = pnFindGridLayout(child);
        if (found)
            return found;
    }
    return null;
}

function pnOverviewControls() {
    return Main.overview?._overview?._controls ?? null;
}

function pnAppGrid() {
    return Main.overview?._overview?._controls?._appDisplay?._grid ?? null;
}

// The stock caps key carries an icon and no label. Swapping in a label means
// dropping the icon, or the icon wins and the text never shows.
function capsNamed(key, cfg, level) {
    const labels = {...DEFAULTS.capsLabels, ...cfg.capsLabels};
    const text = level === 0 ? labels.default : labels.latched;
    if (!text)
        return key;
    const {iconName, ...rest} = key;
    return {...rest, label: text};
}

// Swap the printed face of a key without touching what it does.
function relabel(rows, map) {
    if (!map)
        return rows;
    return rows.map(row => row.map(
        k => (k.label && map[k.label] !== undefined ? {...k, label: map[k.label]} : k)));
}

// Relabel by what the key emits, not by what it shows. The stock layout's
// letter keys lack a label and only have strings. The charKeys we build have
// both. This logic accepts either and only modifies the label. The strings are
// untouched, leaving the emitted keysyms unchanged.
function relabelByString(rows, map) {
    if (!map)
        return rows;
    return rows.map(row => row.map(k => {
        const key = k.strings?.[0] ?? k.label;
        return key && map[key] !== undefined ? {...k, label: map[key]} : k;
    }));
}

// GNOME 48 renamed every keyboard-specific OSK icon to an osk- prefix.
// The generic go-*-symbolic arrows were left alone. Matching both names keeps
// one extension working on 47 and 48 - and the only one of these that mattered
// was enter, because it is the sole icon behind _composeLevel's return null.
const OSK_ICON_ALIASES = {
    'keyboard-enter-symbolic': 'osk-enter-symbolic',
    'keyboard-caps-lock-symbolic': 'osk-caps-lock-symbolic',
    'keyboard-shift-symbolic': 'osk-shift-symbolic',
    'keyboard-hide-symbolic': 'osk-hide-symbolic',
    'keyboard-layout-symbolic': 'osk-layout-symbolic',
    'face-smile-symbolic': 'osk-emoji-picker-symbolic',
    'edit-clear-symbolic': 'osk-delete-symbolic',
};
const byIcon = name => {
    const alias = OSK_ICON_ALIASES[name];
    return k => k.iconName === name ||
        (alias !== undefined && k.iconName === alias);
};
const byAction = name => k => k.action === name;

// 🔴 In the stock layout JSON, keyval is a hexadecimal string ('0xff0d'), not a number.
//
// Providing a number does not throw; it emits the wrong key. parseInt(65307, 16)
// coerces the number to "65307" before parsing it as hex, resulting in 0x65307
// = 414983, which is an entirely different keysym. The symptom was a dead key,
// not an error in the journal.
//
// Keys salvaged from the stock layout (Enter, Backspace, arrows) carried their
// strings and worked correctly. The broken ones were the five we built: Esc,
// Home, End, PgUp, PgDn. The broken set mapped exactly to the bespoke set,
// which isolated the cause.
const hexKeyval = n => {
    if (typeof n !== 'number') {
        console.error(`pn-osk: hexKeyval expects a number, got ${typeof n} (${n})`);
        return n;
    }
    return `0x${n.toString(16)}`;
};

// Verify before yielding: log if any keyval is not a string. The failure to
// check this type was why the bug above survived unnoticed since installation.
function auditKeyvals(rows, where) {
    for (const row of rows ?? []) {
        for (const k of row ?? []) {
            if (k && 'keyval' in k && typeof k.keyval !== 'string')
                console.error(`pn-osk: ${where}: keyval on ${k.label ?? k.iconName ?? '?'} `
                            + `is ${typeof k.keyval}, must be a hex string like "0xff1b"`);
        }
    }
    return rows;
}

const keyval = (label, key) => ({label, keyval: hexKeyval(key)});

function box(actor) {
    if (!actor)
        return null;
    try {
        const b = actor.get_allocation_box();
        const out = {
            x: Math.round(b.x1),
            y: Math.round(b.y1),
            w: Math.round(b.x2 - b.x1),
            h: Math.round(b.y2 - b.y1),
        };
        if (actor instanceof St.Widget) {
            const node = actor.get_theme_node();
            out.padding = [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM, St.Side.LEFT]
                .map(s => Math.round(node.get_padding(s)));
        }
        return out;
    } catch (e) {
        return {error: e.message};
    }
}

export default class PineNoteOskExtension extends Extension {
    enable() {
        const proto = Keyboard.prototype;

        this._origRelayout = proto._relayout;
        this._origUpdateLayout = proto._updateLayout;
        this._origAddRowKeys = proto._addRowKeys;

        const ext = this;
        this._config = readConfig();
        this._pnDockCandidatePopup();

        proto._relayout = function (...args) {
            ext._origRelayout.apply(this, args);

            // Rotating the device resizes the band but does not rebuild the
            // layout, and the orientation is only sampled while composing — so
            // the keyboard kept wearing whichever shape it was built in. This
            // is the one place that does hear about monitor changes.
            const monitor = Main.layoutManager.keyboardMonitor;
            const landscape = !monitor || monitor.width > monitor.height;
            if (this._pnBuiltLandscape !== undefined &&
                this._pnBuiltLandscape !== landscape) {
                this._pnBuiltLandscape = landscape;   // set first: _updateKeys re-enters here
                this._updateKeys();
            }

            if (ext._config.fillWidth)
                ext._forceFullWidth(this);
        };

        proto._updateLayout = function (groupName, purpose) {
            ext._config = readConfig();
            this._pnPurpose = purpose;
            if (ext._config.trace)
                log(`[pn-osk] _updateLayout group=${groupName} purpose=${purpose} TERMINAL=${Clutter.InputContentPurpose.TERMINAL} k6=${ext._config.k6Layout}`);

            // Compose the whole terminal layout up front. _addRowKeys is told
            // nothing about which level it is building, so the containers get
            // tracked as they first appear and matched against this by index.
            this._pnLevels = [];
            this._pnComposed = null;
            const monitor = Main.layoutManager.keyboardMonitor;
            const landscape = !monitor || monitor.width > monitor.height;
            this._pnBuiltLandscape = landscape;
            // The terminal is this layout's origin, but Esc, Tab, and the number row
            // remain necessary for standard text input. Renaming a folder without Esc
            // forces a commit. Specific purposes (password, number, phone, email, URL)
            // are left to GNOME, which provides specialized layouts for them;
            // overriding those would be a regression.
            const composeFor = [
                Clutter.InputContentPurpose.TERMINAL,
                Clutter.InputContentPurpose.NORMAL,
            ];
            if (composeFor.includes(purpose) && ext._config.k6Layout)
                this._pnComposed = ext._composeLayout(groupName, landscape);

            const ret = ext._origUpdateLayout.call(this, groupName, purpose);

            // _relayout only runs on monitor changes, so installing the ratio
            // override from there leaves it uninstalled after the extension is
            // re-enabled on a session that already has a keyboard. This runs on
            // every rebuild, which is the honest place for it.
            if (ext._config.fillWidth)
                ext._forceFullWidth(this);
            return ret;
        };

        proto._addRowKeys = function (keys, layout, emojiVisible) {
            this._pnLevels ??= [];
            let level = this._pnLevels.indexOf(layout);
            if (level < 0) {
                level = this._pnLevels.push(layout) - 1;
                layout._pnRow = 0;
            }
            const row = layout._pnRow++;
            if (ext._config.trace)
                log(`[pn-osk] _addRowKeys level=${level} row=${row} hasComposed=${!!this._pnComposed} composedLen=${this._pnComposed?.length ?? -1} landscape=${this._pnBuiltLandscape}`);

            const composed = this._pnComposed?.[level];
            if (!composed)
                return ext._origAddRowKeys.call(this, keys, layout, emojiVisible);

            // Five composed rows against the model's four: the first call emits
            // two of them, opening a row in between.
            if (row === 0) {
                ext._origAddRowKeys.call(this, composed[0], layout, emojiVisible);
                layout.appendRow();
                return ext._origAddRowKeys.call(this, composed[1], layout, emojiVisible);
            }
            return ext._origAddRowKeys.call(
                this, composed[row + 1] ?? keys, layout, emojiVisible);
        };

        this._exportDBus();
        this._rebuild();
        console.log(`[pn-osk] enabled, build=${BUILD}`);

        // App grid as full-screen launcher: reclaim the vertical space reserved
        // for workspace previews and the dash.
        this._pnLaunchpadTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._pnLaunchpadTimeoutId = 0;
            this._pnInstallLaunchpad();
            return GLib.SOURCE_REMOVE;
        });

        // app grid: fewer columns so the labels stop ellipsizing
        this._pnGridTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            const grid = pnAppGrid();
            if (grid) {
                grid.setGridModes(PN_GRID_MODES);
                if (this._config?.trace)
                    log('[pn-osk] app grid modes overridden');
            }
            this._pnGridTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });

        // The posteriser. This shares the 2-second delay with the two above
        // because these actors are not initialized during enable(), and
        // _workspacesDisplay arrives particularly late.
        this._pnPosteriseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            this._pnPosteriseTimeoutId = 0;
            try {
                const out = this.Posterise(PN_POSTERISE_LEVELS, PN_POSTERISE_INVERT);
                console.log(`[pn-osk] posterise at enable: ${out}`);
            } catch (e) {
                logError(e, "[pn-osk] posterise at enable");
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _pnInstallLaunchpad() {
        const controls = pnOverviewControls();
        const layout = controls?.layout_manager;
        if (!layout || this._pnLaunchpadInstalled)
            return;

        // 1) Set workspace preview height to zero in APP_GRID. AppDisplay
        //    computes its own position from this box's height, so it moves up
        //    automatically without requiring explicit coordinate changes.
        this._pnOrigWorkspacesBox = layout._computeWorkspacesBoxForState;
        layout._computeWorkspacesBoxForState = (state, ...args) => {
            const box = this._pnOrigWorkspacesBox.call(layout, state, ...args);
            if (state === PN_STATE_APP_GRID)
                box.set_size(box.get_width(), 0);
            return box;
        };

        // 2) Expand AppDisplay to the bottom edge in APP_GRID. The stock math
        //    subtracts dashHeight, which is the space being reclaimed.
        this._pnOrigAppDisplayBox = layout._getAppDisplayBoxForState;
        layout._getAppDisplayBoxForState =
            (state, box, searchHeight, dashHeight, workspacesBox, spacing) => {
                if (state !== PN_STATE_APP_GRID) {
                    return this._pnOrigAppDisplayBox.call(
                        layout, state, box, searchHeight, dashHeight, workspacesBox, spacing);
                }
                const [width, height] = box.get_size();
                const startY = layout._workAreaBox.y1;
                const appBox = new Clutter.ActorBox();
                // Start from the search bar's row rather than below it. This extra
                // space is borrowed for the pagination arrows. The grid pushes itself
                // down during its own allocate, leaving the visual content starting
                // below the search bar.
                // Reserve a band at the bottom for the page indicators. Handing
                // the whole screen to the grid pushed them against the edge:
                // measured, their ink ended 5 device pixels from the bottom in
                // landscape and off it in portrait. The dots are ~13 device
                // pixels tall, so this leaves roughly their own height again
                // below them.
                const appHeight =
                    height - searchHeight - spacing - PN_PAGE_INDICATOR_ROOM;
                const appWidth = this._pnCanvasWidth(width, appHeight);
                appBox.set_origin(
                    Math.round((width - appWidth) / 2),
                    startY + searchHeight + spacing);
                appBox.set_size(appWidth, appHeight);
                // Expose the reserved height (searchHeight + spacing) for the grid.
                this._pnTopInset = searchHeight + spacing;
                return appBox;
            };

        // 3) Hide the dash in APP_GRID. The layout process still allocates it,
        //    and extracting that logic is not worth the risk. It is removed by
        //    making it invisible and unclickable.
        this._pnStateSignal = controls._stateAdjustment.connect('notify::value', () => {
            const v = controls._stateAdjustment.value;
            const inAppGrid = v > 1.5;
            controls.dash.opacity = inAppGrid ? 0 : 255;
            controls.dash.reactive = !inAppGrid;
            // A zero-height box does not remove an actor; it draws itself at its
            // minimum size, which manifested as a black rectangle on the right.
            // Removing it requires setting visible to false.
            const wd = controls._workspacesDisplay;
            if (wd)
                wd.visible = !inAppGrid;
        });

        // Reclaim the horizontal gutters reserved for arrows. The margin and the
        // arrow allocation are the same value. Setting it to 0 allows the grid
        // to fill the width. The arrows rest on the edge, and paging is still
        // accessible via swipe.
        const gridLayout = pnFindGridLayout(controls._appDisplay);
        if (gridLayout) {
            this._pnGridLayout = gridLayout;
            this._pnOrigIndicatorsWidth = gridLayout._getIndicatorsWidth;
            gridLayout._getIndicatorsWidth = () => 0;
            gridLayout.layout_changed();
            this._pnInstallTopArrows();
            this._pnFloatArrows();
            this._pnInstallLabelWrap();

            // Measurement requires the first layout pass, but the cache does not.
            // Applying the cache ensures the first frame is correct.
            // _pnSyncIconSize will still measure and update if it diverges.
            const cached = this._pnReadCachedIconSize();
            const lm0 = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
            if (cached && lm0 && lm0.fixedIconSize !== cached)
                this._pnApplyIconSize(lm0, cached);
            this._pnInstallModeChoice();
            this._pnInstallDialogWatch();
            if (this._config?.trace)
                console.log("[pn-osk] indicators gutter reclaimed");
        } else if (this._config?.trace) {
            console.log("[pn-osk] grid layout not found - gutter left alone");
        }

        layout.layout_changed();
        this._pnLaunchpadInstalled = true;
        if (this._config?.trace)
            console.log('[pn-osk] launchpad layout installed');
    }

    _pnInstallTopArrows() {
        const gl = this._pnGridLayout;
        if (!gl || this._pnArrowsMoved)
            return;

        const proto = Object.getPrototypeOf(gl);
        if (proto._pnPatched)
            return;

        const ext = this;
        const origAllocate = proto.vfunc_allocate;
        proto._pnOrigAllocate = origAllocate;
        proto.vfunc_allocate = function (container, box) {
            // Read from the search entry directly instead of relying on variables
            // passed between objects. The two allocate calls are not guaranteed to
            // be synchronous, and the first pass reliably returned 0.
            const controls = pnOverviewControls();
            const entry = controls?._searchEntryBin ?? controls?._searchEntry;
            const inset = entry ? entry.height + Math.round(entry.height * 0.15) : 0;
            if (!inset) {
                origAllocate.call(this, container, box);
                return;
            }

            // The grid yields the top row.
            const gridBox = box.copy();
            gridBox.y1 += inset;
            this._grid.indicatorsPadding = new Clutter.Margin({left: 0, right: 0});
            this._scrollView.allocate(gridBox);

            // The arrows are placed at the ends of the yielded row.
            const ltr = container.get_text_direction() !== Clutter.TextDirection.RTL;
            const [width] = box.get_size();
            const side = Math.round(width * 0.12);

            const topLeft = box.copy();
            topLeft.y2 = topLeft.y1 + inset;
            topLeft.x2 = topLeft.x1 + side;

            const topRight = box.copy();
            topRight.y2 = topRight.y1 + inset;
            topRight.x1 = topRight.x2 - side;

            this._previousPageIndicator.allocate(ltr ? topLeft : topRight);
            this._previousPageArrow.allocate_align_fill(
                ltr ? topLeft : topRight, 0.5, 0.5, false, false);
            this._nextPageIndicator.allocate(ltr ? topRight : topLeft);
            this._nextPageArrow.allocate_align_fill(
                ltr ? topRight : topLeft, 0.5, 0.5, false, false);

            this._pageWidth = box.get_width();
        };
        proto._pnPatched = true;
        this._pnArrowsMoved = true;
        gl.layout_changed();
        if (this._config?.trace)
            console.log("[pn-osk] page arrows moved to the search row");
    }

    _pnRemoveTopArrows() {
        const gl = this._pnGridLayout;
        if (!gl)
            return;
        const proto = Object.getPrototypeOf(gl);
        if (proto._pnOrigAllocate) {
            proto.vfunc_allocate = proto._pnOrigAllocate;
            delete proto._pnOrigAllocate;
            delete proto._pnPatched;
            gl.layout_changed();
        }
        this._pnArrowsMoved = false;
    }

    // Label width: the first pass provides a value close to the current cell
    // (119 - tile padding), and the second pass computes it from the canvas
    // once childSize is known.
    // 🔴 The mode (column and row counts) must be derived from the screen ratio,
    // not from the page size. The page width is now computed, and passing it
    // back into _findBestModeForSize turns the output into the input. After
    // rotation, it read the narrow canvas from the previous orientation, selected
    // the mode for that orientation, which kept the canvas narrow. This loop
    // locked the layout into portrait mode.
    _pnInstallModeChoice() {
        const grid = pnOverviewControls()?._appDisplay?._grid;
        if (!grid || grid._pnOrigFindBestMode)
            return;
        grid._pnOrigFindBestMode = grid._findBestModeForSize;
        grid._findBestModeForSize = () => {
            const mon = Main.layoutManager.primaryMonitor;
            const modes = grid._gridModes ?? [];
            if (!mon || !modes.length)
                return -1;
            const ratio = mon.width / mon.height;
            let best = -1;
            let closest = Infinity;
            for (let i = 0; i < modes.length; i++) {
                const r = modes[i].columns / modes[i].rows;
                if (Math.abs(ratio - r) < Math.abs(ratio - closest)) {
                    closest = r;
                    best = i;
                }
            }
            // 🔴 The stock function does not merely return the index to the
            // caller; it calls _setGridMode itself, and vfunc_allocate ignores
            // the return value completely. A version that only returned the value
            // froze the mode at the orientation active during installation, which
            // appeared correct because that orientation was right at the time.
            grid._setGridMode(best);
            return best;
        };
        grid._currentMode = -1;
        grid.queue_relayout();
    }

    _pnRemoveModeChoice() {
        const grid = pnOverviewControls()?._appDisplay?._grid;
        if (!grid?._pnOrigFindBestMode)
            return;
        grid._findBestModeForSize = grid._pnOrigFindBestMode;
        delete grid._pnOrigFindBestMode;
        grid._currentMode = -1;
        grid.queue_relayout();
    }

    // Cache the measured icon size. It can only be computed after the first
    // allocation pass because it requires _pageHeight. Without a cache, the
    // first frame after boot uses the fallback from _findBestIconSize. That
    // returned 96 when the correct value was 64, which manifested as a visible
    // shrink on screen.
    _pnIconSizeCachePath() {
        return GLib.build_filenamev([GLib.get_user_cache_dir(), "pn-osk-iconsize"]);
    }

    _pnReadCachedIconSize() {
        try {
            const [ok, data] = GLib.file_get_contents(this._pnIconSizeCachePath());
            if (!ok)
                return 0;
            const n = parseInt(new TextDecoder().decode(data).trim(), 10);
            return Number.isFinite(n) && n >= 16 && n <= 96 ? n : 0;
        } catch {
            return 0;
        }
    }

    _pnWriteCachedIconSize(size) {
        try {
            GLib.file_set_contents(this._pnIconSizeCachePath(), `${size}\n`);
        } catch (e) {
            // A cache write failure means the next boot will shrink again. It is
            // not worth interrupting other operations.
            console.log(`[pn-osk] icon size cache not written: ${e.name}`);
        }
    }

    // Icon size is a constant, not a remainder. Compute the maximum fit for both
    // orientations and take the smaller one. This ensures icons do not resize
    // during rotation; only the spacing changes.
    _pnSyncIconSize() {
        const lm = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        const grid = pnOverviewControls()?._appDisplay?._grid;
        const mon = Main.layoutManager.primaryMonitor;
        const pad = lm?.pagePadding;
        if (!lm || !grid || !mon || !pad || !lm._pageHeight)
            return;

        // Cell = icon + fixed overhead (two-line label + tile padding). This
        // difference is independent of icon size, so measuring it once allows
        // computing the cell size for any icon size.
        const overhead = lm._getChildrenMaxSize() - lm.iconSize;
        if (overhead <= 0)
            return;

        // Top panel + search bar + grid margins. Measure this rather than
        // deriving it. Deriving it resulted in a 16px discrepancy between the
        // two axes.
        const chromeV = mon.height - lm._pageHeight;

        const modes = grid._gridModes ?? [];
        const pickMode = (w, h) => {
            const ratio = (w - pad.left - pad.right) / (h - pad.top - pad.bottom);
            let best = null;
            let closest = Infinity;
            for (const m of modes) {
                const r = m.columns / m.rows;
                if (Math.abs(ratio - r) < Math.abs(ratio - closest)) {
                    closest = r;
                    best = m;
                }
            }
            return best;
        };

        let fits = Infinity;
        // The current orientation, and the other one.
        for (const [w, h] of [[mon.width, mon.height], [mon.height, mon.width]]) {
            const pageH = h - chromeV;
            const mode = pickMode(w, pageH);
            if (!mode || pageH <= 0)
                continue;
            const byHeight = (pageH - pad.top - pad.bottom -
                lm.rowSpacing * (mode.rows - 1)) / mode.rows;
            const byWidth = (w - pad.left - pad.right -
                lm.columnSpacing * (mode.columns - 1)) / mode.columns;
            fits = Math.min(fits, Math.floor(Math.min(byHeight, byWidth)));
        }
        if (!Number.isFinite(fits))
            return;

        // The ceiling remains 96: that is the maximum size expected by the shell
        // and icon themes. Going larger requires a separate solution.
        // Snap to a multiple of 4. chromeV (panel + search bar) can only be
        // measured for the active orientation, and the two differ by a few pixels.
        // Using the raw value caused icons to jump by 1px during rotation — the
        // exact behavior this layout prevents. Snapping absorbs the measurement
        // noise at the cost of 3px at most.
        const raw = Math.max(16, Math.min(96, fits - overhead));
        const size = Math.floor(raw / 4) * 4;
        if (lm.fixedIconSize === size || this._pnIconSizePending === size)
            return;
        // This is called during the allocation pass, which is the only time
        // _pageHeight has a value. Changing properties and triggering a
        // layout_changed there requests a layout inside a layout pass. Defers to
        // idle to let the current frame complete.
        this._pnIconSizePending = size;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pnIconSizePending = null;
            const l = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
            if (l && l.fixedIconSize !== size) {
                this._pnApplyIconSize(l, size);
                this._pnWriteCachedIconSize(size);
                console.log(`[pn-osk] icon size pinned to ${size} (overhead ${overhead})`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Cells are square, and edge length is dictated by height. That is a hard
    // constraint. The width should not be "the screen width", but "the width
    // required for horizontal spacing to equal vertical spacing". Computing this
    // directly removes the need to clamp via max-column-spacing, which eliminates
    // the dead space left behind by the clamp.
    _pnCanvasWidth(fullWidth, height) {
        const lm = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        if (!lm?._getChildrenMaxSize)
            return fullWidth;
        this._pnSyncIconSize();

        // Re-measure every time: childSize is cached, and the label height is
        // only valid after the canvas is computed. Computing width from the
        // previous frame's edge length caused the gaps to diverge (19.4 vs 14).
        // The cost of re-measuring 26 items is cheaper than a layout that is
        // permanently one frame behind.
        lm._childrenMaxSize = -1;
        const cell = lm._getChildrenMaxSize();
        const rows = lm.rowsPerPage;
        const cols = lm.columnsPerPage;
        const pad = lm.pagePadding;
        if (!cell || rows < 2 || cols < 2 || !pad)
            return fullWidth;

        // 🔴 Read height from the layout, not from our computed value. The
        // appHeight passed here is the box given to AppDisplay, while the grid
        // computes vertical spacing from _pageHeight. The two differ by 16px
        // (the grid's own margins). Using the wrong one yielded a 19.3px gap when
        // the layout used 14px. A single value needs a single source of truth.
        const h = lm._pageHeight || height;
        const emptyV = h - pad.top - pad.bottom - cell * rows -
            lm.rowSpacing * (rows - 1);
        // The maximum limits the actual gap, and the layout turns the remainder
        // into vertical margins. The canvas must be computed using the
        // **clamped** value; otherwise the horizontal gap will be wider.
        const rawGap = lm.rowSpacing + Math.max(emptyV, 0) / (rows - 1);
        const gap = lm.maxRowSpacing > 0
            ? Math.min(rawGap, lm.maxRowSpacing) : rawGap;

        // Apply the same gap to the horizontal axis to compute the canvas.
        const want = cell * cols + gap * (cols - 1) + pad.left + pad.right;
        return Math.round(Math.min(fullWidth, Math.max(want, cell * cols)));
    }

    _pnLabelWidth() {
        const lm = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        const cell = lm?._getChildrenMaxSize ? lm._getChildrenMaxSize() : 119;
        return Math.max(96, cell - 12);
    }

    _pnApplyWrap(item) {
        const label = item?.icon?.label;
        if (!label)
            return;
        const ct = label.clutter_text;
        if (item._pnWrapSaved === undefined) {
            item._pnWrapSaved = {
                yAlign: ct.y_align,
                lineWrap: ct.line_wrap,
                lineWrapMode: ct.line_wrap_mode,
                ellipsize: ct.ellipsize,
                width: label.width,
                height: label.height,
                // Measure the single-line height before wrapping is enabled. It
                // cannot be measured afterwards.
                oneLine: label.get_preferred_height(-1)[1],
            };
        }
        // Constrain width before enabling line wrap. If reversed, the natural
        // width during the intermediate frame is the entire string of text.
        label.set_width(this._pnLabelWidth());
        // Pin the height to two lines. Without this, _getChildrenMaxSize calls
        // get_preferred_height(-1), which measures unbounded width (one line).
        // The second line receives no allocation, and the third line is pushed
        // out of bounds.
        label.set_height(item._pnWrapSaved.oneLine * PN_LABEL_LINES);
        ct.set({
            // BaseIcon sets CENTER during construction. A single-line name will
            // float in the middle of the two-line space, leaving a gap above it.
            // START alignment keeps it flush with the icon.
            y_align: Clutter.ActorAlign.START,
            line_wrap: true,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
            // Ellipsize only if it still overflows after wrapping (e.g., a word
            // with no breaks).
            ellipsize: Pango.EllipsizeMode.END,
        });
    }

    // Setting fixedIconSize is insufficient: the renderer reads _iconSize, which
    // is only updated when adaptToSize observes a page size change and schedules
    // a BEFORE_REDRAW pass. This applies the update directly.
    _pnApplyIconSize(lm, size) {
        lm.fixedIconSize = size;
        lm._iconSize = size;
        for (const child of lm._container ?? [])
            child.icon?.setIconSize?.(size);
        lm._childrenMaxSize = -1;
        lm.layout_changed();
    }

    // The entry point for renaming changes from the pencil button to a title tap.
    // The button is hidden (its checked state can still be toggled). The tap area
    // is added to the Shell.Stack, which stacks its children, placing the tap area
    // over the title.
    _pnInstallTitleTap(dialog) {
        const btn = dialog?._editButton;
        const stack = dialog?._folderNameLabel?.get_parent();
        if (!btn || !stack || dialog._pnTitleTap)
            return;

        // Hide rather than make invisible: BoxLayout allocates no space for hidden
        // children. The ghostButton's size is bound to it, so its allocation drops
        // to zero, allowing the title to center across the full width.
        btn.hide();

        const tap = new St.Button({
            name: "pn-folder-title-tap",
            x_expand: true,
            y_expand: true,
            reactive: true,
            can_focus: false,
        });
        stack.add_child(tap);
        dialog._pnTitleTap = tap;

        tap.connect("clicked", () => (btn.checked = true));

        // 🔴 The tap area must yield during editing. Otherwise, it covers the
        // text input, preventing the cursor from being placed. The symptom was a
        // broken rename feature, without an obvious link to the tap area.
        const sync = () => (tap.visible = !btn.checked);
        dialog._pnTitleTapSignal = btn.connect("notify::checked", sync);
        sync();
    }

    _pnRemoveTitleTap(dialog) {
        if (!dialog?._pnTitleTap)
            return;
        if (dialog._pnTitleTapSignal) {
            dialog._editButton?.disconnect(dialog._pnTitleTapSignal);
            dialog._pnTitleTapSignal = 0;
        }
        dialog._pnTitleTap.destroy();
        dialog._pnTitleTap = null;
        dialog._editButton?.show();
    }

    // Folder icons match the launcher size. FolderGrid uses a separate layout
    // manager, so the outer icon size does not inherit. Its default is
    // IconSize.LARGE (96), which fits precisely in the stock 720px dialog.
    // Shrinking the dialog crushed the icons to 64, which manifested as a visible
    // shrink. Pinning the size before the popup ensures the first frame is correct.
    _pnSyncFolderIconSize(view) {
        const lm = view?._grid?.layout_manager;
        const outer = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        const size = outer?.fixedIconSize;
        if (!lm || !size || size < 16 || lm.fixedIconSize === size)
            return;
        this._pnApplyIconSize(lm, size);
    }

    // Folder items are managed by the FolderView itself, separate from
    // appDisplay._orderedItems.
    _pnApplyWrapToView(view) {
        for (const item of view?._orderedItems ?? [])
            this._pnApplyWrap(item);
        view?._grid?.layout_manager?.layout_changed();
    }

    _pnInstallLabelWrap() {
        const appDisplay = pnOverviewControls()?._appDisplay;
        if (!appDisplay || this._pnWrapInstalled)
            return;
        this._pnWrapInstalled = true;

        const apply = () => {
            for (const item of appDisplay._orderedItems ?? []) {
                this._pnApplyWrap(item);
                // Folder content exists now (FolderIcon.view) and does not need
                // to wait for the dialog. Waiting until the dialog is built means
                // the first frame is already drawn without wrapping.
                if (item.view) {
                    this._pnSyncFolderIconSize(item.view);
                    this._pnApplyWrapToView(item.view);
                }
            }
            appDisplay._grid?.layout_manager?.layout_changed();
        };
        apply();
        // The grid is rebuilt after an app installation. Without this, the new
        // icon would be the only one with truncated text.
        this._pnWrapViewSignal = appDisplay.connect('view-loaded', apply);
    }

    _pnRemoveLabelWrap() {
        const appDisplay = pnOverviewControls()?._appDisplay;
        if (this._pnWrapViewSignal && appDisplay) {
            appDisplay.disconnect(this._pnWrapViewSignal);
            this._pnWrapViewSignal = 0;
        }
        for (const item of appDisplay?._orderedItems ?? []) {
            const saved = item._pnWrapSaved;
            const label = item?.icon?.label;
            if (!saved || !label)
                continue;
            label.set_width(saved.width);
            label.set_height(saved.height);
            label.clutter_text.set({
                y_align: saved.yAlign,
                line_wrap: saved.lineWrap,
                line_wrap_mode: saved.lineWrapMode,
                ellipsize: saved.ellipsize,
            });
            delete item._pnWrapSaved;
        }
        appDisplay?._grid?.layout_manager?.layout_changed();
        this._pnWrapInstalled = false;
    }

    _pnFloatArrows() {
        const gl = this._pnGridLayout;
        const controls = pnOverviewControls();
        if (!gl || !controls || this._pnArrows)
            return;

        const prev = gl._previousPageArrow;
        const next = gl._nextPageArrow;
        if (!prev || !next)
            return;

        // Store the original parent: required for restoration on disable, and
        // the decoys must reside there (see below).
        this._pnArrowHome = prev.get_parent();
        this._pnArrows = {prev, next};

        for (const arrow of [prev, next]) {
            arrow.get_parent()?.remove_child(arrow);
            // Call addChrome for each arrow instead of adding a full-screen layer
            // to hold them. A full-screen layer carries affectsInputRegion, which
            // acts as a transparent sheet over the screen, deadening taps even on
            // the top bar. The arrows need input region, but only the arrows do.
            Main.layoutManager.addChrome(arrow, {
                trackFullscreen: false,
                affectsStruts: false,
                affectsInputRegion: true,
            });
            arrow.reactive = true;
            // CENTER alignment requires a parent box to compute size, which chrome
            // does not provide.
            arrow.x_align = Clutter.ActorAlign.START;
            arrow.y_align = Clutter.ActorAlign.START;
        }

        // The grid's allocate still calls allocate on the actors pointed to by
        // those two layout properties (Clutter allows this for non-children),
        // crushing them back into the zero-width indicators box. Providing
        // decoys redirects that pass.
        //
        // 🔴 Decoys must have a parent: upstream uses show()/hide() combined with
        // ease({opacity}) for visibility, and ClutterTransition timelines are
        // bound to the stage. No parent means no stage, so the animation never
        // finishes and the hide() inside onComplete never fires. Putting them in
        // the arrows' original container ensures they complete their lifecycle and
        // our state reflects the correct outcome.
        this._pnDecoys = {
            prev: new St.Widget({name: "pn-arrow-decoy-prev"}),
            next: new St.Widget({name: "pn-arrow-decoy-next"}),
        };
        for (const decoy of [this._pnDecoys.prev, this._pnDecoys.next])
            this._pnArrowHome?.add_child(decoy);
        gl._previousPageArrow = this._pnDecoys.prev;
        gl._nextPageArrow = this._pnDecoys.next;

        this._pnArrowVisSignals = [];
        for (const [key, decoy] of Object.entries(this._pnDecoys)) {
            for (const prop of ["notify::visible", "notify::opacity"]) {
                this._pnArrowVisSignals.push([decoy, decoy.connect(
                    prop, () => this._pnSyncArrowVisibility())]);
            }
            void key;
        }

        this._pnPositionArrows();
        this._pnArrowStateSignal = controls._stateAdjustment.connect(
            "notify::value", () => this._pnPositionArrows());
        this._pnArrowMonitorSignal = Main.layoutManager.connect(
            "monitors-changed", () => this._pnPositionArrows());
        // Animation completion does not equal layout stability. Arrow coordinates
        // are derived from the physical bounds of the search entry and the grid.
        // Waiting for the allocation signal ensures they are correctly positioned,
        // which fires on every layout stabilization and rotation.
        this._pnArrowAllocTarget = controls._appDisplay;
        this._pnArrowAllocSignal = this._pnArrowAllocTarget?.connect(
            "notify::allocation", () => {
                if (this._pnArrowIdle)
                    return;
                this._pnArrowIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._pnArrowIdle = 0;
                    this._pnPositionArrows();
                    return GLib.SOURCE_REMOVE;
                });
            });
    }

    // The floating arrows must hide when a folder dialog is open. They are
    // attached via addChrome, floating above the shell, and only read from
    // _stateAdjustment. The state remains APP_GRID during a dialog, so they
    // have no awareness of the overlay. AppDisplay lacks a public signal, but
    // addFolderDialog is a standard method. Wrapping it provides access to the
    // open-state-changed signal on every dialog.
    _pnInstallDialogWatch() {
        const appDisplay = pnOverviewControls()?._appDisplay;
        if (!appDisplay || appDisplay._pnOrigAddFolderDialog)
            return;
        this._pnDialogs = new Set();
        const ext = this;
        appDisplay._pnOrigAddFolderDialog = appDisplay.addFolderDialog;
        appDisplay.addFolderDialog = function (dialog) {
            appDisplay._pnOrigAddFolderDialog.call(this, dialog);
            ext._pnAdoptDialog(dialog);
        };

        // 🔴 A hook only catches dialogs instantiated **after** it is applied.
        // FolderIcon caches its dialog on `_dialog`, so after a disable/enable
        // cycle (which GNOME does on every stylesheet reload), the existing
        // dialogs never trigger addFolderDialog again. The patch fails silently:
        // the pencil button returns and the title tap area drops. The symptom
        // looked like the feature had been removed, but the cause was **failing
        // to adopt dialogs that already existed**.
        for (const item of appDisplay._orderedItems ?? []) {
            if (item._dialog)
                this._pnAdoptDialog(item._dialog);
        }
    }

    // Everything done to a dialog is shared between creation and adoption — split
    // it in two, and one side eventually misses an item.
    _pnAdoptDialog(dialog) {
        if (!dialog || this._pnDialogs?.has(dialog))
            return;
        const ext = this;
        this._pnSyncFolderIconSize(dialog._view);
        this._pnInstallTitleTap(dialog);
        this._pnDialogs.add(dialog);
        dialog.connect("destroy", () => ext._pnDialogs.delete(dialog));
        // dialog._view is a FolderView, _grid is a FolderGrid (its own layout
        // manager, independent of the outer grid, so the pinned icon size does
        // not apply here)
        this._pnApplyWrapToView(dialog._view);
        // The original handler connects and runs first, so the _displayingDialog
        // we read is already the new value
        dialog.connect('open-state-changed', (o, isOpen) => {
            ext._pnSyncArrowVisibility();
            // Items are created lazily — running this at wrap time misses the ones
            // not yet built
            if (isOpen) {
                ext._pnSyncFolderIconSize(dialog._view);
                ext._pnApplyWrapToView(dialog._view);
            }
        });
    }

    _pnRemoveDialogWatch() {
        for (const dialog of this._pnDialogs ?? [])
            this._pnRemoveTitleTap(dialog);
        this._pnDialogs = null;

        const appDisplay = pnOverviewControls()?._appDisplay;
        if (!appDisplay?._pnOrigAddFolderDialog)
            return;
        appDisplay.addFolderDialog = appDisplay._pnOrigAddFolderDialog;
        delete appDisplay._pnOrigAddFolderDialog;
    }

    // Whether the real arrow should appear = 'upstream thinks it should appear'
    // AND 'currently in the app grid'.
    // The first half is read directly from the decoy — the math for no prev on
    // the first page and no next on the last page is computed by upstream's
    // _syncPageIndicators, and there is no reason to rewrite it.
    _pnSyncArrowVisibility() {
        const controls = pnOverviewControls();
        if (!controls || !this._pnArrows || !this._pnDecoys)
            return;
        const inAppGrid = controls._stateAdjustment.value > 1.5;
        const dialogOpen = !!controls._appDisplay?._displayingDialog;
        for (const key of ["prev", "next"]) {
            const arrow = this._pnArrows[key];
            const decoy = this._pnDecoys[key];
            if (!arrow || !decoy)
                continue;
            arrow.opacity = decoy.opacity;
            arrow.visible = inAppGrid && !dialogOpen &&
                decoy.visible && decoy.opacity > 0;
        }
    }

    _pnPositionArrows() {
        const controls = pnOverviewControls();
        if (!controls || !this._pnArrows)
            return;

        this._pnSyncArrowVisibility();
        if (controls._stateAdjustment.value <= 1.5)
            return;

        this._pnSyncIconSize();

        const mon = Main.layoutManager.primaryMonitor;
        // Ask for _searchEntry first: that is the box with drawn rounded corners.
        // _searchEntryBin is its container, with asymmetrical vertical margins and
        // a centre off by 3px — aligning to the container means aligning to an
        // invisible thing.
        const entry = controls._searchEntry ?? controls._searchEntryBin;
        const {prev, next} = this._pnArrows;
        if (!mon || !entry || !prev || !next)
            return;

        // The vertical centre of the search box row (using its own allocation, not
        // computed)
        const [, entryY] = entry.get_transformed_position();
        const centerY = entryY + entry.height / 2;
        const margin = Math.round(mon.width * 0.03);

        // Position only, size belongs to the stylesheet. An earlier
        // set_size(arrow.width || 48) here overwrote the stylesheet's computed
        // value with a guess — reading 0 wrote 0 straight back.
        // Ask the actor itself for its width (natural width), rather than
        // multiplying CSS px by scale_factor to guess it — that is guessing
        // conversions between two coordinate systems when the actor already knows
        // the answer.
        // Arrows align to the centre of the first/last column. The canvas is
        // computed now and narrower than the screen, so 'flush with the screen
        // edge' and 'on the same vertical line as the apps' are no longer the
        // same thing. Ask the grid for the column centre (leftEmpty and hSpacing
        // from _calculateSpacing), do not compute it.
        const columnCentres = (() => {
            const grid = controls._appDisplay?._grid;
            const lm = grid?.layout_manager;
            if (!lm?._getChildrenMaxSize || !lm._calculateSpacing)
                return null;
            const cell = lm._getChildrenMaxSize();
            const [leftEmpty, , hSpacing] = lm._calculateSpacing(cell);
            const cols = lm.columnsPerPage;
            if (!cell || !cols)
                return null;
            // Do not use get_transformed_position: it returns invalid values
            // before the actor is allocated, and NaN propagates all the way to
            // set_position, causing the arrow to vanish from the screen. We centre
            // the canvas ourselves and the layout holds the width, so the left
            // edge is directly computed.
            const gridX = mon.x + (mon.width - lm._pageWidth) / 2;
            const first = gridX + leftEmpty + cell / 2;
            const last = first + (cols - 1) * (cell + hSpacing);
            return [first, last];
        })();

        // 🔴 Ask only one for its size: the hidden one retains its old preferred
        //    size (measured 52 against 40), and asking them separately causes the
        //    two to compute their centres with different h, missing the mark by
        //    6px. Prefer the one still mapped.
        const sizeFrom = [prev, next].find(a => a.mapped) ?? prev;
        const [, arrowW] = sizeFrom.get_preferred_width(-1);
        const [, arrowH] = sizeFrom.get_preferred_height(-1);

        const place = (arrow, alignRight) => {
            const w = arrowW;
            const h = arrowH;
            const centre = columnCentres?.[alignRight ? 1 : 0];
            // Fall back to the edge if any part computes badly. An arrow placed
            // wrongly is still visible, NaN vanishes entirely.
            const x = Number.isFinite(centre)
                ? centre - w / 2
                : mon.x + (alignRight ? mon.width - margin - w : margin);
            arrow.set_position(Math.round(x), Math.round(centerY - h / 2));
        };
        place(prev, false);
        place(next, true);
    }

    _pnUnfloatArrows() {
        const controls = pnOverviewControls();
        if (this._pnArrowStateSignal && controls) {
            controls._stateAdjustment.disconnect(this._pnArrowStateSignal);
            this._pnArrowStateSignal = 0;
        }
        if (this._pnArrowMonitorSignal) {
            Main.layoutManager.disconnect(this._pnArrowMonitorSignal);
            this._pnArrowMonitorSignal = 0;
        }
        if (this._pnArrowAllocSignal && this._pnArrowAllocTarget) {
            this._pnArrowAllocTarget.disconnect(this._pnArrowAllocSignal);
            this._pnArrowAllocSignal = 0;
            this._pnArrowAllocTarget = null;
        }
        if (this._pnArrowIdle) {
            GLib.source_remove(this._pnArrowIdle);
            this._pnArrowIdle = 0;
        }
        for (const [obj, id] of this._pnArrowVisSignals ?? [])
            obj.disconnect(id);
        this._pnArrowVisSignals = null;

        const lm = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        if (lm && lm.fixedIconSize !== -1) {
            lm.fixedIconSize = -1;
            lm._childrenMaxSize = -1;
            lm.layout_changed();
        }

        const gl = this._pnGridLayout;
        if (gl && this._pnArrows) {
            gl._previousPageArrow = this._pnArrows.prev;
            gl._nextPageArrow = this._pnArrows.next;
        }
        this._pnDecoys?.prev?.destroy();
        this._pnDecoys?.next?.destroy();
        this._pnDecoys = null;

        if (this._pnArrows) {
            for (const arrow of [this._pnArrows.prev, this._pnArrows.next]) {
                if (!arrow)
                    continue;
                Main.layoutManager.removeChrome(arrow);
                arrow.get_parent()?.remove_child(arrow);
                this._pnArrowHome?.add_child(arrow);
                arrow.visible = true;
                arrow.opacity = 255;
            }
            this._pnArrows = null;
            this._pnArrowHome = null;
        }
    }

    _pnRemoveLaunchpad() {
        this._pnRemoveLabelWrap();
        this._pnRemoveModeChoice();
        this._pnRemoveDialogWatch();
        this._pnUnfloatArrows();
        this._pnRemoveTopArrows();

        if (this._pnGridLayout && this._pnOrigIndicatorsWidth) {
            this._pnGridLayout._getIndicatorsWidth = this._pnOrigIndicatorsWidth;
            this._pnGridLayout.layout_changed();
            this._pnGridLayout = null;
            this._pnOrigIndicatorsWidth = null;
        }
        const controls = pnOverviewControls();
        const layout = controls?.layout_manager;
        if (layout && this._pnOrigWorkspacesBox) {
            layout._computeWorkspacesBoxForState = this._pnOrigWorkspacesBox;
            this._pnOrigWorkspacesBox = null;
        }
        if (layout && this._pnOrigAppDisplayBox) {
            layout._getAppDisplayBoxForState = this._pnOrigAppDisplayBox;
            this._pnOrigAppDisplayBox = null;
        }
        if (controls && this._pnStateSignal) {
            controls._stateAdjustment.disconnect(this._pnStateSignal);
            this._pnStateSignal = 0;
            controls.dash.opacity = 255;
            controls.dash.reactive = true;
        }
        layout?.layout_changed();
        this._pnLaunchpadInstalled = false;
    }

    disable() {

        if (this._pnLaunchpadTimeoutId) {
            GLib.source_remove(this._pnLaunchpadTimeoutId);
            this._pnLaunchpadTimeoutId = 0;
        }
        this._pnRemoveLaunchpad();

        if (this._pnGridTimeoutId) {
            GLib.source_remove(this._pnGridTimeoutId);
            this._pnGridTimeoutId = 0;
        }
        const grid = pnAppGrid();
        if (grid)
            grid.setGridModes(null);   // null returns it to shell default

        if (this._pnPosteriseTimeoutId) {
            GLib.source_remove(this._pnPosteriseTimeoutId);
            this._pnPosteriseTimeoutId = 0;
        }
        // Walk the whole tree to tear down, do not walk the list it was attached
        // with — actors get rebuilt, the list leaves orphans.
        this._pnPosteriseClearAll("pn-posterise");

        const proto = Keyboard.prototype;

        if (this._origRelayout)
            proto._relayout = this._origRelayout;
        if (this._origUpdateLayout)
            proto._updateLayout = this._origUpdateLayout;
        if (this._origAddRowKeys)
            proto._addRowKeys = this._origAddRowKeys;
        this._pnUndockCandidatePopup();

        this._origRelayout = null;
        this._origUpdateLayout = null;
        this._origAddRowKeys = null;


        this._dbus?.unexport();
        this._dbus = null;
        if (this._nameId)
            Gio.bus_unown_name(this._nameId);
        this._nameId = 0;

        this._restoreRatio();
        this._rebuild();
    }

    // Rebuild levels 0 (plain) and 1 (shifted) as a 65% keyboard, 17 columns
    // wide. Levels 2 and 3 are the '?123' symbol layers, which already carry
    // their own punctuation and are left exactly as they ship.
    _composeLayout(groupName, landscape) {
        let stock = null;
        for (const name of [`${groupName}-extended`, 'us-extended']) {
            try {
                stock = loadStockLayout(name);
                break;
            } catch (e) {
                // Try the next candidate, exactly as the shell does.
            }
        }
        if (!stock) {
            console.warn(`[pn-osk] no stock layout to compose from ` +
                `(group=${groupName})`);
            return null;
        }
        console.log(`[pn-osk] composing from ${groupName} ` +
            `(${landscape ? "landscape" : "portrait"})`);

        const composed = {};
        for (const level of [0, 1]) {
            const rows = stock.levels?.[level]?.rows;
            if (!rows || rows.length < 4) {
                console.warn(`[pn-osk] fallback: level ${level} has ` +
                    `${rows ? rows.length : "no"} rows, need 4`);
                return null;
            }
            const portraitK6 =
                !landscape && (this._config.portrait?.k6 ?? DEFAULTS.portrait.k6);
            let built = landscape || portraitK6
                ? this._composeLevel(rows, level)
                : this._composePortrait(rows, level);
            if (!built) {
                console.warn(`[pn-osk] fallback: compose returned null ` +
                    `(level ${level}, ${landscape ? "landscape" : "portrait"})`);
                return null;
            }
            // Two layers: the top-level map applies whichever way up the
            // tablet is, the portrait one overrides it. Landscape had no
            // relabel at all before, so a rename like ?123 -> #+= could only be
            // made on one side of the rotation.
            built = relabel(built, {
                ...DEFAULTS.labels,
                ...this._config.labels,
                ...(portraitK6
                    ? {...DEFAULTS.portrait.labels, ...this._config.portrait?.labels}
                    : {}),
            });
            // Bopomofo caps. _updateLayout runs again on every engine switch
            // (that string of "composing from us" in the journal is it), so
            // switching to chewing changes the caps, switching away restores
            // them, with no extra signals needed.
            // 🔴 Use relabelByString, not relabel: letter keys are taken from the
            //    stock layout, those key objects have no label field and display
            //    via strings[0]. relabel looking for k.label misses them — the
            //    first version measured only swapped the digit row and
            //    punctuation (those are built by our own charKeys and have a
            //    label), missing all 26 letters.
            // The 'face' is pushed by pn-panel (SetInputFace): it is the source
            //    of truth for TW/BP on the rime source, and we are only told.
            //    chewing also prints bopomofo, for anyone still using it.
            // The alphabet layer is derived from the input method layer: the
            // bopomofo face prints bopomofo; chewing is also bopomofo (for
            // anyone still using it). pinyin / romaji keep latin — which is the
            // original caps.
            if (level === 0 && (this._pnInputFace === "bopomofo" || currentEngineId() === "chewing"))
                built = relabelByString(built, PN_BOPOMOFO);
            composed[level] = built;
        }
        return composed;
    }

    // Portrait: the stock rows, untouched, with the missing top row in front.
    _composePortrait(rows, level) {
        const cfg = this._config;
        const p = {...DEFAULTS.portrait, ...cfg.portrait};
        const w = {...DEFAULTS.portrait.widths, ...cfg.portrait?.widths};
        const L = cfg.navLabels ?? DEFAULTS.navLabels;

        const [qwertyRow, homeRow, letterRow, bottomRow] = rows;
        const resize = (row, match, width) =>
            row.map(k => (match(k) ? {...k, width} : k));

        // Same three keys as landscape, for the same reason: a label that does
        // not fit reads as a mystery key, not as a narrow one.
        const qwerty = resize(qwertyRow, k => k.label === 'Tab', w.tab);
        let bottom = resize(bottomRow, k => k.label === 'Ctrl', w.ctrl);
        bottom = resize(bottom, k => k.label === '?123', w.symbolSwitch);

        const flexIn = (row, match) => row.findIndex(match);
        const cols = p.columns;

        return auditKeyvals([
            [{label: L.esc, keyval: hexKeyval(Clutter.KEY_Escape), width: w.esc ?? 1}, ...charKeys(faceFor(p.topRow, level))],
            balance(qwerty, flexIn(qwerty, byAction('delete')), cols),
            homeRow,
            letterRow,
            balance(bottom, flexIn(bottom, k => k.label === ' ' || k.strings?.[0] === ' '), cols),
        ], `portrait level ${level}`);
    }

    _composeLevel(rows, level) {
        const cfg = this._config;
        const w = cfg.widths;

        const offGrid = Object.entries(w)
            .filter(([, v]) => quantize(v) !== v)
            .map(([k, v]) => `${k}=${v}->${quantize(v)}`);
        if (offGrid.length && !this._warnedOffGrid) {
            this._warnedOffGrid = true;
            console.warn(`[pn-osk] widths must be multiples of ${QUANTUM}; rounding ${offGrid.join(', ')}`);
        }

        const [qwertyRow, homeRow, letterRow, bottomRow] = rows;
        const find = (row, pred) => row.find(pred);

        const tab = find(qwertyRow, k => k.label === 'Tab');
        const backspace = find(qwertyRow, byAction('delete'));
        const enter = find(homeRow, byIcon('keyboard-enter-symbolic'));
        const capsShift = homeRow[0];
        const leftShift = letterRow[0];
        const rightShift = letterRow[letterRow.length - 1];
        const up = find(letterRow, byIcon('go-up-symbolic'));
        const ctrl = find(bottomRow, k => k.label === 'Ctrl');
        const symbolSwitch = find(bottomRow, k => k.label === '?123');
        const alt = find(bottomRow, k => k.label === 'Alt');
        const space = find(bottomRow, k => k.label === ' ' || k.strings?.[0] === ' ');
        const emoji = find(bottomRow, byAction('emoji'));
        const langMenu = find(bottomRow, byAction('languageMenu'));
        const left = find(bottomRow, byIcon('go-previous-symbolic'));
        const down = find(bottomRow, byIcon('go-down-symbolic'));
        const right = find(bottomRow, byIcon('go-next-symbolic'));
        const hide = find(bottomRow, byAction('hide'));

        // The letters come out of the stock rows rather than being written
        // here, so the shifted level yields real capitals and a non-US layout
        // would keep its own alphabet.
        const qwertyChars = qwertyRow.slice(1, -1);
        const homeChars = homeRow.slice(1, -1);
        const letterChars = letterRow.slice(1, -3);

        if (!backspace || !enter || !hide || !space || qwertyChars.length !== 10) {
            // State which one went missing — 'cannot find a certain key' and
            // 'wrong number of letters' are entirely different things, and they
            // originally shared one silent return
            console.warn("[pn-osk] compose bail:" +
                ` backspace=${!!backspace} enter=${!!enter}` +
                ` hide=${!!hide} space=${!!space} chars=${qwertyChars.length}`);
            return null;
        }

        const extras = charKeys(faceFor(cfg.qwertyExtra, level));
        if (extras.length)
            extras[extras.length - 1].width = w.backslash;

        const icons = {...DEFAULTS.navIcons, ...cfg.navIcons};
        const navKey = (label, key, role) => (icons[role]
            ? {iconName: icons[role], keyval: hexKeyval(key), width: w.nav}
            : {label, keyval: hexKeyval(key), width: w.nav});
        const L = cfg.navLabels ?? DEFAULTS.navLabels;

        // Each row names the key that absorbs its slack, so every row lands on
        // cfg.columns and the navigation column stays a column. The inverted-T
        // only reads as one if the up key sits in the same column as the down
        // key, which is the column the Del on the fourth row holds open.
        const flexBackspace = sized(backspace, w.backspace);
        const flexBackslash = extras[extras.length - 1];
        const flexEnter = sized(enter, w.enter);
        const flexShift = sized(rightShift, w.shift);
        const flexSpace = sized(space, w.space);

        const rowsOut = [
            [
                {label: L.esc, keyval: hexKeyval(Clutter.KEY_Escape), width: w.esc ?? 1},
                ...charKeys(faceFor(cfg.topRow, level)),
                flexBackspace,
                navKey(L.home, Clutter.KEY_Home, 'home'),
            ],
            [
                sized(tab, w.tab),
                ...qwertyChars,
                ...extras,
                navKey(L.end, Clutter.KEY_End, 'end'),
            ],
            [
                sized(capsNamed(capsShift, cfg, level), w.capsShift),
                ...homeChars,
                ...charKeys(faceFor(cfg.homeExtra, level)),
                flexEnter,
                navKey(L.pgup, Clutter.KEY_Page_Up, 'pgup'),
            ],
            [
                sized(leftShift, w.leftShift ?? w.shift),
                ...letterChars,
                ...charKeys(faceFor(cfg.bottomKeys, level)),
                flexShift,
                sized(up, w.arrowV ?? w.arrow ?? 1),
                navKey(L.pgdn, Clutter.KEY_Page_Down, 'pgdn'),
            ],
            [
                sized(ctrl, w.ctrl ?? 1),
                sized(symbolSwitch, w.symbolSwitch),
                sized(alt, w.alt ?? 1),
                flexSpace,
                sized(emoji, w.emoji ?? 1),
                sized(langMenu, w.langMenu ?? 1),
                sized(hide, w.hide ?? w.nav),
                sized(left, w.arrow ?? 1),
                sized(down, w.arrowV ?? w.arrow ?? 1),
                sized(right, w.arrow ?? 1),
            ],
        ];

        const flex = [flexBackspace, flexBackslash, flexEnter, flexShift, flexSpace];
        const columns = cfg.columns ?? DEFAULTS.columns;
        const out = rowsOut.map((row, i) => {
            const kept = row.filter(Boolean);
            return balance(kept, kept.indexOf(flex[i]), columns);
        });
        this._lastComposed = out.map(row => ({
            total: row.reduce((t, k) => t + (k.width ?? 1), 0),
            keys: row.map(k => `${k.label ?? k.iconName ?? k.action ?? "?"}:${k.width ?? 1}`),
        }));
        return auditKeyvals(out, `landscape level ${level}`);
    }

    // AspectContainer keeps the keys at the layout's column:row ratio and
    // centres the remainder. Its class is not exported, but the instance is,
    // and setRatio() is called on it whenever the page changes — so overriding
    // the instance's own method catches every caller, including the ones inside
    // the shell that cannot be reached from here.
    _forceFullWidth(keyboard) {
        const self = this;
        const ac = keyboard._aspectContainer;
        if (!ac)
            return;

        if (!ac._pnOrigSetRatio) {
            ac._pnOrigSetRatio = ac.setRatio.bind(ac);
            ac.setRatio = (relWidth, relHeight) => {
                // Both orientations. Portrait was left out of this at first and
                // spent its keys on a 14% margin it was already paying for.
                if (true) {
                    // Deliberately NOT the container's allocation box. That box
                    // is whatever the last layout left there, so reading it here
                    // samples the previous orientation: rotating to landscape
                    // produced a keyboard exactly 1404px wide, which is the
                    // width of the portrait screen it had just left. Third time
                    // today that something was measured before it existed. The
                    // keyboard's own size was set by _relayout from the monitor
                    // moments ago and cannot be stale.
                    const width = keyboard.width;
                    const height = keyboard.height;
                    if (self._trace) {
                        console.log(
                            `[pn-osk] setRatio(${relWidth},${relHeight}) -> ${width}/${height}`);
                    }
                    ac._pnOrigSetRatio(width, height);
                } else {
                    ac._pnOrigSetRatio(relWidth, relHeight);
                }
            };
        }

        this._trace = this._config.trace;
        ac.setRatio(keyboard.width, keyboard.height);
    }

    // ── Candidate window docked at bottom ──────────────────────────────────────
    // Candidates take two paths, and their containers are different things:
    //
    //   OSK is open   ibusCandidatePopup's _updateVisibility() has
    //                 `!Main.keyboard.visible`, so the floating window closes
    //                 itself, and candidates are instead pushed into the strip at
    //                 the OSK's top edge via Main.keyboard.addSuggestion().
    //                 That strip is already pinned exactly above the keys — it
    //                 inherently has the position it needs, it only lacks height
    //                 (see _forceFullWidth).
    //
    //   OSK is closed Uses this BoxPointer, pinned to the cursor by default and
    //                 following the text.
    //
    // Docking at the bottom only needs to change the latter. Move the dummy
    // cursor to the screen's bottom edge, give it full width, zero height:
    // BoxPointer is St.Side.TOP (arrow above, box below), and when it has no
    // room below it flips to the top on its own, so the box lands on the bottom
    // edge, horizontally centred — the candidates for both paths then appear in
    // the same place, and the eye does not have to hunt for them on the screen.
    //
    // 🔴 The override is on the **instance** method, not the prototype. This
    //    popup is created by ibusManager and is the only one, while the
    //    prototype has others; the same reason _forceFullWidth overrides
    //    ac.setRatio.
    _pnDockCandidatePopup() {
        const popup = IBusManager.getIBusManager()?._candidatePopup;
        if (!popup || popup._pnOrigReposition)
            return;

        // Dock line: the OSK's top edge when open, the screen's bottom edge when
        // closed.
        //
        // 🔴 The keyboard's top edge must be computed as 'screen bottom edge minus
        //    keyboard height', do **not** read keyboardBox's coordinates.
        //    _animateShowComplete() does `this.translation_y = -this.height`
        //    — the translation is attached to the Keyboard itself, keyboardBox
        //    actually sits below the screen's bottom edge, and the keyboard
        //    translates in upwards. Reading
        //    keyboardBox.get_transformed_position() returns the bottom edge, so
        //    the candidate window covers the keyboard entirely (measured as such
        //    on 2026-08-18).
        //    Computing it backward has another benefit: during the animation it
        //    computes the final dock position, so the candidate window does not
        //    slide with it.
        //
        // Dummy cursor gets full width, zero height,
        // BoxPointer is St.Side.TOP (arrow above, box below), and when it has no
        // room below it flips up on its own — so the box docks to the top of
        // that line, horizontally centred.
        const dockLine = () => {
            const mon = Main.layoutManager.primaryMonitor;
            if (!mon)
                return 0;
            let y = mon.y + mon.height;
            const kb = Main.keyboard?._keyboard;
            if (Main.keyboard?.visible && kb?.height)
                y -= kb.height;
            return y;
        };

        // 🔴 Positioning is no longer left to BoxPointer, we compute it ourselves.
        //
        //    It is designed for a 'bubble pointing at something', not a 'toolbar
        //    docked to an edge', and that difference bit in three places:
        //      · St.Side.TOP means the box is **below** the anchor point, not
        //        'arrow faces up so it is on top'
        //      · Changing direction requires writing _userArrowSide,
        //        updateArrowSide() is overwritten by _updateFlip
        //      · vfunc_allocate only repositions when `this._sourceActor.mapped`
        //        — the dummy cursor is an opacity:0, zero-height actor, and that
        //        condition is not something we can guarantee. When it failed the
        //        box stopped at 0,0, and {x:0,y:0} was measured.
        //
        //    Add that resX is computed from natWidth, so the position jumps
        //    whenever the candidates change width — that was the 'drifting right
        //    and drifting back'. Pinning the width in CSS fixed one half, the
        //    other half is here: replacing _reposition with 'use our preset
        //    coordinates' so both paths (whether it reached _reposition or not)
        //    land on the same answer.
        // place() only handles x and width. y is computed by _reposition during
        // allocation — see the reason in the block below (in short: only the
        // height at the moment of allocation is the true value for this batch of
        // candidates).
        const place = () => {
            const mon = Main.layoutManager.primaryMonitor;
            if (!mon)
                return;
            // Full width: the same left and right edges as the keyboard. Width is
            // read from the screen, not written into CSS — landscape 936,
            // portrait 702, hardcoding either breaks when rotated.
            popup.set_width(mon.width);
            popup.set_x(mon.x);
            // 🔴 _sourceActor must have something, or vfunc_allocate never calls
            //    _reposition:
            //        if (this._sourceActor && this._sourceActor.mapped)
            //            this._reposition(box);
            //    After taking away the dummy cursor path in the last version it
            //    was null, _reposition stopped running, and the box stayed at
            //    0,0 — the 'drifting up' seen was not intentional, it was placed
            //    by nobody. Here it is set back to upstream's own _dummyCursor
            //    (in uiGroup, always mapped); our _reposition does not read its
            //    position, it only borrows it to make that if succeed. alignment
            //    can be passed anything, for the same reason.
            popup.setPosition(popup._dummyCursor, 0);
            popup.queue_relayout();
        };

        // Page buttons are pinned to the right edge. They are the last child of
        // _candidateArea (HORIZONTAL BoxLayout), originally following the last
        // candidate — after turning off ellipsize, long candidates push them all
        // the way past 936 where they are clipped. x_expand lets them consume
        // the remaining space, x_align END pins them to the right of that space;
        // the part of the candidates that does not fit is clipped, and the
        // buttons are always visible — and seeing the page buttons is exactly
        // the only way out when candidates are clipped.
        const buttons = popup._candidateArea?._buttonBox;
        if (buttons) {
            popup._pnOrigButtonLayout = [buttons.x_expand, buttons.x_align];
            buttons.x_expand = true;
            buttons.x_align = Clutter.ActorAlign.END;
        }
        // 🔴 '...' was never a width problem, it is St.Label defaulting to
        //    ellipsize=END plus BoxLayout's allocation rules: a child's minimum
        //    width is exactly '...', and once total natural width exceeds
        //    available width, it shrinks **every cell** toward its minimum
        //    proportionally — so whether page_size is 9 or 5, if one candidate
        //    is a full sentence, all of them turn into '1 ...' '2 ...'.
        //
        //    Turn off ellipsize, and the label's minimum width = natural width,
        //    leaving BoxLayout nothing to shrink. Candidates that do not fit
        //    exceed the container bounds and are clipped — which is macOS's
        //    behaviour: give the first one whatever it needs, pack however many
        //    fit after it, and leave the rest to the page buttons.
        //
        //    These labels are built once when _candidateArea is constructed,
        //    exactly MAX_CANDIDATES_PER_PAGE of them, and only their text
        //    changes afterwards, so setting them once is stable.
        const area = popup._candidateArea;
        popup._pnOrigEllipsize = [];
        for (const box of area?._candidateBoxes ?? []) {
            for (const label of [box._indexLabel, box._candidateLabel]) {
                if (!label?.clutter_text)
                    continue;
                popup._pnOrigEllipsize.push([label, label.clutter_text.ellipsize]);
                label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            }
        }

        popup._pnOrigReposition = popup._reposition.bind(popup);
        // 🔴 y is computed **here**, using this allocation box's height.
        //    _reposition is called by vfunc_allocate, and at that moment the
        //    allocationBox's height is the true value for this batch of
        //    candidates after layout. Computed previously in place(), running
        //    after open() and before content was laid out, it asked for the
        //    previous batch's height — measuring h=42 but placing it at 460, its
        //    bottom edge 502 covered the Esc row. Catching notify::height did
        //    not compensate: the height change happens inside allocate, the
        //    signal fires after it, and the allocation is already settled using
        //    the old y.
        //    x does not have this problem, width is pinned by set_width.
        //    _updateFlip calls this too, harmlessly: it only computes the same
        //    answer again.
        //
        // 🔴 Upstream's _reposition must be called **first**, then overwrite the
        //    origin. vfunc_allocate is
        //        this._reposition(box); this._updateFlip(box);
        //    and _updateFlip → _calculateArrowSide reads this._sourceExtents and
        //    this._workArea — those two fields are only filled by upstream's
        //    _reposition. The wholesale replacement version never filled them,
        //    _updateFlip threw undefined as soon as it ran, allocation aborted
        //    inside the vfunc, GJS swallowed the exception, and the journal
        //    logged not a single word. The symptom was Geometry measuring
        //    visible/mapped/sourceMapped all true, all five candidates present,
        //    opacity 255, but box was None — everything was there, it just
        //    lacked an allocation (2026-08-18).
        popup._reposition = allocationBox => {
            try {
                popup._pnOrigReposition(allocationBox);
            } catch (e) {
                // It does not matter if upstream fails to compute it: we overwrite
                // the origin anyway. Its computation is only to fill
                // _sourceExtents / _workArea for _updateFlip to use.
            }
            const h = allocationBox.get_height();
            allocationBox.set_origin(popup.x, Math.floor(dockLine() - h));
        };

        // 🔴 Direction is always horizontal, ignoring the engine. This row is a
        //    bottom-docked toolbar, horizontal is its shape, and it should not
        //    be decided by each engine: RIME only sends HORIZONTAL if
        //    style/horizontal is set in ibus_rime.yaml; Mozc hardcodes VERTICAL
        //    (measured orientation=1, page=3), with no user setting to change
        //    it, as Japanese input methods traditionally have vertical candidate
        //    windows. So unify it at the receiving end: setOrientation treats
        //    whatever it receives as HORIZONTAL. Override the instance method,
        //    for the same reason as _reposition.
        // All three children (preedit / aux / candidateArea) are centred. In a
        // full-width VERTICAL box children default to FILL: candidateArea is
        // laid out from the left edge, and the aux row too — pinyin has no aux
        // so it is not visible, but when Mozc's 'Tabキーで選択' arrives, the whole
        // group leans left.
        for (const child of [popup._preeditText, popup._auxText, popup._candidateArea]) {
            if (child && child._pnOrigXAlign === undefined) {
                child._pnOrigXAlign = child.x_align;
                child.x_align = Clutter.ActorAlign.CENTER;
            }
        }
        const carea = popup._candidateArea;
        if (carea && !carea._pnOrigSetOrientation) {
            carea._pnOrigSetOrientation = carea.setOrientation.bind(carea);
            carea.setOrientation = () => carea._pnOrigSetOrientation(IBus.Orientation.HORIZONTAL);
            carea.setOrientation(IBus.Orientation.HORIZONTAL);
        }

        // 🔴 Candidate cells only connected button-release-event (upstream), and
        //    pure touch **does not send** button events at all — pn-panel's files
        //    already documented the same lesson: 'touch must be connected
        //    yourself'. So 'tapping candidates with a finger' was dead across
        //    all three engines, and paging only worked because ‹ › are St.Button
        //    (which consume touch natively). Add touch-event to every cell,
        //    emitting the exact same candidate-clicked as upstream on TOUCH_END,
        //    feeding into the panelService path.
        if (popup._candidateArea && !popup._pnTouchIds) {
            popup._pnTouchIds = popup._candidateArea._candidateBoxes.map((box, j) =>
                box.connect("touch-event", (actor, event) => {
                    if (event.type() !== Clutter.EventType.TOUCH_END)
                        return Clutter.EVENT_PROPAGATE;
                    popup._candidateArea.emit("candidate-clicked", j, 1, 0);
                    return Clutter.EVENT_STOP;
                }));
        }

        // 🔴 rime clicks do **not** need us to synthesise selection keys — there
        //    used to be a hook here synthesising Shift+A / 1-9, on the premise
        //    that 'ibus-rime did not implement candidate_clicked', and that
        //    premise was checked via strings/nm: librime calls all go through
        //    rime_get_api()'s function table, invisible to the symbol table, and
        //    **finding nothing does not mean it is absent**. The real machine's
        //    verdict: tapping '今天' became '今天A' — upstream
        //    panelService.candidate_clicked selected the word normally, our
        //    Shift+A arrived after it was submitted, landing as a literal A.
        //    Neither a debounce (250ms) nor a hasPreedit gate could stop it: same
        //    emission, two consumers, same tick. The entire synthesis block was
        //    removed; clicks only lack the touch event (added above), not engine
        //    support.
        popup._pnOrigUpdateVisibility = popup._updateVisibility.bind(popup);
        popup._updateVisibility = () => {
            const isVisible = popup._preeditText.visible ||
                popup._auxText.visible ||
                popup._candidateArea.visible;

            if (isVisible) {
                popup.open(BoxPointer.PopupAnimation.NONE);
                // Hold back drawing while switching schemas (see
                // SuppressCandidates). Must be set **after** open() —
                // BoxPointer.open() writes opacity to 255 itself, setting it
                // earlier gets overwritten (real machine: the menu draws entirely
                // anyway). opacity 0 rather than not opening: the popup's
                // internal state (the text in _candidateArea, _cursorPosition)
                // still needs to update, as pn-panel relies on them to find the
                // target in the menu and compute how many Downs to press.
                // The flag is read from global, not from this: pn-panel is in
                // the same shell process as we are, it **synchronously** sets
                // global._pnSuppressCandidates before sending F4, and we are
                // guaranteed to see it here. A D-Bus call would be asynchronous,
                // F4 arrives first, the menu draws first, suppress arrives later
                // — and the menu is exposed entirely on the real machine.
                if (globalThis._pnSuppressCandidates)
                    popup.opacity = 0;
                // 🔴 Place anew on every display, and after open().
                //    Place anew: the dock line follows the OSK, and the OSK's
                //    rise timing is not under our control — only at the moment
                //    of 'about to display' is the keyboard's presence settled.
                //    After open(): it needs to wait for content to enter, so
                //    get_preferred_* is the true size for this batch of
                //    candidates.
                place();
                const {keyboardBox} = Main.layoutManager;
                popup.get_parent().set_child_above_sibling(popup, keyboardBox);
            } else {
                popup.close(BoxPointer.PopupAnimation.NONE);
            }
        };
    }

    _pnUndockCandidatePopup() {
        const popup = IBusManager.getIBusManager()?._candidatePopup;
        if (popup?._pnTouchIds) {
            popup._candidateArea?._candidateBoxes?.forEach((box, j) => {
                try {
                    box.disconnect(popup._pnTouchIds[j]);
                } catch (e) {
                    // Removed
                }
            });
            delete popup._pnTouchIds;
        }
        if (popup?._pnOrigReposition) {
            popup._reposition = popup._pnOrigReposition;
            delete popup._pnOrigReposition;
        }
        for (const child of [popup?._preeditText, popup?._auxText, popup?._candidateArea]) {
            if (child && child._pnOrigXAlign !== undefined) {
                child.x_align = child._pnOrigXAlign;
                delete child._pnOrigXAlign;
            }
        }
        const carea = popup?._candidateArea;
        if (carea?._pnOrigSetOrientation) {
            carea.setOrientation = carea._pnOrigSetOrientation;
            delete carea._pnOrigSetOrientation;
        }
        if (popup?._pnOrigButtonLayout) {
            const buttons = popup._candidateArea?._buttonBox;
            if (buttons)
                [buttons.x_expand, buttons.x_align] = popup._pnOrigButtonLayout;
            delete popup._pnOrigButtonLayout;
        }
        for (const [label, mode] of popup?._pnOrigEllipsize ?? []) {
            try {
                label.clutter_text.ellipsize = mode;
            } catch (e) {
                // Removed
            }
        }
        if (popup)
            delete popup._pnOrigEllipsize;
    }

    _restoreRatio() {
        const ac = Main.keyboard?._keyboard?._aspectContainer;
        if (ac?._pnOrigSetRatio) {
            ac.setRatio = ac._pnOrigSetRatio;
            delete ac._pnOrigSetRatio;
        }
    }

    _rebuild() {
        const keyboard = Main.keyboard?._keyboard;
        keyboard?._updateKeys?.();
        keyboard?._relayout?.();
    }

    _exportDBus() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/cver/PnOsk');
        this._nameId = Gio.bus_own_name(
            Gio.BusType.SESSION, 'org.cver.PnOsk',
            Gio.BusNameOwnerFlags.NONE, null, null, null);
    }

    // --- D-Bus -------------------------------------------------------------

    CaptureAsync([path], invocation) {
        try {
            const file = Gio.File.new_for_path(path);
            const stream = file.replace(
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            const shooter = new Shell.Screenshot();
            shooter.screenshot(false, stream, (obj, res) => {
                let reply = 'ok';
                try {
                    shooter.screenshot_finish(res);
                } catch (e) {
                    reply = `error: ${e.message}`;
                }
                try {
                    stream.close(null);
                } catch (e) {
                    // Already closed by the shooter; nothing to report.
                }
                invocation.return_value(new GLib.Variant('(s)', [reply]));
            });
        } catch (e) {
            invocation.return_value(new GLib.Variant('(s)', [`error: ${e.message}`]));
        }
    }

    Geometry() {
        const kb = Main.keyboard?._keyboard;
        const monitor = Main.layoutManager.keyboardMonitor;

        const layers = {};
        if (kb?._layers) {
            for (const [level, container] of Object.entries(kb._layers)) {
                layers[level] = {
                    box: box(container),
                    visible: container.visible,
                    ratio: container.getRatio?.() ?? null,
                    keys: container.get_children?.().length ?? null,
                };
            }
        }

        const firstLayer = kb?._layers ? Object.values(kb._layers)[0] : null;
        const firstKey = firstLayer?.get_children?.()[0];

        return JSON.stringify({
            build: BUILD,
            config: this._config,
            monitor: monitor
                ? {x: monitor.x, y: monitor.y, w: monitor.width, h: monitor.height}
                : null,
            keyboard: box(kb),
            keyboardVisible: kb?.visible ?? null,
            aspectContainer: box(kb?._aspectContainer),
            // Candidate strip. It is a sibling of aspectContainer in the same
            // vertical layout, the two fight for the same height, so without it
            // this dump cannot explain 'why the key area is this height'.
            // children is the critical field: the strip is always visible (see
            // notes in _forceFullWidth), whether there are candidates depends on
            // whether it has children.
            // Candidate window. It is not part of the keyboard, but its position
            // is **determined by** the keyboard (see the dock line in
            // _pnDockCandidatePopup), so it needs to be seen together when
            // measuring the keyboard — otherwise 'whether it docks to the
            // keyboard's top edge' can only be verified by photographing.
            candidates: (() => {
                const p = IBusManager.getIBusManager()?._candidatePopup;
                if (!p)
                    return null;
                return {
                    box: box(p),
                    visible: p.visible,
                    mapped: p.mapped,
                    opacity: p.opacity,
                    // These three are checked when 'visible=true but box cannot
                    // be measured': if sourceActor is not mapped vfunc_allocate
                    // will not call _reposition at all; having no parent means
                    // it has not entered the stage yet.
                    hasSourceActor: !!p._sourceActor,
                    sourceMapped: p._sourceActor?.mapped ?? null,
                    parent: p.get_parent()?.constructor?.name ?? null,
                    dummyCursor: box(p._dummyCursor),
                    candidateArea: box(p._candidateArea),
                    candidateAreaVisible: p._candidateArea?.visible ?? null,
                    nCandidatesVisible: (p._candidateArea?._candidateBoxes ?? [])
                        .filter(b => b.visible).length,
                };
            })(),
            suggestions: kb?._suggestions
                ? {
                    box: box(kb._suggestions),
                    visible: kb._suggestions.visible,
                    children: kb._suggestions.get_n_children(),
                    naturalHeight: kb._suggestions.get_preferred_height(-1)[1],
                }
                : null,
            layers,
            sampleKey: firstKey ? box(firstKey) : null,
            composed: this._lastComposed ?? null,
        }, null, 2);
    }
    OpenFolder() {
        // FolderIcon.open() is exactly what vfunc_clicked calls, no need to
        // simulate a click
        const appDisplay = pnOverviewControls()?._appDisplay;
        for (const item of appDisplay?._orderedItems ?? []) {
            if (item.style_class?.includes("app-folder") && item.open) {
                item.open();
                return;
            }
        }
    }

    RenameFolder() {
        // Open the folder and enter rename state directly. This state requires a
        // human to double-tap to reach, and it is what must be seen on every
        // subsequent round.
        this.OpenFolder();
        const appDisplay = pnOverviewControls()?._appDisplay;
        const item = (appDisplay?._orderedItems ?? [])
            .find(i => i.style_class?.includes("app-folder"));
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            if (item?._dialog?._editButton)
                item._dialog._editButton.checked = true;
            return GLib.SOURCE_REMOVE;
        });
    }

    // This panel has 16 levels (0, 17, ... 255), so as long as the interface's
    // greys land on a few widely separated rungs they are not quantised again,
    // nor do they bleed into each other in black-and-white mode. The enemy was
    // never grey, it is **greys too close to each other**. Rungs are taken at
    // 0/85/170/255 — all integer multiples of 17, exactly the panel's 0th, 5th,
    // 10th, and 15th levels.
    //
    // 🔑 This script writes no CSS, it **reads the drawn result**. Things writing
    // rules against selectors rot silently (the `#keyboard` selector did exactly
    // that: the rule remained, the theme was loaded, it pointed to nothing on
    // GNOME 48, so the keyboard stayed stock grey and nobody noticed). Walking
    // the actor tree to read the theme node does not have this problem — if a
    // name changes it simply stops appearing in the list, rather than becoming a
    // silent dead rule.
    // Tuning colour requires looking at the glass, and looking at the glass
    // requires the keyboard on screen. This machine is operated over SSH, so it
    // is given a path that does not require using a finger — for the same reason
    // as Capture/Tone/Rotate.
    // ── Quantiser ────────────────────────────────────────────────────────────
    // Palette() only reports; this one modifies. Not a single selector appears —
    // it reads the **computed** colour of each component, so if a name changes
    // it just measures something else, rather than becoming a silent dead rule.
    //
    // How each value is decided:
    //   Colour      Take luminance to convert to grey, then snap. Colours turn
    //               into some grey on this glass anyway, snapping just makes
    //               that grey predictable.
    //   Translucent Flatten against the parent's computed background, then snap
    //               — this is the reason to walk a 'tree' rather than a list:
    //               alpha's meaning depends on what lies beneath it.
    //   Transparent Untouched. alpha 0 is 'do not draw', not a colour.
    //   Shadow      Removed. It is a continuous gradient, and not a single slot
    //               in the sixteen levels can hold it.
    //
    // 🔴 This is 'physics', not 'design': it only moves values to the nearest
    // grid slot, it does not change the layout. Changing the layout (like the
    // keyboard's white keys on a grey bed) requires writing CSS, which is not
    // something moving closer can produce.
    _pnQuantise(apply) {
        const STEP = 17;
        const snap = v => Math.max(0, Math.min(255, Math.round(v / STEP) * STEP));
        const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const rgba = c => {
            if (!c) return null;
            const v = [c.red ?? c.r, c.green ?? c.g, c.blue ?? c.b, c.alpha ?? c.a];
            return v.some(x => x === undefined) ? null : v;
        };
        // Flatten a colour into an opaque grid value. under = the already-computed
        // grey of the layer beneath it.
        const flatten = (c, under) => {
            const v = rgba(c);
            if (!v || v[3] === 0)
                return null;                  // Skip drawing if not needed
            const [r, g, b, a] = v;
            const grey = lum(r, g, b);
            const mixed = a === 255 ? grey : (a / 255) * grey + (1 - a / 255) * under;
            return snap(mixed);
        };
        const out = {applied: 0, cleared: 0, visited: 0, errors: 0, changes: {}};

        const walk = (actor, under) => {
            out.visited++;
            if (actor.visible === false)
                return;
            let myBg = under;
            if (actor instanceof St.Widget) {
                try {
                    if (!apply) {
                        if (actor._pnQuantised) {
                            actor.set_style(actor._pnStyleBefore ?? null);
                            actor._pnQuantised = false;
                            out.cleared++;
                        }
                    } else {
                        const n = actor.get_theme_node();
                        const bits = [];
                        const bg = flatten(n.get_background_color(), under);
                        if (bg !== null) {
                            myBg = bg;
                            const orig = rgba(n.get_background_color());
                            if (orig[0] !== bg || orig[1] !== bg || orig[2] !== bg || orig[3] !== 255)
                                bits.push(`background-color: rgb(${bg},${bg},${bg})`);
                        }
                        const fg = flatten(n.get_foreground_color(), myBg);
                        if (fg !== null) {
                            const orig = rgba(n.get_foreground_color());
                            if (orig[0] !== fg || orig[1] !== fg || orig[2] !== fg || orig[3] !== 255)
                                bits.push(`color: rgb(${fg},${fg},${fg})`);
                        }
                        for (const side of [St.Side.TOP, St.Side.RIGHT,
                                            St.Side.BOTTOM, St.Side.LEFT]) {
                            if (n.get_border_width(side) <= 0)
                                continue;
                            const bc = flatten(n.get_border_color(side), myBg);
                            const orig = rgba(n.get_border_color(side));
                            if (bc !== null && (orig[0] !== bc || orig[3] !== 255)) {
                                bits.push(`border-color: rgb(${bc},${bc},${bc})`);
                                break;        // St border-color sets all four sides at once
                            }
                        }
                        if (n.get_box_shadow?.())
                            bits.push("box-shadow: none");
                        if (bits.length) {
                            if (!actor._pnQuantised) {
                                actor._pnStyleBefore = actor.get_style();
                                actor._pnQuantised = true;
                            }
                            actor.set_style(`${actor._pnStyleBefore ?? ""}; ${bits.join("; ")};`);
                            out.applied++;
                            for (const b of bits) {
                                const k = b.split(":")[0].trim();
                                out.changes[k] = (out.changes[k] ?? 0) + 1;
                            }
                        }
                    }
                } catch (e) {
                    out.errors++;
                }
            }
            for (const child of actor.get_children?.() ?? [])
                walk(child, myBg);
        };

        try {
            walk(global.stage, 0);
        } catch (e) {
            out.fatal = e.message;
        }
        return JSON.stringify(out, null, 1);
    }

    // ── Quantising shader ────────────────────────────────────────────────────
    // The per-component path (_pnQuantise below) reads semantic properties, so it
    // can touch background colours but not icons; this path is the opposite — it
    // is a post-processing filter, seeing only pixels, so it covers everything
    // (including newly opened menus, hover states), at the cost of also not
    // being able to distinguish icons.
    //
    // 'Touch interface only, not content' = attach only to chrome actors, not
    // global.window_group. That is exactly the semantics of macOS Smart Invert.
    // (The cat seen as a negative when testing a11y invert today was because
    // that was fullscreen, lacking this boundary.)
    // Where it attaches is the boundary between 'physics' and 'content' — the
    // effect applies to the entire subtree, with no way to exclude a specific
    // descendant, so the only lever is to **attach it lower**.
    //
    // 🐈 The workspace preview holds the wallpaper and window thumbnails, which is
    // content, not interface (the inverted cat is the proof). It happens to be an
    // independent branch under the overview controls, so enumerating siblings and
    // skipping it works.
    // Compare by object rather than by name: names change, and name comparisons
    // fail silently when they do.
    // Where it attaches is the boundary between 'physics' and 'content' — the
    // effect applies to the entire subtree, with no way to exclude a specific
    // descendant.
    //
    // 🩸 Tried 'attaching lower': do not attach to the entire overview, attach
    // only to controls' children, skipping the workspace branch. The result was
    // worse — the overview's dark background is **not** a child of controls, so
    // the background did not invert, the content did, and app names once again
    // became black text on a black background. ⇒ **Inversion only holds when the
    // background and content invert together.**
    //
    // 🐈 The correct answer uses 'inversion is its own inverse': attach to the
    // entire overview as usual, then attach a sub-effect that **only inverts,
    // not quantises** on the workspace branch, and the parent inverting again
    // cancels it out. The cat is therefore not a negative.
    // ⚠️ But it still gets quantised — quantisation is irreversible, the
    // sub-effect cannot rescue it. Complete exclusion is impossible under this
    // architecture, which is the price of the shader being cheap.
    _pnPosteriseActors() {
        const list = [];
        if (Main.panel)
            list.push(["panel", Main.panel]);
        if (Main.layoutManager?.modalDialogGroup)
            list.push(["modals", Main.layoutManager.modalDialogGroup]);
        if (Main.layoutManager?.overviewGroup)
            list.push(["overview", Main.layoutManager.overviewGroup]);
        // Page arrows go through addChrome, which is **outside** overviewGroup —
        // we only wanted to move their position, but incidentally moved them out
        // of the quantiser's range, so colour became something we had to decide
        // ourselves. Attach them back.
        for (const [which, arrow] of Object.entries(this._pnArrows ?? {})) {
            if (arrow)
                list.push([`arrow:${which}`, arrow]);
        }
        // 🔴 The candidate window is **not** in this list, and it used to be.
        //
        // Attaching it was the right first step: it goes through addTopChrome()
        // and lands under uiGroup, outside the range just like the page arrows,
        // so the stock Adwaita dark and that blue selection hit it directly. The
        // quantiser fixed it the moment it was attached.
        //
        // Taking it out was the right second step. The maintainer wanted 'the
        // selected cell's background to match the row below' — the row below is
        // the keyboard, and the keyboard's background is hardcoded as #aaa in
        // CSS, **and the keyboard is not in this list** (it is in keyboardBox,
        // not under panel/modals/overview). With two surfaces where one is
        // inverted and the other is not, no single CSS value can be right for
        // both: writing #aaa gets inverted to #555.
        //
        // So follow this repo's own division of labour: **physics to the
        // quantiser, design is always CSS**. The candidate window is now part of
        // the typing interface, in the same class as the keyboard, not a
        // neighbour's surface. See stylesheet for colours.
        return list;
    }

    // Content branch: attach an inverse effect to cancel the parent's inversion.
    // Get it by object comparison, do not compare names.
    _pnContentActors() {
        const controls = Main.overview?._overview?.controls;
        const wd = controls?._workspacesDisplay;
        return wd ? [["workspaces", wd]] : [];
    }

    // Tear down by walking the full tree, not relying on the list above — the
    // list changes with GNOME versions and state, and tearing down by list
    // leaves orphans that cannot be removed.
    _pnPosteriseClearAll(name) {
        let n = 0;
        const walk = a => {
            if (a.get_effect?.(name)) {
                a.remove_effect_by_name(name);
                n++;
            }
            for (const c of a.get_children?.() ?? [])
                walk(c);
        };
        try {
            walk(global.stage);
        } catch (e) {
            // Count the already-removed ones even if it fails halfway
        }
        return n;
    }

    Posterise(levels, invert) {
        const NAME = "pn-posterise";
        const out = {levels, invert, attached: [], removed: [], errors: []};
        this._pnPosteriseClasses ??= new Map();
        const key = `${levels}${invert ? "i" : ""}`;

        if (levels > 1 && !this._pnPosteriseClasses.has(key)) {
            // 🔴 These are not evenly distributed. An even four levels is
            //    0/85/170/255, while the canon is 0/51/170/255 — the maintainer
            //    specifically requested 'no linearity', sinking at #333 not
            //    #555. Even distribution would quietly push #333 into #555, so
            //    the value written in CSS would not match the value appearing on
            //    the glass.
            //
            // Adding levels takes two forms, with different risks:
            //   Filling gaps (#777, the 7th level) — the largest hole is between
            //     #333→#aaa (7 levels), filling it makes the intervals 3/4/3/5,
            //     safe in both modes.
            //   Adding neighbours (#ddd, the 13th level) — adjacent to paper,
            //     used for 'weak emphasis' (faint borders, fine dividers).
            //     ⚠️ In black-and-white mode #fff is solid white, #ddd is a 13%
            //     black dot pattern, and a 1px line will turn into broken dots.
            //     Whether it looks good can only be judged on the glass.
            const PALETTES = {
                4: [0, 51, 170, 255],
                5: [0, 51, 119, 170, 255],
                6: [0, 51, 119, 170, 221, 255],
            };
            const buildSnap = vals => {
                let code = "";
                for (let i = 0; i < vals.length - 1; i++) {
                    const mid = ((vals[i] + vals[i + 1]) / 2 / 255).toFixed(4);
                    code += `l < ${mid} ? ${(vals[i] / 255).toFixed(4)} : `;
                }
                return `float q = ${code}${(vals.at(-1) / 255).toFixed(4)};`;
            };
            const PALETTE = PALETTES[levels] ? buildSnap(PALETTES[levels]) : null;
            const div = (levels - 1).toFixed(1);
            const EVEN = `float q = floor(l * ${div} + 0.5) / ${div};`;
            // cogl_color_out is premultiplied, it must be unmultiplied before
            // computing luminance, then multiplied back at the end.
            const CODE = `
                float a = cogl_color_out.a;
                vec3 rgb = a > 0.0 ? cogl_color_out.rgb / a : cogl_color_out.rgb;
                float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                ${invert ? "l = 1.0 - l;" : ""}
                ${PALETTE ?? EVEN}
                cogl_color_out = vec4(vec3(q) * a, a);
            `;
            try {
                this._pnPosteriseClasses.set(key, GObject.registerClass(
                    {GTypeName: `PnPosterise${levels}${invert ? "Inv" : ""}`},
                    class extends Shell.GLSLEffect {
                        vfunc_build_pipeline() {
                            this.add_glsl_snippet(
                                Cogl.SnippetHook.FRAGMENT, "", CODE, false);
                        }
                    }));
            } catch (e) {
                out.errors.push(`registerClass(${levels}): ${e.message}`);
            }
        }

        out.removed = this._pnPosteriseClearAll(NAME);
        for (const [label, actor] of this._pnPosteriseActors()) {
            try {
                if (levels <= 1)
                    continue;
                const cls = this._pnPosteriseClasses.get(key);
                if (!cls) {
                    out.errors.push(`${label}: no class`);
                    continue;
                }
                actor.add_effect_with_name(NAME, new cls());
                out.attached.push(label);
            } catch (e) {
                out.errors.push(`${label}: ${e.message}`);
            }
        }
        // Content branch: only needs cancelling if there is inversion (no
        // inversion means nothing to cancel)
        if (levels > 1 && invert) {
            this._pnInvertClass ??= GObject.registerClass(
                {GTypeName: "PnInvertOnly"},
                class extends Shell.GLSLEffect {
                    vfunc_build_pipeline() {
                        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, "", `
                            float a = cogl_color_out.a;
                            vec3 rgb = a > 0.0 ? cogl_color_out.rgb / a : cogl_color_out.rgb;
                            cogl_color_out = vec4((1.0 - rgb) * a, a);
                        `, false);
                    }
                });
            for (const [label, actor] of this._pnContentActors()) {
                try {
                    actor.add_effect_with_name(NAME, new this._pnInvertClass());
                    out.attached.push(`counter:${label}`);
                } catch (e) {
                    out.errors.push(`counter:${label}: ${e.message}`);
                }
            }
        }
        return JSON.stringify(out);
    }

    Quantise() {
        return this._pnQuantise(true);
    }

    Unquantise() {
        return this._pnQuantise(false);
    }

    // Pushed by pn-panel when switching the input source's face. The same rime
    // engine has TW (pinyin) and BP (bopomofo) faces, the IBus layer cannot tell
    // the difference, and only pn-panel knows which set to print on the caps.
    // Push, not pull: synchronous D-Bus in the shell blocks the main loop (noted
    // in README), and _composeLayout is synchronous.
    SetInputFace(face) {
        if (this._pnInputFace === face)
            return;
        this._pnInputFace = face;
        this._rebuild();
    }

    // Called when pn-panel switches RIME schemas: for those few hundred
    // milliseconds the candidate strip holds a [schema menu], not candidates,
    // and drawing it reads as 'broken' to the user rather than 'switching'. It
    // is held down here; released when done.
    // Only display is held down, the popup's state machine is untouched — the
    // menu still opens, keys are still sent, RIME still switches.
    SuppressCandidates(suppress) {
        globalThis._pnSuppressCandidates = !!suppress;
        const popup = IBusManager.getIBusManager()?._candidatePopup;
        if (popup)
            popup.opacity = suppress ? 0 : 255;
    }

    ShowKeyboard() {
        const kb = Main.keyboard;
        if (kb?.open)
            kb.open(Main.layoutManager.bottomIndex ?? 0);
        else
            kb?._keyboard?.open?.();
    }

    HideKeyboard() {
        const kb = Main.keyboard;
        if (kb?.close)
            kb.close();
        else
            kb?._keyboard?.close?.();
    }

    Palette() {
        // 🩸 The first version hardcoded this as [0,85,170,255] (four evenly
        //    distributed levels). The palette was later changed to the non-linear
        //    0/51/170/255, and the inspector did not follow, so #333 was
        //    reported as a violation — the rungs changed, the ruler did not, and
        //    what was measured was something else. The true rule is not 'which
        //    four values', it is **landing on the panel's 16 native grid
        //    levels**: 0x11 = 17, so the grid slots equal exactly the
        //    three-digit shorthand greys #000...#fff.
        //    If it can be written as #NNN it complies, if not it violates.
        const STEP = 17;
        const onGrid = v => v % STEP === 0;
        const out = {
            grid: `multiples of ${STEP} (#000-#fff shorthand greys)`,
            counts: {onLadder: 0, offRung: 0, chromatic: 0, translucent: 0},
            offRung: {}, chromatic: {}, translucent: {}, shadows: {}, gradients: {},
            actorsVisited: 0, widgetsRead: 0, errors: 0,
        };

        const bump = (bucket, key) => {
            out[bucket][key] = (out[bucket][key] ?? 0) + 1;
        };
        const label = actor => {
            const cls = actor.get_style_class_name?.() || "";
            const name = actor.get_name?.() || "";
            return `${actor.constructor?.$gtype?.name ?? "?"}${name ? "#" + name : ""}${cls ? "." + cls.split(/\s+/).join(".") : ""}`;
        };
        // Clutter.Color members changed names between versions, recognise both
        const rgba = c => c && [c.red ?? c.r, c.green ?? c.g, c.blue ?? c.b, c.alpha ?? c.a];

        const classify = (who, prop, c) => {
            const v = rgba(c);
            if (!v || v.some(x => x === undefined))
                return;
            const [r, g, b, a] = v;
            const key = `${who} {${prop}} rgba(${r},${g},${b},${a})`;
            if (a === 0)
                return;                      // Fully transparent = not drawn, does not count as violation
            if (a < 255) {
                out.counts.translucent++; bump("translucent", key); return;
            }
            if (r !== g || g !== b) {
                out.counts.chromatic++; bump("chromatic", key); return;
            }
            if (onGrid(r))
                out.counts.onLadder++;
            else {
                out.counts.offRung++; bump("offRung", key);
            }
        };

        const walk = actor => {
            out.actorsVisited++;
            if (actor.visible === false)
                return;                      // Invisible does not count
            if (actor instanceof St.Widget) {
                try {
                    const n = actor.get_theme_node();
                    const who = label(actor);
                    out.widgetsRead++;
                    classify(who, "background", n.get_background_color());
                    classify(who, "color", n.get_foreground_color());
                    for (const [side, nm] of [[St.Side.TOP, "border-top"],
                                              [St.Side.LEFT, "border-left"]]) {
                        if (n.get_border_width(side) > 0)
                            classify(who, nm, n.get_border_color(side));
                    }
                    if (n.get_box_shadow?.())
                        bump("shadows", who);
                    // 🩸 `get_background_gradient()` always returns an array in
                    //    GJS, using it as a truthy value reported every StBin as
                    //    having a gradient (the first version did exactly this,
                    //    and the 'StBin 18 times' number was the fingerprint:
                    //    containers cannot have gradients).
                    //    The type must be read, NONE means none.
                    const grad = n.get_background_gradient?.();
                    const gtype = Array.isArray(grad) ? grad[0] : grad;
                    if (gtype && gtype !== St.GradientType.NONE)
                        bump("gradients", `${who} gradient=${gtype}`);
                    if (n.get_background_image?.())
                        bump("gradients", `${who} image`);
                } catch (e) {
                    out.errors++;
                }
            }
            for (const child of actor.get_children?.() ?? [])
                walk(child);
        };

        try {
            walk(global.stage);
        } catch (e) {
            out.fatal = e.message;
        }
        // Keep only the most frequent, otherwise the list is too long for anyone
        // to finish reading
        const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 25);
        for (const k of ["offRung", "chromatic", "translucent", "shadows", "gradients"])
            out[k] = top(out[k]);
        return JSON.stringify(out, null, 1);
    }

    GridInfo() {
        const controls = pnOverviewControls();
        const grid = controls?._appDisplay?._grid;
        const lm = grid?.layout_manager;
        if (!lm)
            return JSON.stringify({error: "grid layout not found"}, null, 2);

        const pad = lm.pagePadding;
        // childSize is a private computation, but the method is an ordinary
        // method (not a vfunc), it can be called.
        // It is exactly the side length of each cell — and width and height
        // share the same number, so cells must be squares.
        const childSize = lm._getChildrenMaxSize
            ? lm._getChildrenMaxSize() : null;
        const spacing = childSize !== null && lm._calculateSpacing
            ? lm._calculateSpacing(childSize) : null;

        // What the minimum width/height of a tile is — it is the larger of these
        // two that determines childSize
        const sample = (() => {
            const page = lm._pages?.[0];
            const item = page?.visibleChildren?.[0];
            if (!item)
                return null;
            return {
                name: item.name ?? item.app?.get_name?.() ?? "?",
                minW: item.get_preferred_width(-1)[0],
                natW: item.get_preferred_width(-1)[1],
                minH: item.get_preferred_height(-1)[0],
                natH: item.get_preferred_height(-1)[1],
            };
        })();

        return JSON.stringify({
            mode: {columns: lm.columnsPerPage, rows: lm.rowsPerPage},
            gridModes: grid._gridModes ?? null,
            page: {w: lm._pageWidth, h: lm._pageHeight},
            padding: pad
                ? {t: pad.top, r: pad.right, b: pad.bottom, l: pad.left}
                : null,
            spacingCss: {
                column: lm.columnSpacing, row: lm.rowSpacing,
                maxColumn: lm.maxColumnSpacing, maxRow: lm.maxRowSpacing,
            },
            iconSize: lm.iconSize,
            fixedIconSize: lm.fixedIconSize,
            childSize,
            // [left margin, top margin, actual horizontal spacing, actual
            // vertical spacing]
            computed: spacing,
            nPages: lm.nPages,
            // Inside a folder is another layout manager (FolderGrid), and the
            // pinned icon size does not apply to it — so its iconSize converges
            // independently.
            folder: (() => {
                const fIcon = (pnOverviewControls()?._appDisplay?._orderedItems ?? [])
                    .find(i => i.style_class?.includes("app-folder"));
                const flm = fIcon?.view?._grid?.layout_manager;
                if (!flm)
                    return null;
                return {
                    mode: {columns: flm.columnsPerPage, rows: flm.rowsPerPage},
                    page: {w: flm._pageWidth, h: flm._pageHeight},
                    iconSize: flm.iconSize,
                    fixedIconSize: flm.fixedIconSize,
                    childSize: flm._getChildrenMaxSize
                        ? flm._getChildrenMaxSize() : null,
                    nPages: flm.nPages,
                };
            })(),
            sample,
            // What the second round needs: the tallest/widest tile after line
            // wrapping. Canvas width must be deduced from here, because
            // childSize is 'the maximum of the minimum sizes across all tiles',
            // not an average.
            extremes: (() => {
                const items = [];
                for (const page of lm._pages ?? []) {
                    for (const it of page.visibleChildren ?? []) {
                        items.push({
                            name: it.name ?? it.app?.get_name?.() ?? "?",
                            minW: it.get_preferred_width(-1)[0],
                            minH: it.get_preferred_height(-1)[0],
                            natH: it.get_preferred_height(-1)[1],
                        });
                    }
                }
                const by = k => [...items].sort((a, b) => b[k] - a[k]).slice(0, 4);
                return {tallest: by("minH"), widest: by("minW")};
            })(),
            // How much more each cell can grow: the ceiling to pack the
            // rows/columns onto the page
            headroom: childSize !== null && pad ? {
                byHeight: Math.floor((lm._pageHeight - pad.top - pad.bottom -
                    lm.rowSpacing * (lm.rowsPerPage - 1)) / lm.rowsPerPage),
                byWidth: Math.floor((lm._pageWidth - pad.left - pad.right -
                    lm.columnSpacing * (lm.columnsPerPage - 1)) /
                    lm.columnsPerPage),
            } : null,
        }, null, 2);
    }

    ArrowInfo() {
        const gl = this._pnGridLayout;
        const controls = pnOverviewControls();
        const dump = a => a ? {
            parent: a.get_parent()?.name || String(a.get_parent()),
            visible: a.visible, opacity: a.opacity, mapped: a.mapped,
            x: a.x, y: a.y, w: a.width, h: a.height,
        } : null;
        return JSON.stringify({
            gridLayoutFound: !!gl,
            chromed: !!this._pnArrows,
            stateValue: controls ? controls._stateAdjustment.value : null,
            prev: dump(this._pnArrows?.prev ?? null),
            next: dump(this._pnArrows?.next ?? null),
            entries: (() => {
                const c = pnOverviewControls();
                const dump = a => {
                    if (!a)
                        return null;
                    const [x, y] = a.get_transformed_position();
                    return {x, y, w: a.width, h: a.height, centre: y + a.height / 2};
                };
                return {
                    searchEntryBin: dump(c?._searchEntryBin),
                    searchEntry: dump(c?._searchEntry),
                };
            })(),
            decoys: this._pnDecoys ? {
                prev: dump(this._pnDecoys.prev),
                next: dump(this._pnDecoys.next),
            } : null,
            // The two go through the same code path but get different results —
            // print their actual differences
            diff: (() => {
                const a = this._pnArrows?.prev ?? null;
                const b = this._pnArrows?.next ?? null;
                if (!a || !b) return null;
                const probe = o => ({
                    styleClass: o.style_class,
                    xAlign: String(o.x_align), yAlign: String(o.y_align),
                    xExpand: o.x_expand, yExpand: o.y_expand,
                    minW: o.get_preferred_width(-1)[0],
                    natW: o.get_preferred_width(-1)[1],
                    minH: o.get_preferred_height(-1)[0],
                    natH: o.get_preferred_height(-1)[1],
                    fixedPos: o.fixed_position_set,
                    clip: o.has_clip,
                });
                return {prev: probe(a), next: probe(b)};
            })(),
        }, null, 2);
    }

    ShowAppGrid() {
        // Main.overview.showApps() gets there in one step: opens overview and
        // switches to the app grid page, exactly corresponding to those two taps
        // on 'top-bar top-left → dock far-right'.
        // showApps() only guarantees opening the overview, not stopping at the
        // app grid (measured to stay in the window picker). Push the state to
        // APP_GRID directly, that is the true basis of this switch.
        Main.overview.show();
        const controls = pnOverviewControls();
        if (controls) {
            controls._stateAdjustment.ease(PN_STATE_APP_GRID, {
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    // Used when photographing a specific page. Without it one can only rely on
    // swiping, and swiping cannot be timed precisely: what is to be measured is
    // on whichever page the user put it on, not where I put it.
    GoToPage(index) {
        pnOverviewControls()?._appDisplay?.goToPage?.(index);
    }

    HideOverview() {
        Main.overview.hide();
    }

    Rebuild() {
        this._config = readConfig();
        this._rebuild();
    }
}
