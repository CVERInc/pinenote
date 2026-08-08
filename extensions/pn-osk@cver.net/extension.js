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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Keyboard} from 'resource:///org/gnome/shell/ui/keyboard.js';

const BUILD = 24;

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
    <method name="OpenFolder"/>
    <method name="RenameFolder"/>
    <method name="Rotate"/>
    <method name="Tone"/>
    <method name="PanelInfo">
      <arg type="s" direction="out" name="info"/>
    </method>
    <method name="GridInfo">
      <arg type="s" direction="out" name="info"/>
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

// ── 顯示色調 ────────────────────────────────────────────────────────────
// 驅動有四種 bw_mode，PineNote Helper 把四種都攤在一張選單上，並在面板放一個
// `BW+D:1` 的標籤。那是驅動的詞彙：D 是抖動、1 是波形編號。實際會用到的只有
// 兩種讀法 —— 文字要銳利而且不閃，照片要有階調 —— 所以這裡只留兩個，換法跟
// 旋轉一樣是一顆按鈕。
//
// 🔴 狀態的擁有者是 pnhelper 的 gsetting，不是驅動。pnhelper 在 enable 時會把
// 記住的值套回去，所以只改驅動的話下次登入就被蓋掉（2026-08-06 那次「開機後
// 波形被蓋回灰階」就是這個）。上游自己的選單也只寫這個 key，其餘交給它的
// changed 處理器 —— 走同一條路，一次切換就只有一次全域刷新。萬一沒人在聽，
// 下面的死線守衛會自己補上，而且會出聲。
const PN_TONE_SCHEMA = 'org.gnome.shell.extensions.pnhelper';
const PN_TONE_SCHEMA_DIR =
    '/usr/share/gnome-shell/extensions/pnhelper@m-weigand.github.com/schemas';

// bw_mode 0=灰階 1=BW+抖動 2=純 BW 3=DU4，各自配一個 partial 波形。我們只送
// 前兩個，但讀的時候要認得四種：這個值不只我們在寫。
const PN_TONE_GRAY = 0;
const PN_TONE_MONO = 1;
const PN_TONE_WAVEFORM = {[PN_TONE_GRAY]: 4 /* GC16 */, [PN_TONE_MONO]: 1 /* A2 */};

// 量到的順序：SetBwMode → BwModeChanged → SetDefaultWaveform → WaveformChanged
// 都在同一個主迴圈轉次裡走完，只有全域刷新排在 500ms 後。所以這不是取樣點，
// 是死線 —— 過了還沒動，就是沒有人在聽。
const PN_TONE_DEADLINE_MS = 400;
const PN_TONE_REFRESH_MS = 500;

// 頂列上藏起來的東西。理由寫在這裡而不是「見檔頭」—— 檔頭沒有這一段，那句
// 指標從第一天就指著不存在的東西。
const PN_HIDDEN_PANEL_ROLES = [
    // 無障礙圖示。它亮著是因為 screen-keyboard-enabled 為真，而這台沒有實體鍵
    // 盤：螢幕鍵盤是主要輸入裝置，不是輔助功能。設定留著，只是不再回報。
    "a11y",
    // `Q`／`N`：品質對效能模式。維護者不知道它做什麼，也從來沒按過；狀態在
    // gsettings 裡，按鈕消失不影響它。
    "PN Switch Performance Modes",
    // 他們的全域刷新鈕。不是移除，是被 pn-refresh 取代。
    "PN Trigger Global Refresh",
    // `BW+D:1`。連同它的選單一起收起來，換到的是 pn-tone 那顆兩態按鈕。
    //
    // ⚠️ 誠實記一筆：這一顆不只裝了那兩個模式。門檻滑桿、DU4、反相、波形清單、
    // 自動刷新、休眠清畫面、USB MTP —— 這些我們沒有取代，只是拿掉了它們的入口。
    // 當初那條「沒取代就別藏，那是替別人決定他不再需要」的原則，在這裡是維護者
    // 自己放行的（2026-08-08：「那個 BW+D1 我覺得可以拿掉了」）。全部仍可從
    // gsettings 與系統匯流排到達，README 有清單。
    "Pinenote Helper Indicator",
];

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
                const appHeight = height - searchHeight - spacing;
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
            this._pnInstallPanel();
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

    // 資料夾外框。'app-folder' 這個 style class 掛在整個 tile 上，所以在 CSS 裡
    // 畫框會連名字一起包住。真正該框的是那 2x2 預覽 —— 它是 createFolderIcon 生的
    // 裸 St.Widget，沒有 class，CSS 選不到；但它的容器 _iconBin 只有它那麼大
    // （x_align CENTER ⇒ 拿自然寬度），所以框畫在 bin 上就剛好。
    _pnStyleFolderIcons() {
        const appDisplay = pnOverviewControls()?._appDisplay;
        for (const item of appDisplay?._orderedItems ?? []) {
            if (!item.style_class?.includes("app-folder"))
                continue;
            const bin = item.icon?._iconBin;
            if (!bin || bin._pnStyled)
                continue;
            bin._pnStyled = true;
            // 🔴 不能用 border 或 padding：它們會長大，而 _getChildrenMaxSize 取
            // 所有 tile 的最大值 ⇒ 一顆資料夾的裝飾會把整個 grid 的格子撐大
            // （實測 128 -> 142，圖示 64 -> 48，垂直間距變成負的）。
            // inset box-shadow 不參與配置，GNOME 自己的 focus ring 就是這樣畫的。
            bin.set_style(
                "border: 1px solid #cccccc;" +
                "border-radius: 18px;");
        }
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

    // ── 頂列 ──────────────────────────────────────────────────────────
    // 這台上按得最兇的兩件事是「全域刷新」和「旋轉」，而旋轉原本埋在一個狀態
    // 顯示器的選單裡第十幾項。兩個都升成單獨一顆，而且是我們自己呼叫底層介面，
    // 不是借用別人的按鈕 —— 借用的話每次套件升級都會被放回原位。
    _pnMakePanelButton(name, icon, onActivate) {
        const button = new PanelMenu.Button(0.0, name, true);
        // 三顆要看起來是一組。原廠 .panel-button 的左右內距是為了滑鼠指標留的，
        // 三顆各留一份就把它們推得比右邊那組系統圖示還開 —— 而那組之所以緊，是
        // 因為它整組**只是一顆按鈕**。我們沒辦法照抄那個結構（三顆各要能單獨按），
        // 所以改成收內距。實際數字在 stylesheet，那裡 disable/enable 就重讀。
        button.add_style_class_name("pn-panel-button");
        // icon 可以是主題裡的名字，也可以是我們自己帶的檔案
        button._pnIcon = new St.Icon({
            ...(icon.startsWith("/")
                ? {gicon: Gio.icon_new_for_string(icon)}
                : {icon_name: icon}),
            style_class: "system-status-icon",
        });
        button.add_child(button._pnIcon);
        // 觸控要自己接：button-press-event 在純觸控上不一定會來。
        // （長按曾經做在這裡，三種寫法都沒開火，而那個功能在快速設定裡本來就有
        // 一個看得見的開關 —— 見 _pnInstallPanel 的註解。）
        button.connect("button-press-event", () => {
            onActivate();
            return Clutter.EVENT_STOP;
        });
        button.connect("touch-event", (a, event) => {
            if (event.type() === Clutter.EventType.TOUCH_END)
                onActivate();
            return Clutter.EVENT_STOP;
        });
        return button;
    }

    _pnTriggerRefresh() {
        // org.pinenote.ebc 在**系統**匯流排上，由 pinenote-dbus-service 提供 ——
        // 不是任何擴充的一部分，所以我們是平起平坐的呼叫者。
        Gio.DBus.system.call(
            "org.pinenote.ebc", "/ebc", "org.pinenote.ebc",
            "TriggerGlobalRefresh", null, null,
            Gio.DBusCallFlags.NONE, -1, null,
            (bus, res) => {
                try {
                    bus.call_finish(res);
                } catch (e) {
                    console.log(`[pn-osk] refresh failed: ${e.name}`);
                }
            });
    }

    _pnRotate() {
        // 🔴 一定要非同步。DisplayConfig 由 mutter 提供，而 mutter 就是這個行程 ——
        // call_sync 會讓主迴圈等一個只有主迴圈能生的回覆，畫面凍到逾時為止
        // （預設 25 秒，實測就是這樣：按一下卡一次，日誌事後才印出失敗）。
        if (this._pnRotating)
            return;
        this._pnRotating = true;

        const bus = Gio.DBus.session;
        const done = msg => {
            this._pnRotating = false;
            if (msg)
                console.log(`[pn-osk] rotate: ${msg}`);
        };

        bus.call(
            "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
            "org.gnome.Mutter.DisplayConfig", "GetCurrentState", null, null,
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                let state;
                try {
                    state = conn.call_finish(res);
                } catch (e) {
                    done(`GetCurrentState failed: ${e.message}`);
                    return;
                }

                const [serial, monitors, logicalMonitors] = state.deepUnpack();

                // 每個接頭現在用哪個 mode。ApplyMonitorsConfig 要 mode id，而
                // GetCurrentState 的 logical_monitors 只給接頭名字。
                const currentMode = new Map();
                for (const [spec, modes] of monitors) {
                    for (const mode of modes) {
                        if (mode[6]["is-current"]?.deepUnpack?.() === true)
                            currentMode.set(spec[0], mode[0]);
                    }
                }

                const out = [];
                for (const [x, y, scale, transform, primary, mons] of logicalMonitors) {
                    // 0=正常 1=左轉 2=倒置 3=右轉。只在直橫之間來回 ——
                    // 這塊面板只有兩種拿法。
                    const next = transform === 0 || transform === 2 ? 1 : 0;
                    const specs = [];
                    for (const m of mons) {
                        const mode = currentMode.get(m[0]);
                        if (mode === undefined) {
                            done(`no current mode for ${m[0]}`);
                            return;
                        }
                        specs.push([m[0], mode, {}]);
                    }
                    out.push([x, y, scale, next, primary, specs]);
                }

                bus.call(
                    "org.gnome.Mutter.DisplayConfig",
                    "/org/gnome/Mutter/DisplayConfig",
                    "org.gnome.Mutter.DisplayConfig", "ApplyMonitorsConfig",
                    new GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})",
                        [serial, 2 /* persistent */, out, {}]),
                    null, Gio.DBusCallFlags.NONE, -1, null,
                    (c2, r2) => {
                        try {
                            c2.call_finish(r2);
                            done(null);
                        } catch (e) {
                            done(`apply failed: ${e.message}`);
                        }
                    });
            });
    }

    // ── 色調：兩個模式，一顆按鈕 ─────────────────────────────────────
    _pnToneOpenSettings() {
        // pnhelper 的 schema 沒有註冊到系統路徑，要指名它自己的 schemas 目錄。
        // 找不到不是錯誤，是「pnhelper 不在」，下面的守衛會接手。
        try {
            const src = Gio.SettingsSchemaSource.new_from_directory(
                PN_TONE_SCHEMA_DIR, Gio.SettingsSchemaSource.get_default(), true);
            const schema = src.lookup(PN_TONE_SCHEMA, false);
            if (schema)
                return new Gio.Settings({settings_schema: schema});
        } catch (e) {
            console.log(`[pn-osk] tone: no pnhelper schema: ${e.message}`);
        }
        return null;
    }

    _pnToneRead(then) {
        Gio.DBus.system.call(
            "org.pinenote.ebc", "/ebc", "org.pinenote.ebc", "GetBwMode",
            null, new GLib.VariantType("(y)"),
            Gio.DBusCallFlags.NONE, -1, null,
            (bus, res) => {
                try {
                    then(bus.call_finish(res).deepUnpack()[0]);
                } catch (e) {
                    console.log(`[pn-osk] tone: GetBwMode failed: ${e.message}`);
                }
            });
    }

    _pnToneLater(ms, fn) {
        // 一次性計時器，但要收得回來：擴充停用之後才開火的 callback 會打進一個
        // 已經拆掉的物件裡。
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._pnToneTimers?.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._pnToneTimers?.add(id);
    }

    _pnToneApplyDirect(mode) {
        const call = (method, params, then) =>
            Gio.DBus.system.call(
                "org.pinenote.ebc", "/ebc", "org.pinenote.ebc", method,
                params, null, Gio.DBusCallFlags.NONE, -1, null,
                (bus, res) => {
                    try {
                        bus.call_finish(res);
                        then?.();
                    } catch (e) {
                        console.log(`[pn-osk] tone: ${method} failed: ${e.message}`);
                    }
                });
        // 順序不能反：先換模式再換波形，這樣驅動要做的 bw 轉換是在新模式底下做
        // 的。這條是照抄上游 _change_bw_mode 的註解，沒有自己重新推導。
        call("SetBwMode", new GLib.Variant("(y)", [mode]), () =>
            call("SetDefaultWaveform",
                new GLib.Variant("(y)", [PN_TONE_WAVEFORM[mode]]), () =>
                    this._pnToneLater(PN_TONE_REFRESH_MS,
                        () => this._pnTriggerRefresh())));
    }

    _pnToneSet(mode) {
        this._pnToneSettings?.set_uint("bw-mode", mode);
        // 守衛：pnhelper 可能沒裝、沒啟用，或哪天不再聽這個 key。到了死線還沒
        // 動就自己做，並且說一聲 —— 按了什麼都沒發生是這裡最糟的失敗形狀，而
        // 它跟「按了但我沒看出差別」在玻璃上長得一模一樣。
        this._pnToneLater(PN_TONE_DEADLINE_MS, () => this._pnToneRead(now => {
            if (now === mode)
                return;
            console.log(`[pn-osk] tone: bw-mode still ${now}, applying here`);
            this._pnToneApplyDirect(mode);
        }));
    }

    _pnToneToggle() {
        this._pnToneRead(now =>
            // 四種模式裡只有 0 是灰階，另外三種都是某種黑白。別人可能把它設成
            // 2 或 3，這顆按鈕對那些狀態也要答得出話。
            this._pnToneSet(now === PN_TONE_GRAY ? PN_TONE_MONO : PN_TONE_GRAY));
    }

    // 畫的是「按下去會變成什麼」，跟旋轉鈕同一個規矩，而且在這裡更站得住腳：
    // 現在是哪一種，玻璃上看得比任何圖示都清楚，按鈕不必再講一次。
    //
    // 圖示指的是「按下去會發生什麼」，不是「這顆叫什麼」。直向時按了會轉成橫向
    // ⇒ 畫順時針；橫向時反過來。一顆永遠長一樣的旋轉鈕只說得出「這裡可以轉」。
    _pnRotationLocked() {
        return this._pnTouchSettings?.get_boolean("orientation-lock") ?? true;
    }

    _pnSyncRotateIcon() {
        const icon = Main.panel.statusArea?.["pn-rotate"]?._pnIcon;
        const mon = Main.layoutManager.primaryMonitor;
        if (!icon || !mon)
            return;
        // 自動時畫「感測器在管」，鎖定時畫「按了會往這邊轉」。
        // 兩種狀態各自畫的都是接下來會發生的事，而不是這顆按鈕叫什麼。
        icon.icon_name = this._pnRotationLocked()
            ? (mon.height > mon.width
                ? "object-rotate-right-symbolic"
                : "object-rotate-left-symbolic")
            : "rotation-allowed-symbolic";
    }

    // 藏 container 而不是 actor：那是 panel 實際排版的那一層。
    _pnHidePanelItems() {
        for (const role of PN_HIDDEN_PANEL_ROLES) {
            const item = Main.panel.statusArea?.[role];
            if (item?.container?.visible) {
                item.container.hide();
                this._pnPanelHidden?.push(item);
            }
        }
    }

    _pnInstallPanel() {
        if (this._pnPanelButtons)
            return;
        this._pnPanelButtons = [];
        this._pnPanelHidden = [];
        this._pnToneTimers = new Set();

        this._pnHidePanelItems();
        // 🔴 藏一次不夠。pnhelper 停用再啟用 —— 套件升級就會做這件事，我自己
        // 測守衛的時候也做了 —— 會把它的按鈕重新加回來，而且是**全新的物件**，
        // 我們啟動時藏的那幾個已經不在了。症狀是頂列突然多出三顆，而擴充仍然
        // ACTIVE、日誌一個字都沒有。所以面板長出新東西的時候要再看一次。
        this._pnPanelAddSignals = [Main.panel._centerBox, Main.panel._rightBox]
            .filter(Boolean)
            .map(box => [box, box.connect("child-added",
                () => this._pnHidePanelItems())]);

        const add = (key, name, icon, fn) => {
            const b = this._pnMakePanelButton(name, icon, fn);
            Main.panel.addToStatusArea(key, b, 0, "right");
            this._pnPanelButtons.push(key);
        };
        this._pnTouchSettings = new Gio.Settings({
            schema_id: "org.gnome.settings-daemon.peripherals.touchscreen",
        });
        // 點一下是覆寫，所以要先鎖 —— 不鎖的話感測器下一秒就把它轉回去。
        // 回到自動走 GNOME 快速設定裡那顆 Auto Rotate（同一個 gsetting），
        // 它在偵測得到加速度計之後就會啟用，不必我們再做一個看不見的手勢。
        add("pn-rotate", "PN Rotate", "object-rotate-right-symbolic",
            () => {
                this._pnTouchSettings.set_boolean("orientation-lock", true);
                this._pnRotate();
            });
        add("pn-refresh", "PN Refresh",
            `${this.path}/icons/pn-screen-refresh-symbolic.svg`,
            () => this._pnTriggerRefresh());
        this._pnToneSettings = this._pnToneOpenSettings();
        // 🔑 只有一張圖，而且**故意**不跟旋轉鈕同一個規矩（那顆畫的是「按了會
        // 怎樣」）。這顆畫的是現況，因為現況是免費且誠實的：圖示裡面是真的灰，
        // 灰階模式下是平滑斜坡，黑白模式下驅動把它換算成網點 —— 同一張圖自己
        // 就變了，而且變成的正是這個模式對「灰」做的那件事。硬體當儀表，比我
        // 畫兩個狀態更準，也少一張圖。模式只有兩個，所以「按了會怎樣」＝另一個。
        add("pn-tone", "PN Tone", `${this.path}/icons/pn-tone.svg`,
            () => this._pnToneToggle());

        this._pnSyncRotateIcon();
        this._pnPanelMonitorSignal = Main.layoutManager.connect(
            "monitors-changed", () => this._pnSyncRotateIcon());
        // 快速設定裡也有同一個開關，從那邊改的時候圖示一樣要跟上
        this._pnLockSignal = this._pnTouchSettings.connect(
            "changed::orientation-lock", () => this._pnSyncRotateIcon());
    }

    _pnRemovePanel() {
        if (this._pnPanelMonitorSignal) {
            Main.layoutManager.disconnect(this._pnPanelMonitorSignal);
            this._pnPanelMonitorSignal = 0;
        }
        if (this._pnLockSignal && this._pnTouchSettings) {
            this._pnTouchSettings.disconnect(this._pnLockSignal);
            this._pnLockSignal = 0;
        }
        this._pnTouchSettings = null;
        for (const id of this._pnToneTimers ?? [])
            GLib.Source.remove(id);
        this._pnToneTimers = null;
        this._pnToneSettings = null;
        for (const [box, id] of this._pnPanelAddSignals ?? [])
            box.disconnect(id);
        this._pnPanelAddSignals = null;
        for (const key of this._pnPanelButtons ?? [])
            Main.panel.statusArea[key]?.destroy();
        this._pnPanelButtons = null;
        // 清單裡可能有好幾代：pnhelper 重新加過按鈕的話，先前那幾個已經被它
        // destroy 掉了，碰到會丟例外，而那會讓後面的還原整串跳過。
        for (const item of this._pnPanelHidden ?? []) {
            try {
                item.container?.show();
            } catch (e) {
                // 已經不在了，本來就不需要還原
            }
        }
        this._pnPanelHidden = null;
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
            this._pnStyleFolderIcons();
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
            ext._pnSyncFolderIconSize(dialog._view);
            ext._pnInstallTitleTap(dialog);
            ext._pnDialogs.add(dialog);
            dialog.connect("destroy", () => ext._pnDialogs.delete(dialog));
            // dialog._view 是 FolderView，_grid 是 FolderGrid（它自己的 layout
            // manager，跟外層 grid 無關，所以釘死的圖示尺寸不會套到這裡）
            ext._pnApplyWrapToView(dialog._view);
            // 原版的 handler 先接、先跑，所以我們讀到的 _displayingDialog 已經是新值
            dialog.connect('open-state-changed', (o, isOpen) => {
                ext._pnSyncArrowVisibility();
                // 項目是延遲建立的 —— 包裝當下跑一次會漏掉還沒生出來的那些
                if (isOpen) {
                    ext._pnSyncFolderIconSize(dialog._view);
                    ext._pnApplyWrapToView(dialog._view);
                }
            });
        };
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
        this._pnRemovePanel();
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

    PanelInfo() {
        const panel = Main.panel;
        // statusArea 是「名字 -> 物件」，反過來查才問得出畫面上這顆是誰
        const roles = new Map();
        for (const [role, obj] of Object.entries(panel.statusArea ?? {})) {
            if (obj)
                roles.set(obj, role);
        }

        const describe = actor => {
            // 每個 box 的孩子通常是容器，有身分的是裡面那顆 PanelMenu.Button
            const inner = actor.get_children?.()?.[0] ?? actor;
            const role = roles.get(actor) ?? roles.get(inner) ?? null;
            const labels = [];
            const collect = a => {
                if (!a)
                    return;
                if (a.text !== undefined && a.text !== null && a.text !== "")
                    labels.push(String(a.text));
                if (a.icon_name)
                    labels.push(`icon:${a.icon_name}`);
                for (const c of a.get_children?.() ?? [])
                    collect(c);
            };
            collect(actor);
            return {
                role,
                name: actor.name || inner.name || null,
                styleClass: actor.style_class || inner.style_class || null,
                visible: actor.visible,
                w: Math.round(actor.width),
                x: Math.round(actor.x),
                // 面板上看得到的字與圖示，用來對上畫面
                content: labels.slice(0, 6),
            };
        };

        const box = b => (b?.get_children() ?? []).map(describe);

        return JSON.stringify({
            panel: {w: Math.round(panel.width), h: Math.round(panel.height)},
            left: box(panel._leftBox),
            center: box(panel._centerBox),
            right: box(panel._rightBox),
            // 誰在 statusArea 裡但沒出現在三個 box 中（隱藏或被別人收走）
            statusAreaRoles: Object.keys(panel.statusArea ?? {}),
        }, null, 2);
    }

    Rotate() {
        this._pnRotate();
    }

    // 跟 Rotate 同一個理由：這兩顆的效果都只出現在玻璃上，而這台是從 SSH 開的。
    // 走這條跟真的按下去走的是同一個函式，不是另一條測試專用的路。
    Tone() {
        this._pnToneToggle();
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

    HideOverview() {
        Main.overview.hide();
    }


    Rebuild() {
        this._config = readConfig();
        this._rebuild();
    }
}
