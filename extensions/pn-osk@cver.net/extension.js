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

// 名字最多兩行。三行的名字（ImageMagick (color depth=q16)）在這台上是異數，
// 讓它省略，不要讓它去撐高每一格。
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
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const BUILD = 29;

// 這片面板的物理，是預設狀態不是一個開關。之前它靠我手打 D-Bus，那時候 CSS 還在
// 撐場面所以只是懶；CSS 覆寫剝掉之後這兩個常數就是承重牆 —— 沒有它們，登入進來
// 看到的是原廠深色 Adwaita，而不是我們宣稱做出來的那個東西。
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
// 直向是 5 列而不是 6，所以這不是一組轉置。轉置很誘人（兩個方向同樣數量），但
// 這塊面板做不到：橫向可用區域 936x578、直向 702x807，加上固定高度的搜尋列之後
// 兩者不是互為倒數，沒有任何一組轉置模式在兩邊都合身。6 列 x 120 = 720 塞進 723，
// 只剩 3px 可分 —— 行距被壓成 row-spacing 本身（12.6，而橫向是 24.6），同時右邊
// 空著 148px 而格子是正方形、用不上。5 列之後「兩個方向都塞得下的最大圖示」
// 不再由直向決定（56 -> 64），橫向每頁仍是 24。代價是兩邊每頁數量不同。
// 資料夾維持原廠 3x3。試過 4x4：setGridModes 只改畫法，不改容量 —— 分頁是既有的，
// 於是畫成 4 欄而每頁仍是 9 個，11 個 app 有 2 個留在第二頁，還多一顆換頁箭頭。
// _updatePages() 只把溢出的往後推；往前拉的 _fillItemVacancies() 叫了也沒有效。
// 再往下就是自己重寫分頁，而分頁是 shell 用來記住每個 app 位置的東西，不是版面。

const PN_GRID_MODES = [
    {rows: 5, columns: 4},   // 直向
    {rows: 4, columns: 6},   // 橫向
];

// ControlsState.APP_GRID。overviewControls.js 沒有 export 這個 enum，而擴充又
// import 不到模組內的 const，所以這裡寫死 —— 它是 shell 的公開狀態序號
// (HIDDEN=0, WINDOW_PICKER=1, APP_GRID=2)，不是我們自己編的值。
const PN_STATE_APP_GRID = 2;

// BaseAppViewGridLayout 沒有 export，實例掛在一個內部容器的 layoutManager 上，
// 沒有穩定的公開路徑 —— 用特徵找它（它是唯一擁有 _getIndicatorsWidth 的 layout）。
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
            // 終端機是這個版面的出身，但 Esc／Tab／數字排在一般文字輸入裡一樣要用
            // —— 資料夾改名沒有 Esc 就只能送出、不能取消。專用用途（密碼、數字、
            // 電話、Email、URL）留給 GNOME：那些它會給專門的版面，蓋掉只會更糟。
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

        // app grid = 全螢幕啟動器：收回工作區預覽與 dash 佔的垂直空間
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

        // 量化器。跟上面兩條同一個 2 秒的理由：這些 actor 在 enable() 當下還沒
        // 全部就位，而 _pnContentActors 要的 _workspacesDisplay 尤其晚。
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

        // 1) 工作區預覽在 APP_GRID 下高度歸零。AppDisplay 的位置是從這個 box 的
        //    高度算出來的，所以歸零之後它會自己往上移，不必碰任何座標。
        this._pnOrigWorkspacesBox = layout._computeWorkspacesBoxForState;
        layout._computeWorkspacesBoxForState = (state, ...args) => {
            const box = this._pnOrigWorkspacesBox.call(layout, state, ...args);
            if (state === PN_STATE_APP_GRID)
                box.set_size(box.get_width(), 0);
            return box;
        };

        // 2) AppDisplay 在 APP_GRID 下吃到螢幕底部。原本的算式會扣掉 dashHeight，
        //    而我們正要把那塊還給它。
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
                // 從搜尋框那一列開始，而不是從它下面 —— 多出來的這一段是要
                // 借給換頁箭頭站的地方。grid 自己會在下面的 allocate 裡往下推，
                // 所以視覺上內容仍從搜尋框之下開始。
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
                // 讓 grid 知道要讓出多少（searchHeight + spacing）
                this._pnTopInset = searchHeight + spacing;
                return appBox;
            };

        // 3) dash 在 APP_GRID 下讓開。佈局仍然會分配它（那段不是獨立函式，硬拆
        //    風險大於收益），所以用不可見 + 不可點來讓它退場。
        this._pnStateSignal = controls._stateAdjustment.connect('notify::value', () => {
            const v = controls._stateAdjustment.value;
            const inAppGrid = v > 1.5;
            controls.dash.opacity = inAppGrid ? 0 : 255;
            controls.dash.reactive = !inAppGrid;
            // 零高度的 box 不會讓元件消失 —— 它會改用自己的最小尺寸把自己畫出來，
            // 於是變成畫面右半邊那塊黑。要讓它真的退場得動 visible。
            const wd = controls._workspacesDisplay;
            if (wd)
                wd.visible = !inAppGrid;
        });

        // 收回左右給箭頭的走道：那條留白與箭頭的容身處是同一個數字，
        // 壓到 0 之後 grid 吃滿寬度，箭頭落在邊緣，翻頁另有觸控滑動。
        const gridLayout = pnFindGridLayout(controls._appDisplay);
        if (gridLayout) {
            this._pnGridLayout = gridLayout;
            this._pnOrigIndicatorsWidth = gridLayout._getIndicatorsWidth;
            gridLayout._getIndicatorsWidth = () => 0;
            gridLayout.layout_changed();
            this._pnInstallTopArrows();
            this._pnFloatArrows();
            this._pnInstallLabelWrap();

            // 量測要等第一次配置，快取不用 —— 先套上去，第一幀就是對的。
            // 之後 _pnSyncIconSize 照樣量，不一樣就更新。
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
            // 直接問搜尋框本人，不靠跨物件傳遞的變數 —— 那兩個 allocate
            // 的時機不保證同步，第一輪必然拿到 0。
            const controls = pnOverviewControls();
            const entry = controls?._searchEntryBin ?? controls?._searchEntry;
            const inset = entry ? entry.height + Math.round(entry.height * 0.15) : 0;
            if (!inset) {
                origAllocate.call(this, container, box);
                return;
            }

            // grid 讓出頂部那一列
            const gridBox = box.copy();
            gridBox.y1 += inset;
            this._grid.indicatorsPadding = new Clutter.Margin({left: 0, right: 0});
            this._scrollView.allocate(gridBox);

            // 箭頭擺在讓出來的那一列的兩端
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

// 標籤寬度：第一輪先給一個接近現況格子（119 − tile padding）的值，量完
    // 真正的 childSize 之後第二輪再由畫布反推。不用猜的那一版在下一個 commit。
    // 🔴 模式（幾欄幾列）必須從螢幕比例決定，不能從頁面尺寸決定。
    // 頁面寬度現在是我們算出來的，而 _findBestModeForSize 拿它回頭挑模式 ——
    // 輸出變成輸入，於是轉向之後它讀到的是舊方向那個窄畫布，選了舊方向的模式，
    // 舊方向的模式又讓畫布繼續窄下去。自我肯定的迴圈，鎖死在直向。
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
            // 🔴 原版不是「回傳索引給呼叫端」—— 它自己就呼叫 _setGridMode，而
            // vfunc_allocate 對回傳值一個字都沒用。只回傳的版本＝模式從安裝那一刻
            // 起就凍住（凍在安裝時的方向），而且看起來完全正常，因為安裝時剛好對。
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

    // 量出來的圖示尺寸留一份。它只能在第一次配置之後才算得出來（要 _pageHeight），
    // 所以沒有快取的話，開機後第一幀一定是 _findBestIconSize 從梯子上挑的那個
    // ——實測 96，而正確答案是 64，使用者看到的就是「先大再縮」。
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
            // 快取寫不進去只是下次會再閃一下，不值得讓它中斷別的事
            console.log(`[pn-osk] icon size cache not written: ${e.name}`);
        }
    }

    // 圖示大小該是常數，不是餘數。兩個方向各算一次「每格容得下多大」，取小的那個 ——
    // 這樣轉螢幕時圖示不動，動的是間距，跟 iPad 一樣。
    _pnSyncIconSize() {
        const lm = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        const grid = pnOverviewControls()?._appDisplay?._grid;
        const mon = Main.layoutManager.primaryMonitor;
        const pad = lm?.pagePadding;
        if (!lm || !grid || !mon || !pad || !lm._pageHeight)
            return;

        // 格子 = 圖示 + 固定開銷（兩行標籤 + tile padding）。這個差值跟圖示大小無關，
        // 所以現在量一次就能拿去推算任何圖示尺寸下的格子大小。
        const overhead = lm._getChildrenMaxSize() - lm.iconSize;
        if (overhead <= 0)
            return;

        // 面板 + 搜尋列 + grid 自己的邊界。用量的，不要用推的 —— 這一段今天已經
        // 讓兩軸的縫差了 16px 一次。
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
        // 現在這個方向，以及轉過去的那個方向
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

        // 上限留在 96：那是主題與圖示主題都預期的最大尺寸，再上去是另一個題目。
        // 吸附到 4 的倍數。chromeV（面板＋搜尋列）只量得到當下這個方向，兩個方向
        // 之間差了幾個 px，直接用會讓圖示在轉向時跳 1px —— 正是這整件事要消滅的
        // 東西。吸附把量測雜訊吃掉，代價最多 3px。
        const raw = Math.max(16, Math.min(96, fits - overhead));
        const size = Math.floor(raw / 4) * 4;
        if (lm.fixedIconSize === size || this._pnIconSizePending === size)
            return;
        // 這個方法是從配置途中叫到的（那是唯一 _pageHeight 已經有值的時機）。
        // 在那裡改屬性再 layout_changed 等於在配置中途要求重新配置 —— 排到 idle
        // 去做，讓這一幀先畫完。
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

    // 格子是正方形，邊長由高度決定 —— 那是硬的。所以寬度不該是「螢幕有多寬」，
    // 而是「要多寬，水平間距才會等於垂直間距」。算得出來就不必靠 max-column-spacing
    // 去夾，也不會有夾完剩下的死留白。
    _pnCanvasWidth(fullWidth, height) {
        const lm = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        if (!lm?._getChildrenMaxSize)
            return fullWidth;
        this._pnSyncIconSize();

        // 每次都重新量：childSize 是快取的，而標籤的高度是在畫布算完之後才
        // 生效的 —— 用上一幀的邊長算出來的寬度，會讓兩軸的縫差一截（19.4 對 14）。
        // 26 個 item 重量一次的成本遠低於「版面永遠慢一拍」。
        lm._childrenMaxSize = -1;
        const cell = lm._getChildrenMaxSize();
        const rows = lm.rowsPerPage;
        const cols = lm.columnsPerPage;
        const pad = lm.pagePadding;
        if (!cell || rows < 2 || cols < 2 || !pad)
            return fullWidth;

        // 🔴 高度要跟 layout 拿，不要用我自己算的那個。我傳進來的 appHeight 是
        // 「我給 AppDisplay 的框」，而垂直間距是 grid 用 _pageHeight 算的，兩者
        // 差了 16px（grid 自己的邊界）。用錯的那個，公式再對也對不齊：
        // 算出 19.3 的縫，而 layout 那邊是 14。同一個量只能有一個來源。
        const h = lm._pageHeight || height;
        const emptyV = h - pad.top - pad.bottom - cell * rows -
            lm.rowSpacing * (rows - 1);
        // 上限會夾住實際的縫寬，剩下的由 layout 變成上下置中的留白。畫布要照
        // **夾過之後**的那個值算，不然水平會比垂直寬一截。
        const rawGap = lm.rowSpacing + Math.max(emptyV, 0) / (rows - 1);
        const gap = lm.maxRowSpacing > 0
            ? Math.min(rawGap, lm.maxRowSpacing) : rawGap;

        // 同樣的縫寬套到水平，反推畫布
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
                // 折行之前量一次單行高度 —— 折行之後就再也量不到了
                oneLine: label.get_preferred_height(-1)[1],
            };
        }
        // 先夾寬度再開折行 —— 順序反過來的話中間那一幀的自然寬度是整行文字
        label.set_width(this._pnLabelWidth());
        // 釘死兩行的高度。不釘的話 _getChildrenMaxSize 拿 get_preferred_height(-1)
        // 量到的是「不限寬」＝一行，第二行不會有人替它出高度，第三行直接掉出畫面。
        label.set_height(item._pnWrapSaved.oneLine * PN_LABEL_LINES);
        ct.set({
            // BaseIcon 建構時設的是 CENTER —— 單行名字會浮在預留的兩行正中間，
            // 跟圖示之間空一截。靠上才貼著圖示。
            y_align: Clutter.ActorAlign.START,
            line_wrap: true,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
            // 折了還是放不下（例如一個長到沒有空白可斷的字）才省略
            ellipsize: Pango.EllipsizeMode.END,
        });
    }

    // 只設 fixedIconSize 不夠：真正在畫的是 _iconSize，而它只在 adaptToSize
    // 發現頁面尺寸變了、排一個 BEFORE_REDRAW 的 later 時才重算。直接做那件事。
    _pnApplyIconSize(lm, size) {
        lm.fixedIconSize = size;
        lm._iconSize = size;
        for (const child of lm._container ?? [])
            child.icon?.setIconSize?.(size);
        lm._childrenMaxSize = -1;
        lm.layout_changed();
    }

    // 改名的入口從那顆筆換成「點標題」。筆藏起來（toggle 的 checked 照樣設得動），
    // 熱區加進 Shell.Stack —— 它是疊的不是排的，所以熱區自然就蓋住標題。
    _pnInstallTitleTap(dialog) {
        const btn = dialog?._editButton;
        const stack = dialog?._folderNameLabel?.get_parent();
        if (!btn || !stack || dialog._pnTitleTap)
            return;

        // 藏起來而不是塗掉：BoxLayout 不會替隱形的孩子留位置，而 ghostButton 的
        // 尺寸綁在它身上 ⇒ 佔位一起歸零，標題置中到全寬。
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

        // 🔴 編輯中一定要讓開。不讓開的話熱區會蓋在 input 上，游標點不進去 ——
        // 而且症狀是「改名功能壞了」，看不出是熱區造成的。
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

    // 資料夾的圖示跟 Launcher 一樣大。FolderGrid 是獨立的 layout manager，所以
    // 外層釘的尺寸不會自動套過來；而它的預設是 IconSize.LARGE（96），在原廠
    // 720 的對話框裡剛好塞得下，於是一旦把對話框縮小就會被擠成 64 —— 那一下
    // 就是「先大再縮」。在 popup 之前釘好，第一幀就是對的。
    _pnSyncFolderIconSize(view) {
        const lm = view?._grid?.layout_manager;
        const outer = pnOverviewControls()?._appDisplay?._grid?.layout_manager;
        const size = outer?.fixedIconSize;
        if (!lm || !size || size < 16 || lm.fixedIconSize === size)
            return;
        this._pnApplyIconSize(lm, size);
    }

    // 資料夾裡的項目是 FolderView 自己的一組，不在 appDisplay._orderedItems 裡。
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
                // 資料夾的內容現在就在（FolderIcon.view），不必等對話框建立 ——
                // 等到那時候才套，第一幀已經用沒折行的尺寸畫過一次了。
                if (item.view) {
                    this._pnSyncFolderIconSize(item.view);
                    this._pnApplyWrapToView(item.view);
                }
            }
            appDisplay._grid?.layout_manager?.layout_changed();
        };
        apply();
        // 裝了新 app 之後 grid 會重建 —— 沒有這條，新來的那顆會是唯一被截斷的
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

        // 記住原本的家：disable 時要還回去，替身也要住進去（見下）
        this._pnArrowHome = prev.get_parent();
        this._pnArrows = {prev, next};

        for (const arrow of [prev, next]) {
            arrow.get_parent()?.remove_child(arrow);
            // 一顆一顆 addChrome，不是先做一個鋪滿螢幕的層再把它們放進去。
            // 那個層帶著 affectsInputRegion，等於在畫面上蓋一張透明壓克力板，
            // 連頂列都點不動 —— 箭頭要能點就得進輸入區，但只有箭頭需要。
            Main.layoutManager.addChrome(arrow, {
                trackFullscreen: false,
                affectsStruts: false,
                affectsInputRegion: true,
            });
            arrow.reactive = true;
            // CENTER 對齊要 parent 分配 box 才有尺寸，chrome 不做這件事
            arrow.x_align = Clutter.ActorAlign.START;
            arrow.y_align = Clutter.ActorAlign.START;
        }

        // grid 的 allocate 仍會直接對 layout 上那兩個屬性指到的 actor 下
        // allocate（Clutter 允許對非自己 child 的 actor 這樣做），把它們壓回
        // 零寬的 indicators box。換成替身，讓它去挨那一下。
        //
        // 🔴 替身必須有父節點：upstream 用 show()/hide() + ease({opacity}) 控制
        // 顯隱，而 ClutterTransition 的時間軸跟著 stage 走。無父節點 ⇒ 沒有
        // stage ⇒ 動畫不會跑完 ⇒ onComplete 裡的 hide() 永遠不發生。放回箭頭
        // 原本的家，它們才收得到完整的週期，而我們鏡射得到正確結果。
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
        // 狀態動畫跑完 ≠ 版面安定。箭頭的座標來自搜尋框和 grid 的實際位置，
        // 所以要等它們真的配置好 —— allocation 每次安定都會發一次，轉向也是。
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

    // 資料夾對話框打開時，我們的浮動箭頭要退場。它是 addChrome 上去的、浮在整個
    // shell 之上，而判斷依據只有 _stateAdjustment —— 對話框打開時狀態仍是 APP_GRID，
    // 所以它不知道有東西蓋上來了。AppDisplay 沒有對外的訊號，但 addFolderDialog 是
    // 普通方法，包一層就能在每個對話框身上接到 open-state-changed。
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

        // 🔴 掛 hook 只接得到**未來**出生的對話框，而 FolderIcon 會把它建過的那個
        // 快取在 `_dialog` 上 —— disable/enable 一輪（每次重載 stylesheet 都是一輪，
        // GNOME 自己也會做）之後，既有的那些永遠等不到 addFolderDialog 再被呼叫，
        // 補丁就這樣安靜地不見了：鉛筆鈕回來、點標題改名的熱區消失。
        // 症狀看起來像「功能被刪掉了」，其實是**認養名單漏掉了已經在場的人**。
        for (const item of appDisplay._orderedItems ?? []) {
            if (item._dialog)
                this._pnAdoptDialog(item._dialog);
        }
    }

    // 一個對話框該被做的所有事，建立時和事後認養共用同一份 —— 分成兩份寫，
    // 遲早會有一邊漏掉一項。
    _pnAdoptDialog(dialog) {
        if (!dialog || this._pnDialogs?.has(dialog))
            return;
        const ext = this;
        this._pnSyncFolderIconSize(dialog._view);
        this._pnInstallTitleTap(dialog);
        this._pnDialogs.add(dialog);
        dialog.connect("destroy", () => ext._pnDialogs.delete(dialog));
        // dialog._view 是 FolderView，_grid 是 FolderGrid（它自己的 layout
        // manager，跟外層 grid 無關，所以釘死的圖示尺寸不會套到這裡）
        this._pnApplyWrapToView(dialog._view);
        // 原版的 handler 先接、先跑，所以我們讀到的 _displayingDialog 已經是新值
        dialog.connect('open-state-changed', (o, isOpen) => {
            ext._pnSyncArrowVisibility();
            // 項目是延遲建立的 —— 包裝當下跑一次會漏掉還沒生出來的那些
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

    // 真箭頭該不該出現 = 「upstream 認為該不該出現」AND「現在在 app grid」。
    // 前半直接讀替身 —— 第一頁沒有 prev、最後一頁沒有 next 那段數學是
    // upstream 的 _syncPageIndicators 算的，沒有理由重寫一次。
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
        // 先要 _searchEntry：那是畫得出圓角的那個框。_searchEntryBin 是它的
        // 容器，上下帶著不對稱留白，中心差 3px —— 對齊容器等於對齊一個看不見的東西。
        const entry = controls._searchEntry ?? controls._searchEntryBin;
        const {prev, next} = this._pnArrows;
        if (!mon || !entry || !prev || !next)
            return;

        // 搜尋框那一列的垂直中心（用它自己的 allocation，不用推算）
        const [, entryY] = entry.get_transformed_position();
        const centerY = entryY + entry.height / 2;
        const margin = Math.round(mon.width * 0.03);

        // 只管位置，尺寸交給 stylesheet。先前這裡 set_size(arrow.width || 48)
        // 等於拿一個猜來的數字蓋掉樣式算出的值 —— 讀到 0 就把 0 寫回去。
        // 寬度問 actor 自己要（natural width），不要拿 css 的 px 乘 scale_factor
        // 去推 —— 那等於在兩個座標系之間猜換算，而它本人知道答案。
        // 箭頭對齊第一／最後一欄的欄心。畫布現在是算出來的、比螢幕窄，所以
        // 「貼螢幕邊緣」跟「跟 app 同一條垂直線」已經不是同一件事了。欄心跟 grid
        // 要（_calculateSpacing 回的 leftEmpty 和 hSpacing），不要自己推。
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
            // 不用 get_transformed_position：它在 actor 還沒配置好時會回無效值，
            // 而 NaN 會一路傳到 set_position，箭頭就從畫面上消失。畫布是我們自己
            // 置中的、寬度 layout 也記著，左緣直接算得出來。
            const gridX = mon.x + (mon.width - lm._pageWidth) / 2;
            const first = gridX + leftEmpty + cell / 2;
            const last = first + (cols - 1) * (cell + hSpacing);
            return [first, last];
        })();

        // 🔴 尺寸只問一顆：隱藏的那顆保留著舊的偏好尺寸（實測 52 對 40），
        // 各問各的會讓兩顆用不同的 h 算中心，落點差 6px。優先問還映射著的那顆。
        const sizeFrom = [prev, next].find(a => a.mapped) ?? prev;
        const [, arrowW] = sizeFrom.get_preferred_width(-1);
        const [, arrowH] = sizeFrom.get_preferred_height(-1);

        const place = (arrow, alignRight) => {
            const w = arrowW;
            const h = arrowH;
            const centre = columnCentres?.[alignRight ? 1 : 0];
            // 任何一項算壞就退回貼邊。箭頭放錯位置還看得見，NaN 是直接消失。
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
            grid.setGridModes(null);   // null 讓它回到 shell 的預設

        if (this._pnPosteriseTimeoutId) {
            GLib.source_remove(this._pnPosteriseTimeoutId);
            this._pnPosteriseTimeoutId = 0;
        }
        // 走整棵樹拆，不是走當初掛上去的那份清單 —— actor 會被重建，清單會留孤兒。
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

        if (!backspace || !enter || !hide || !space || qwertyChars.length !== 10) {
            // 哪一個不見了要講出來 —— 「找不到某個鍵」和「字母數不對」是完全
            // 不同的兩件事，而它們原本共用一個沉默的 return
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

    // ── 候選字窗貼底 ──────────────────────────────────────────────────
    // 候選字有兩條路，而它們的容器是不同的東西：
    //
    //   OSK 開著   ibusCandidatePopup 的 _updateVisibility() 裡有
    //              `!Main.keyboard.visible`，浮動窗自己關掉，候選改由
    //              Main.keyboard.addSuggestion() 推進 OSK 上緣那條 strip。
    //              那條 strip 本來就貼在按鍵正上方 —— 要的位置它天生就有，
    //              缺的只是高度（見 _forceFullWidth）。
    //
    //   OSK 沒開   走這個 BoxPointer，預設釘在游標上跟著字跑。
    //
    // 貼底要改的只有後者。把假游標挪到螢幕底緣、寬度給滿、高度給 0：
    // BoxPointer 是 St.Side.TOP（箭頭在上、盒子在下），底下沒有空間時它自己
    // 會翻到上方，於是盒子落在底緣、水平置中 —— 兩條路的候選字就都在同一個
    // 地方出現，眼睛不必在螢幕上找它。
    //
    // 🔴 覆寫的是**實例**的方法不是原型。這顆 popup 由 ibusManager 建立且只有
    //    一個，而原型上還有別人；跟 _forceFullWidth 覆寫 ac.setRatio 同一個理由。
    _pnDockCandidatePopup() {
        const popup = IBusManager.getIBusManager()?._candidatePopup;
        if (!popup || popup._pnOrigSetDummy)
            return;

        // 停靠線：OSK 開著就是鍵盤上緣，沒開就是螢幕底緣。
        //
        // 🔴 鍵盤上緣要用「螢幕底緣減鍵盤高度」算，**不要**去讀 keyboardBox 的
        //    座標。_animateShowComplete() 做的是 `this.translation_y = -this.height`
        //    —— 平移掛在 Keyboard 自己身上，keyboardBox 其實坐在螢幕底緣之下，
        //    鍵盤是往上平移進來的。讀 keyboardBox.get_transformed_position() 會
        //    拿到底緣，於是候選窗整條蓋在鍵盤上（2026-08-18 實測就是這樣）。
        //    反推還有一個好處：動畫途中它算的是最終停靠位置，候選窗不會跟著滑。
        //
        // 假游標給滿寬、零高，
        // BoxPointer 是 St.Side.TOP（箭頭在上、盒子在下），下方沒有空間時它自己
        // 翻上去 —— 於是盒子貼著那條線的上方、水平置中。
        const dockLine = () => {
            const mon = Main.layoutManager.primaryMonitor;
            if (!mon)
                return null;
            let y = mon.y + mon.height;
            const kb = Main.keyboard?._keyboard;
            if (Main.keyboard?.visible && kb?.height)
                y -= kb.height;
            return [mon.x, y, mon.width, 0];
        };

        const applyDock = () => {
            const dock = dockLine();
            if (!dock)
                return false;
            // 🔴 箭頭要在**下**。BoxPointer 建構時是 St.Side.TOP，意思是箭頭在
            //    上、盒子在下 —— 錨在鍵盤上緣的結果是候選字整條畫進數字列裡
            //    （2026-08-18 量到 box y=468 h=54，鍵盤正好從 468 開始）。
            //    我原本以為「下面沒空間就會自己翻」，但下面有空間：那是鍵盤佔的
            //    螢幕，不是螢幕外。翻不翻是它自己決定的，不是我們要的保證。
            //    _reposition 的 St.Side.BOTTOM 分支算的是
            //        resY = sourceTopLeft.y - natHeight - gap
            //    正是我們要的「盒子貼在錨點上方」。
            //
            // 🔴 要寫 _userArrowSide，不能只呼叫 updateArrowSide()。後者只改
            //    _arrowSide 並重畫邊框，而每次配置都會跑 _updateFlip()：
            //        let arrowSide = this._calculateArrowSide(this._userArrowSide);
            //    它是從 _userArrowSide 重算再覆寫 _arrowSide 的 —— 所以只呼叫
            //    updateArrowSide 的話，下一次配置就被建構時那個 TOP 打回去。
            //    實測就是這樣：改了 arrow side，量到的位置一格都沒動。
            popup._userArrowSide = St.Side.BOTTOM;
            popup.updateArrowSide(St.Side.BOTTOM);
            popup._pnOrigSetDummy(...dock);
            return true;
        };

        popup._pnOrigArrowSide = popup._userArrowSide;
        popup._pnOrigSetDummy = popup._setDummyCursorGeometry.bind(popup);
        popup._setDummyCursorGeometry = (x, y, w, h) => {
            if (!applyDock())
                popup._pnOrigSetDummy(x, y, w, h);
        };

        // 🔴 上游把浮動窗和 OSK 當成互斥的兩條路：
        //        isVisible = !Main.keyboard.visible && (preedit || aux || candidates)
        //    OSK 開著時它關掉自己，候選改由 Main.keyboard.addSuggestion() 推進
        //    OSK 上緣那條 suggestions strip。
        //
        //    而那條 strip 在這台上拿不到高度：fillWidth 把 AspectContainer 的比例
        //    釘成整條帶子（setRatio(keyboard.width, keyboard.height)），按鍵區的
        //    偏好高度就是整條帶子，配置時先被餵飽，strip 剩 0。兩邊同時失效，
        //    所以 OSK 一開就什麼候選都看不到 —— 而實體鍵盤（OSK 沒開）正常。
        //
        //    🔴 歸因更正（2026-08-18）：這裡一度寫成「kb._suggestions 是 null」。
        //       那是誤讀 —— 當時 Geometry 還沒有 suggestions 欄位，而讀取端把
        //       「鍵不存在」和「值是 null」收斂成同一個 None。補上欄位再量，它
        //       是 visible=true / children=0 / naturalHeight=0，也就是存在但被
        //       擠成沒有高度。strip 從來沒有消失過，只是沒有位置。
        //
        //    修法有兩個，選了後者：
        //      (a) 讓 strip 拿回高度 —— 有候選時把它的自然高度從比例裡扣掉。
        //          能動，但候選字會出現在兩個地方（浮動窗貼底、strip 貼鍵盤），
        //          而且 strip 這條路沒有編號：addSuggestion(text, callback) 不帶
        //          index，只能用點的。
        //      (b) 把 !Main.keyboard.visible 拿掉，讓浮動窗同時服務兩種情況，
        //          strip 就維持 0 —— 那也讓 fillWidth 賺到的滿版不必還回去。
        //          一個元件、一個位置、有 1-9 可以按。
        //
        //    圖層不必自己處理：
        //    上游在 isVisible 分支裡本來就有
        //        this.get_parent().set_child_above_sibling(this, keyboardBox)
        //    註解寫著「just above the keyboard gets us to the right layer」——
        //    它早就準備好被畫在 OSK 之上，只是從來沒有機會。
        //
        // ⚠️ 這一段是照抄上游的 _updateVisibility 再拿掉一個條件，所以它會跟著
        //    上游漂移。升級 gnome-shell 之後候選窗行為變怪的話，先來對這一段。
        popup._pnOrigUpdateVisibility = popup._updateVisibility.bind(popup);
        popup._updateVisibility = () => {
            const isVisible = popup._preeditText.visible ||
                popup._auxText.visible ||
                popup._candidateArea.visible;

            if (isVisible) {
                // 🔴 每次要顯示之前重算停靠線。位置本來只在 cursor-location-changed
                //    的時候算一次，而那一刻 OSK 常常還沒升起 —— 算出來的是螢幕底
                //    緣，然後就這樣定住，候選窗整條蓋在鍵盤上。顯示時機才是唯一
                //    保證「OSK 現在到底在不在」已成定局的時機。
                applyDock();
                // 錨點是滿寬的一條線，alignment 0.5 才會置中；0 會把盒子推向一邊
                // （量到 x=234 w=696，右緣貼著 930）。
                popup.setPosition(popup._dummyCursor, 0.5);
                popup.open(BoxPointer.PopupAnimation.NONE);
                const {keyboardBox} = Main.layoutManager;
                popup.get_parent().set_child_above_sibling(popup, keyboardBox);
            } else {
                popup.close(BoxPointer.PopupAnimation.NONE);
            }
        };
    }

    _pnUndockCandidatePopup() {
        const popup = IBusManager.getIBusManager()?._candidatePopup;
        if (popup?._pnOrigSetDummy) {
            popup._setDummyCursorGeometry = popup._pnOrigSetDummy;
            delete popup._pnOrigSetDummy;
        }
        if (popup?._pnOrigUpdateVisibility) {
            popup._updateVisibility = popup._pnOrigUpdateVisibility;
            delete popup._pnOrigUpdateVisibility;
        }
        // 箭頭方向也要還原，不然停用擴充之後候選窗會繼續畫在游標上方。
        //
        // 🔴 要包 try。disable 有一半的情況是整個 shell 在拆，那時候這顆 popup
        //    可能已經被 C 端 dispose 掉了，而 updateArrowSide() 會去碰
        //    this._border / this.bin —— 丟出 "this.bin is undefined"，然後把
        //    後面還沒還原的東西一起跳過。實測看得到：restart gdm3 的日誌裡，
        //    舊 session 熄燈前正好噴兩個這種 JS ERROR。
        if (popup && popup._pnOrigArrowSide !== undefined) {
            try {
                popup._userArrowSide = popup._pnOrigArrowSide;
                popup.updateArrowSide(popup._pnOrigArrowSide);
            } catch (e) {
                // 已經拆掉了，本來就不需要還原
            }
            delete popup._pnOrigArrowSide;
        }
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
            // 候選字列。它跟 aspectContainer 是同一個垂直配置裡的兄弟，兩個搶
            // 同一份高度，所以少了它這份 dump 讀不出「按鍵區為什麼是這個高度」。
            // children 是關鍵欄位：strip 永遠 visible（見 _forceFullWidth 的註解），
            // 有沒有候選字要看它有沒有孩子。
            // 候選字窗。它不是鍵盤的一部分，但它的位置**由**鍵盤決定
            // （見 _pnDockCandidatePopup 的停靠線），所以量鍵盤的時候要一起看
            // 得到它 —— 不然「有沒有貼在鍵盤上緣」只能靠拍照。
            candidates: (() => {
                const p = IBusManager.getIBusManager()?._candidatePopup;
                if (!p)
                    return null;
                return {
                    box: box(p),
                    visible: p.visible,
                    dummyCursor: box(p._dummyCursor),
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
        // FolderIcon.open() 就是 vfunc_clicked 呼叫的那個，不必模擬點擊
        const appDisplay = pnOverviewControls()?._appDisplay;
        for (const item of appDisplay?._orderedItems ?? []) {
            if (item.style_class?.includes("app-folder") && item.open) {
                item.open();
                return;
            }
        }
    }

    RenameFolder() {
        // 開資料夾並直接進改名狀態。這個狀態要人點兩下才到得了，而它是接下來
        // 每一輪都要看的東西。
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

    // 這片面板有 16 階（0,17,…,255），所以介面的灰只要落在少數幾根分得很開的
    // 梯級上就不會被再量化，也不會在黑白模式下互相糊掉。敵人從來不是灰，是**彼此
    // 靠太近的灰**。梯級取 0/85/170/255 —— 全是 17 的整數倍，正好是面板的第
    // 0、5、10、15 階。
    //
    // 🔑 這支不寫任何 CSS，它**讀畫出來的結果**。對著選擇器寫規則的東西會安靜地
    // 爛掉（PNEink 的 `#keyboard` 就是：規則還在、主題有載入、GNOME 48 上指不到
    // 任何東西，鍵盤因此一直是原廠灰而沒有人發現）。走 actor 樹讀 theme node 不會
    // 有這個問題 —— 名字改了它就是不再出現在清單上，而不是變成一條沉默的死規則。
    // 調色要看玻璃，而看玻璃要鍵盤在畫面上。這台是從 SSH 開的，所以給它一條
    // 不必動用手指的路 —— 跟 Capture／Tone／Rotate 同一個理由。
    // ── 量化器 ───────────────────────────────────────────────────────────
    // Palette() 只回報；這支動手。一個選擇器都不出現 —— 它讀的是每個元件**算出來
    // 的**顏色，所以名字改了它就是量到別的東西，而不是變成一條沉默的死規則。
    //
    // 決定每個值的方式：
    //   彩色     取亮度轉灰再吸附。顏色在這片玻璃上本來就會變成某個灰，吸附只是
    //            讓那個灰可預測。
    //   半透明   用父層算出來的背景壓平再吸附 —— 這是要走「樹」而不是走清單的
    //            原因：alpha 的意義取決於它底下是什麼。
    //   全透明   不碰。alpha 0 是「不畫」，不是一個顏色。
    //   陰影     移除。它是連續漸層，十六格裡沒有一格放得下它。
    //
    // 🔴 這是「物理」不是「設計」：它只把值搬到最近的格子，不換排法。想換排法
    // （例如鍵盤的白鍵配灰床）就得寫 CSS，那不是搬得近能變出來的。
    _pnQuantise(apply) {
        const STEP = 17;
        const snap = v => Math.max(0, Math.min(255, Math.round(v / STEP) * STEP));
        const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const rgba = c => {
            if (!c) return null;
            const v = [c.red ?? c.r, c.green ?? c.g, c.blue ?? c.b, c.alpha ?? c.a];
            return v.some(x => x === undefined) ? null : v;
        };
        // 把一個顏色壓平到不透明的格子值。under = 它底下那一層已經算好的灰。
        const flatten = (c, under) => {
            const v = rgba(c);
            if (!v || v[3] === 0)
                return null;                  // 不畫就別畫
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
                                break;        // St 的 border-color 是四邊一起設
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

    // ── 量化 shader ──────────────────────────────────────────────────────
    // 逐元件那條路（下面的 _pnQuantise）讀的是語意屬性，所以碰得到背景色卻碰不到
    // 圖示；這條路相反 —— 它是後製濾鏡，看到的只有像素，所以什麼都涵蓋（包括新
    // 開的選單、hover 狀態），代價是它也分不出圖示。
    //
    // 「只動介面不動內容」＝ 只掛在 chrome 的 actor 上，不掛 global.window_group。
    // 那正是 Apple 智慧型反轉的語意。（今天測 a11y 反相時看到的貓變負片，就是因為
    // 那是全螢幕的，沒有這條分界。）
    // 掛在哪，就是「物理」與「內容」的分界線 —— effect 作用在整棵子樹上，沒辦法
    // 排除某個子孫，所以唯一的槓桿是**掛低一點**。
    //
    // 🐈 工作區預覽裡是桌布和視窗縮圖，那是內容不是介面（反相過的貓就是證據）。
    // 它剛好是總覽 controls 底下的獨立分支，所以列舉兄弟、跳過它就好。
    // 用物件比對而不是名字比對：名字會改，而改了之後名字比對會安靜地失效。
    // 掛在哪，就是「物理」與「內容」的分界線 —— effect 作用在整棵子樹上，沒辦法
    // 排除某個子孫。
    //
    // 🩸 試過「掛低一點」：不掛整個總覽、只掛 controls 的孩子、跳過工作區那一支。
    // 結果更糟 —— 總覽的深色底**不是** controls 的孩子，於是底沒反相、內容反相了，
    // app 名字又一次變成黑字黑底。⇒ **反相只有在底和內容一起反的時候才成立。**
    //
    // 🐈 正解用的是「反相是自身反元素」：整個總覽照常掛，然後在工作區那一支掛一個
    // **只反相、不量化**的子效果，父層再反一次就抵銷。貓因此不是負片。
    // ⚠️ 但它仍然會被量化 —— 量化不可逆，子效果救不回來。完全排除在這個架構下
    // 做不到，這是 shader 便宜的代價。
    _pnPosteriseActors() {
        const list = [];
        if (Main.panel)
            list.push(["panel", Main.panel]);
        if (Main.layoutManager?.modalDialogGroup)
            list.push(["modals", Main.layoutManager.modalDialogGroup]);
        if (Main.layoutManager?.overviewGroup)
            list.push(["overview", Main.layoutManager.overviewGroup]);
        // 翻頁箭頭走 addChrome，那是 overviewGroup **外面** —— 我們只想搬它的位置，
        // 卻順手把它搬出了量化器的射程，於是顏色變成我們得自己決定的事。掛回來。
        for (const [which, arrow] of Object.entries(this._pnArrows ?? {})) {
            if (arrow)
                list.push([`arrow:${which}`, arrow]);
        }
        // 候選字窗。同樣的故事第二次：它走 Main.layoutManager.addTopChrome()，
        // 落在 uiGroup 底下 —— 跟上面那組箭頭一樣在量化器射程之外。
        //
        // 差別是這一顆不是我們搬出去的，是上游本來就放在那裡，所以在輸入法進來
        // 之前沒有人會發現。它是原廠 Adwaita 深色：黑底、白字、選取那格是藍的，
        // 而藍色在這片面板上沒有對應的灰階 —— 抖動之後就是一格雜訊，剛好蓋在
        // 你要讀的那個候選字上。
        const candidates = IBusManager.getIBusManager()?._candidatePopup;
        if (candidates)
            list.push(["candidates", candidates]);
        return list;
    }

    // 內容分支：掛反向效果去抵銷父層的反相。用物件比對拿到它，不比對名字。
    _pnContentActors() {
        const controls = Main.overview?._overview?.controls;
        const wd = controls?._workspacesDisplay;
        return wd ? [["workspaces", wd]] : [];
    }

    // 拆的時候走全樹，不依賴上面那份清單 —— 清單會隨 GNOME 版本和狀態變動，
    // 而依清單拆會留下拆不掉的孤兒。
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
            // 走到一半失敗也要把已經拆掉的算進去
        }
        return n;
    }

    Posterise(levels, invert) {
        const NAME = "pn-posterise";
        const out = {levels, invert, attached: [], removed: [], errors: []};
        this._pnPosteriseClasses ??= new Map();
        const key = `${levels}${invert ? "i" : ""}`;

        if (levels > 1 && !this._pnPosteriseClasses.has(key)) {
            // 🔴 這些不是均分。均分的四階是 0/85/170/255，而正典是 0/51/170/255 ——
            // 維護者特別要求「不要線性」，沉在 #333 不在 #555。均分會把 #333 悄悄
            // 推成 #555，於是 CSS 裡寫的值和玻璃上出現的值對不起來。
            //
            // 加階有兩種，風險不同：
            //   填空隙（#777，第 7 階）—— 最大的洞在 #333→#aaa 之間（7 階），
            //     補進去之後間距變 3/4/3/5，兩個模式下都安全。
            //   加鄰居（#ddd，第 13 階）—— 貼著紙，給「弱強調」（淡邊框、細分隔）
            //     用。⚠️ 在黑白模式下 #fff 是實白、#ddd 是 13% 黑點，1px 的線會
            //     變成斷續的點。好不好看只有玻璃判得了。
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
            // cogl_color_out 是 premultiplied，要先解開再算亮度，最後乘回去。
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
        // 內容分支：只在有反相時才需要抵銷（沒反相就沒有東西要抵銷）
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
        // 🩸 第一版把這裡寫死成 [0,85,170,255]（等距四階）。後來調色盤改成不等距
        // 的 0/51/170/255，而檢查器沒跟著改，於是 #333 被報成違規 —— 梯級變了，
        // 尺沒變，量到的就是別的東西。真正的規則不是「哪四個值」，是**落在面板的
        // 16 階原生格子上**：0x11 = 17，所以格子剛好等於三位簡寫的灰 #000…#fff。
        // 寫得成 #NNN 就合規，寫不成就不合規。
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
        // Clutter.Color 的成員在不同版本間換過名字，兩種都認
        const rgba = c => c && [c.red ?? c.r, c.green ?? c.g, c.blue ?? c.b, c.alpha ?? c.a];

        const classify = (who, prop, c) => {
            const v = rgba(c);
            if (!v || v.some(x => x === undefined))
                return;
            const [r, g, b, a] = v;
            const key = `${who} {${prop}} rgba(${r},${g},${b},${a})`;
            if (a === 0)
                return;                      // 完全透明＝沒畫，不算違規
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
                return;                      // 看不見的不算
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
                    // 🩸 `get_background_gradient()` 在 GJS 裡永遠回傳一個陣列，
                    // 拿它當真假值用會把每個 StBin 都報成漸層（第一版就是這樣，
                    // 而 StBin 18 次那個數字就是指紋：容器不可能有漸層）。
                    // 要讀的是 type，NONE 才代表沒有。
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
        // 只留最常出現的，不然清單沒人看得完
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
        // childSize 是私有計算，但方法是普通方法（不是 vfunc），叫得動。
        // 它就是每個格子的邊長 —— 而且寬高共用同一個數字，格子必為正方形。
        const childSize = lm._getChildrenMaxSize
            ? lm._getChildrenMaxSize() : null;
        const spacing = childSize !== null && lm._calculateSpacing
            ? lm._calculateSpacing(childSize) : null;

        // 一個 tile 的最小寬/高各是多少 —— 決定 childSize 的就是這兩個的較大者
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
            // [左側留白, 上側留白, 實際水平間距, 實際垂直間距]
            computed: spacing,
            nPages: lm.nPages,
            // 資料夾內部是另一個 layout manager（FolderGrid），釘死的圖示尺寸
            // 不會套到它身上 —— 所以它的 iconSize 是獨立收斂的。
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
            // 第二輪要的：折行之後最高／最寬的 tile。畫布寬度得從這裡反推，
            // 因為 childSize 是「所有 tile 的最小尺寸取最大」，不是平均。
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
            // 每格還能長多少：把行數/欄數塞滿頁面的上限
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
            // 兩顆走同一段程式碼卻不同結果 —— 把它們的實際差異印出來
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
        // Main.overview.showApps() 一步到位：開 overview 並切到 app grid 那一頁，
        // 正好對應「頂列左上角 → dock 最右邊」那兩下。
        // showApps() 只保證打開 overview，不保證停在 app grid（實測會留在
        // window picker）。直接把狀態推到 APP_GRID，那是這個切換的真實依據。
        Main.overview.show();
        const controls = pnOverviewControls();
        if (controls) {
            controls._stateAdjustment.ease(PN_STATE_APP_GRID, {
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    // 拍某一頁的照片時要用。沒有它就只能靠滑動，而滑動是拍不準的：想量的東西
    // 在第幾頁是使用者排的，不是我排的。
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
