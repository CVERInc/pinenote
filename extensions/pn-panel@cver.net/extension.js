// PineNote panel — the three controls this tablet presses most, as single taps.
//
// Clear the ghosting, turn the screen, change the tone. All three were reachable
// before and all three were buried: the refresh behind a Pinenote Helper button,
// the rotation about ten items down a status indicator's menu, the tone behind a
// panel label reading `BW+D:1`. They call the interfaces themselves rather than
// borrowing the neighbour's buttons, which a package upgrade puts back where it
// found them:
//
//   refresh   org.pinenote.ebc on the *system* bus, from pinenote-dbus-service.
//             That extension is one caller of it; so are we.
//   rotation  org.gnome.Mutter.DisplayConfig, a standard Mutter API.
//   tone      org.pinenote.ebc again, with the mode remembered in Pinenote
//             Helper's gsetting, which is the thing that survives a login.
//
// This was carved out of pn-osk@cver.net, where it had been living next to a
// keyboard and a launcher it shares no state with. Nothing here reads that
// extension's config, and the install was conditional on the app grid being
// found — an accident of where the code sat rather than a dependency.
//
// The D-Bus interface is not a debugging leftover: this device is driven over
// SSH, and both buttons need a finger otherwise. Tone() and Rotate() go through
// the same functions a tap does, not a test-only path.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUILD = 1;

const IFACE = `<node>
  <interface name="org.cver.PnPanel">
    <method name="Rotate"/>
    <method name="Tone"/>
    <method name="Refresh"/>
    <method name="PanelInfo">
      <arg type="s" direction="out" name="info"/>
    </method>
  </interface>
</node>`;

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


export default class PineNotePanelExtension extends Extension {
    enable() {
        this._pnInstallPanel();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/cver/PnPanel');
        this._nameId = Gio.bus_own_name(
            Gio.BusType.SESSION, 'org.cver.PnPanel',
            Gio.BusNameOwnerFlags.NONE, null, null, null);
        console.log(`[pn-panel] enabled, build=${BUILD}`);
    }

    disable() {
        this._pnRemovePanel();
        this._dbus?.unexport();
        this._dbus = null;
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
    }

    // 跟 Rotate／Tone 同一個理由：效果只出現在玻璃上，而這台是從 SSH 開的。
    Refresh() {
        this._pnTriggerRefresh();
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

        // 六顆一致，不是 3+3。我們三顆已經收到底（見 stylesheet），剩下那道縫
        // 整個在鄰居身上：quickSettings 左緣到 Wi-Fi 中心是 24.5 邏輯像素，而
        // 一致所需的是 14.5。它沒有自己的 class 可以選，所以掛一個。
        //
        // 🔴 只往下收，永遠不給負值。2026-08-08 試過在自己按鈕上放
        // `margin-right: -10px`，St 不會忽略它也不會夾住它：負的配置寬度一路
        // 傳到 offscreen framebuffer，被當成無號整數變成 4294967232（0xFFFFFFC0
        // ＝ −64），g_error 中止整個 gnome-shell。見 upstream/。
        this._pnNeighbour = Main.panel.statusArea?.["quickSettings"];
        this._pnNeighbour?.add_style_class_name("pn-panel-neighbour");

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
        this._pnNeighbour?.remove_style_class_name("pn-panel-neighbour");
        this._pnNeighbour = null;
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
}
