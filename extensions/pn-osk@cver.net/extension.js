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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Keyboard} from 'resource:///org/gnome/shell/ui/keyboard.js';

const BUILD = 23;

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
const keyval = (label, key) => ({label, keyval: key});

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
            if (purpose === Clutter.InputContentPurpose.TERMINAL &&
                ext._config.k6Layout)
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
    }

    disable() {
        const proto = Keyboard.prototype;

        if (this._origRelayout)
            proto._relayout = this._origRelayout;
        if (this._origUpdateLayout)
            proto._updateLayout = this._origUpdateLayout;
        if (this._origAddRowKeys)
            proto._addRowKeys = this._origAddRowKeys;

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
            console.warn('[pn-osk] no stock layout to compose from');
            return null;
        }

        const composed = {};
        for (const level of [0, 1]) {
            const rows = stock.levels?.[level]?.rows;
            if (!rows || rows.length < 4)
                return null;
            const portraitK6 =
                !landscape && (this._config.portrait?.k6 ?? DEFAULTS.portrait.k6);
            let built = landscape || portraitK6
                ? this._composeLevel(rows, level)
                : this._composePortrait(rows, level);
            if (!built)
                return null;
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

        return [
            [{label: L.esc, keyval: Clutter.KEY_Escape, width: w.esc ?? 1}, ...charKeys(faceFor(p.topRow, level))],
            balance(qwerty, flexIn(qwerty, byAction('delete')), cols),
            homeRow,
            letterRow,
            balance(bottom, flexIn(bottom, k => k.label === ' ' || k.strings?.[0] === ' '), cols),
        ];
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

        if (!backspace || !enter || !hide || !space || qwertyChars.length !== 10)
            return null;

        const extras = charKeys(faceFor(cfg.qwertyExtra, level));
        if (extras.length)
            extras[extras.length - 1].width = w.backslash;

        const icons = {...DEFAULTS.navIcons, ...cfg.navIcons};
        const navKey = (label, key, role) => (icons[role]
            ? {iconName: icons[role], keyval: key, width: w.nav}
            : {label, keyval: key, width: w.nav});
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
                {label: L.esc, keyval: Clutter.KEY_Escape, width: w.esc ?? 1},
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
        return out;
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
            layers,
            sampleKey: firstKey ? box(firstKey) : null,
            composed: this._lastComposed ?? null,
        }, null, 2);
    }

    Rebuild() {
        this._config = readConfig();
        this._rebuild();
    }
}
