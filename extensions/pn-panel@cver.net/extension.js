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
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as IBusManager from 'resource:///org/gnome/shell/misc/ibusManager.js';
import IBus from 'gi://IBus';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUILD = 2;

const IFACE = `<node>
  <interface name="org.cver.PnPanel">
    <method name="Rotate"/>
    <method name="Tone"/>
    <method name="Refresh"/>
    <method name="Input"/>
    <method name="InputFace">
      <arg type="s" direction="in" name="face"/>
    </method>
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
    // GNOME 自己的輸入源指示器。它在 48 上是**獨立的 statusArea 項目**（不是收在
    // quickSettings 裡，這點是用 PanelInfo dump 出來確認的，不是猜的），所以留著
    // 就會跟 pn-input 並排顯示同一件事。
    //
    // 這一顆藏得起來是因為我們真的取代了它：它的全部功能就是顯示現用輸入源、
    // 點開選一個，pn-input 兩件都做，而且是戳一下就換。上面那條「沒取代就別藏」
    // 的自省，在這裡不適用。
    "keyboard",
];

// ── 輸入源 ──────────────────────────────────────────────────────────────
// 一個版面三個引擎：拼音、羅馬字、英文吃的是同一組 26 個字母，所以 k6 不用改
// （pn-osk 的 us-extended fallback 會接住 layout=default 的 ibus 引擎）。代價是
// 「現在是哪個引擎」變成唯一會出錯的地方，而它原本只寫在一顆藏起來的指示器上。
//
// 🔑 這顆畫的是**現況**，跟 pn-tone 同一個規矩，不是 pn-rotate 那個「按了會
//    怎樣」。三個狀態沒有「另一個」可言，所以「按了會怎樣」根本沒辦法畫。
//
// 🔑 而且是字不是圖示。理由跟 pn-osk 那顆 caps lock 一樣：兩色、沒有動畫的
//    面板上，字是活得下來的訊號。三態畫成圖示等於逼自己記三張圖。
//
// 標籤三個都寫死，鍵是 source.id（xkb 源是版面代號，ibus 源是引擎名）。
//
// ⚠️ 這是用一個東西換來的：shortName 本來是**動態**的，mozc 會隨自己的內部模式
//    把它在あ／A 之間換，所以那顆按鈕原本順便會說「現在收的是假名還是英數」。
//    寫死成 JP 之後那個訊息沒了 —— 這是維護者要的（2026-08-17：「替我用
//    US/JP/TW 即可」），記在這裡是為了將來想找回它的人知道它曾經在。
//
// 三個都是兩個大寫拉丁字母，寬度幾乎一樣，所以下面 stylesheet 那個固定寬度
// 從「必要」降級成「保險」——但還是要留，JP 的 J 比 U 窄。
//
// 🔴 日文那一源是 mozc-on，不是 mozc-jp。ibus-mozc 宣告三個引擎：
//    mozc-jp（通用）、mozc-on（Mozc:あ，啟用即ひらがな）、mozc-off（Mozc:A_）。
//    掛 mozc-jp 的話它會停在直接入力，打羅馬字直接吐英文字母——看起來就像
//    「輸入法無效」，而 k6 版面沒有半角/全角鍵，切不出來。mozc-on 一啟用就是
//    假名。這也正好是 macOS 把「かな」和「英数」做成兩個輸入源的那個做法。
//    兩個名字都留在表裡：換回去的人不該連標籤一起掉。
//
// 下面兩個這台預設沒有掛進 sources，但標籤先備著 —— 這副鍵盤和這顆按鈕要能服務
// 其他 CJK 使用者，而「裝了引擎卻掉標籤」是最難查的那種半殘。兩個都吃 US 鍵位：
//   chewing  宣告 layout=us，自己把 US 鍵位映射成注音，所以 k6 不用動
//   hangul   宣告 layout=kr，但 _composeLayout 沒有 kr-extended 會退回
//            us-extended，而二式韓文本來就是用拉丁鍵位打出字母
// 注音不另外給標籤：拼音和注音都是台灣正體，都是 TW。第一版給過「ㄅ」（11px
// 粗體下兩畫是一撇，像壞掉）、再給過「BP」——都是把輸入法層的差別畫到語言層的
// 標籤上。分辨兩者的是鍵帽。見 PN_RIME_FACES 上面那三層。
const PN_INPUT_LABELS = {
    us: "US",
    "mozc-on": "JP",
    "mozc-jp": "JP",
    rime: "TW",
    chewing: "TW",   // 也是台灣正體；它是輸入法層的另一個選擇，不是另一種語言
    hangul: "KR",
};

// ── 一個 rime 源、兩張臉 ────────────────────────────────────────────────
// 三個層次，混用就會亂，所以先把線畫清楚：
//
//   語言層     US / JP / TW              ← 頂列標籤只到這一層
//   輸入法層   TW: pinyin / bopomofo     ← 「臉」。同一種語言的兩套音標
//              JP: romaji（將來 kana 就放這裡）
//   字母表層   pinyin、romaji 印拉丁；bopomofo 印注音；kana 印假名
//                                        ← 鍵帽。pn-osk 從臉推出來，不是另一個狀態
//
// 所以注音**不叫 BP**、頂列不顯示 BP：拼音和注音都是台灣正體，都是 TW。分辨兩者
// 的是鍵帽（一邊拉丁一邊注音），頂列不重複這個訊息。實體鍵盤時 OSK 收著看不到
// 鍵帽 —— 打一個鍵就知道了（拼音出字母、注音出符號），跟 macOS 一樣。
//
// RIME 的注音（bopomofo_tw）跟拼音（luna_pinyin_tw）是同一個 IBus 引擎裡的兩個
// **方案**，不是兩個源 —— IBus 不讓同一個引擎在 sources 裡出現兩次，ibus-rime
// 也只宣告一個引擎名。注音走 RIME 而不是 chewing，理由是維護者在玻璃上看到的
// 那件事：RIME 邊打邊出候選（跟拼音一模一樣、同一條列、同一套詞庫），chewing
// 要打完按空白才出。
//
// 所以 pn-input 的循環不是「源的清單」，是「臉的清單」：每張臉＝一個源＋可選的
// RIME 方案。US → JP → TW(pinyin) → TW(bopomofo)。
//
// 🔴 RIME 沒有「直接切到方案 X」的外部入口，只有 F4 選單。所以走選單，但要
//    確定性：switcher/fix_schema_list_order 讓選單順序固定（不 MRU），送 F4 →
//    讀候選列（我們的）找目標那格 → 送選字鍵高亮 → 送 space 確認。
//
// 🔴 臉由這裡記，不從引擎讀：RIME 不透過 IBus property 回報現用方案（實測
//    register-properties / update-property 一個都沒來）。「現在是拼音還是注音」
//    的真值是 pn-panel 上次成功切到的那個。重啟後 RIME 記得上次的方案而我們
//    不記得 —— 所以 enable 時把預設臉設成待送，第一次 focus-in 就對齊。
// key 是 ime.sh 在 default.custom.yaml 裡綁的直達鍵：
//   key_binder/bindings: {when: always, accept: F7, select: luna_pinyin_tw} …
// librime 的 select 動作直接切方案 —— 不開選單。F7/F8 挑的是 k6 版面上不存在
// 的鍵，人按不到，只有我們合成得出來。
const PN_RIME_FACES = {
    pinyin:   {schema: "luna_pinyin_tw", key: "F7"},
    bopomofo: {schema: "bopomofo_tw",    key: "F8"},
};
// rime 源在循環裡展開成這幾張臉，順序就是戳的順序。
const PN_RIME_FACE_ORDER = ["pinyin", "bopomofo"];

// ~/.config/pn-panel.json。跟 pn-osk.json 同一個模式：不存在＝全部預設。
// 現在只有一個鍵：
//   buttons: { "input": true, "tone": true, "refresh": true, "rotate": true }
// 關掉的按鈕不建立（不是建了再藏）—— 藏起來的東西還在 statusArea 裡占名字，
// 而且 _pnHidePanelItems 那條守衛會為它多跑一輪。不要的東西就不要生出來。
// 由 setup/pn 讀寫；改完要 disable/enable 擴充（或 restart gdm3）才生效。
function readPanelConfig() {
    try {
        const path = GLib.build_filenamev([GLib.get_user_config_dir(), "pn-panel.json"]);
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return {};
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        return {};
    }
}

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

    Input() {
        this._pnInputCycle();
    }

    // 直接跳到某張臉（US / JP / TW / BP / …）。pn ime face 用它；也是從 SSH
    // 驗證 rime 換方案這條路的唯一方法 —— 循環要戳好幾下才到，而且中間會經過
    // 別的源。
    // name 是臉的名字（pinyin / bopomofo / romaji…）或語言層的名字（US / JP / TW）。
    // 語言層名對到那個源的第一張臉。
    InputFace(name) {
        const faces = this._pnInputFaces();
        const target = faces.find(f => f.face === name) ??
            faces.find(f => (PN_INPUT_LABELS[f.source.id] ?? f.source.shortName) === name);
        if (!target) {
            console.log(`[pn-panel] InputFace: no face named "${name}"`);
            return;
        }
        this._pnActivateFace(target);
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
        this._pnBindTaps(button, onActivate);
        return button;
    }

    // 同一顆按鈕，內容是字不是圖示。給 pn-input 用 —— 三個輸入源沒辦法用三張
    // 圖示說清楚，理由寫在 PN_INPUT_LABELS 上面。
    _pnMakeTextButton(name, text, onActivate) {
        const button = new PanelMenu.Button(0.0, name, true);
        button.add_style_class_name("pn-panel-button");
        button.add_style_class_name("pn-panel-input");
        button._pnLabel = new St.Label({
            text,
            style_class: "pn-panel-input-label",
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.add_child(button._pnLabel);
        this._pnBindTaps(button, onActivate);
        return button;
    }

    // 觸控要自己接：button-press-event 在純觸控上不一定會來。
    // （長按曾經做在這裡，三種寫法都沒開火，而那個功能在快速設定裡本來就有
    // 一個看得見的開關 —— 見 _pnInstallPanel 的註解。）
    _pnBindTaps(button, onActivate) {
        button.connect("button-press-event", () => {
            onActivate();
            return Clutter.EVENT_STOP;
        });
        button.connect("touch-event", (a, event) => {
            if (event.type() === Clutter.EventType.TOUCH_END)
                onActivate();
            return Clutter.EVENT_STOP;
        });
    }

    // ── 輸入源循環 ────────────────────────────────────────────────────
    // 🔴 照 sources 清單的順序走，**不要**借 GNOME 的 switch-input-source
    //    keybinding。那個是 MRU 循環：三個源、一顆按鈕的話，你會在最近用過的
    //    兩個之間彈來彈去，第三個永遠戳不到。清單順序讓 US → 拼 → あ → US 是
    //    一個可以背起來的圈。
    //
    // inputSources 是稀疏的 {index: source}，索引不保證連續（GNOME 會跳過
    // 建不起來的源），所以先取鍵再排，不要假設 0..n-1。
    // 循環裡的每一張臉：{source, face}。rime 源展開成 PN_RIME_FACE_ORDER，
    // 其他源一張臉。
    _pnInputFaces() {
        const ism = Keyboard.getInputSourceManager();
        const sources = Object.keys(ism.inputSources)
            .map(Number)
            .sort((a, b) => a - b)
            .map(i => ism.inputSources[i]);
        const faces = [];
        for (const src of sources) {
            if (src.type === "ibus" && src.id === "rime")
                for (const face of PN_RIME_FACE_ORDER)
                    faces.push({source: src, face});
            else
                faces.push({source: src, face: null});
        }
        return faces;
    }


    // 鍵帽歸 pn-osk 畫，臉歸我們記。推過去，非同步，它不在也無所謂。
    _pnPushFaceToOsk(face) {
        Gio.DBus.session.call(
            "org.cver.PnOsk", "/org/cver/PnOsk", "org.cver.PnOsk",
            "SetInputFace", new GLib.Variant("(s)", [face ?? ""]), null,
            Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                try {
                    bus.call_finish(res);
                } catch (e) {
                    // pn-osk 沒裝或沒起來，鍵帽就維持拉丁，不是錯誤
                }
            });
    }

    _pnInputCycle() {
        const faces = this._pnInputFaces();
        if (faces.length < 2) {
            // 只有一張臉的時候這顆按鈕沒有意義，但它仍然在頂列上占著位子 ——
            // 說出來，不要讓一次沒反應的戳看起來像壞掉。
            console.log("[pn-panel] input: only one face, nothing to cycle");
            return;
        }
        const ism = Keyboard.getInputSourceManager();
        const cur = ism.currentSource;
        // 現在在哪張臉：同一個源裡，rime 用記住的 face；找不到就當第一張。
        const curFace = this._pnRimeFace ?? PN_RIME_FACE_ORDER[0];
        let at = faces.findIndex(f =>
            f.source.index === cur?.index && (f.face === null || f.face === curFace));
        if (at < 0)
            at = faces.findIndex(f => f.source.index === cur?.index);
        const next = faces[(at + 1) % faces.length];
        this._pnActivateFace(next);
    }

    _pnActivateFace({source, face}) {
        const ism = Keyboard.getInputSourceManager();
        const switching = source.index !== ism.currentSource?.index;
        if (switching)
            source.activate(true);
        if (!face)
            this._pnPushFaceToOsk(null);
        if (face) {
            // 標籤先變 —— 這是使用者剛剛按下去的意圖，頂列要立刻回應。
            this._pnRimeFace = face;
            this._pnPushFaceToOsk(face);
            // 🔴 方案切換是「懶」的：記下待送，能送就送，不能就等下一次焦點。
            //    RIME 只在有輸入焦點時處理鍵 —— 沒有輸入框在聽的時候（例如在
            //    overview 戳頂列），送 F4 什麼都不會發生（實測選單沒進候選列，
            //    n=0）。這跟我們從外部 context 送鍵推不動 shell 是同一堵牆，
            //    只是這次從裡面撞。所以 Main.inputMethod 的 focus_in 被接住了
            //    （見 _pnInstallRimeFocusHook）：下一個輸入框拿到焦點那一刻，
            //    有待送的方案就送。RIME 切過一次會自己記住，之後不必再送。
            this._pnRimePending = face;
            const delay = switching ? 400 : 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._pnRimeFlushPending();
                return GLib.SOURCE_REMOVE;
            });
        }
        this._pnSyncInputLabel();
    }

    // 有焦點就送、沒焦點就留著。
    _pnRimeFlushPending() {
        const face = this._pnRimePending;
        if (!face)
            return;
        // 🔴 守門看 currentFocus 不是 _context：context 建一次就一直在，拿它守門
        //    等於不守 —— 在 overview 戳臉時鍵會送進虛空、RIME 沒切、pending 卻被
        //    清掉。currentFocus 是 shell 端「現在有沒有輸入框在收字」的真值。
        const im = Main.inputMethod;
        if (!im?.currentFocus || !im?._context)
            return;   // 留著，focus-in 時再來
        this._pnRimeSelectSchema(face);
    }

    _pnInstallRimeFocusHook() {
        // 🔴 接 IBusManager 的 focus-in，不要覆寫 Main.inputMethod.vfunc_focus_in。
        //    GObject 的 vfunc 是從原型派發的，覆寫實例屬性 C 端根本不會呼叫 ——
        //    第一版就是這樣寫的，一個 log 都沒印，看起來像「使用者還沒打字」。
        //    IBusManager 的 focus-in 來自 IBus panel service，是引擎真正開始
        //    收鍵的那一刻，比 shell 那邊的焦點更準。
        const ibm = IBusManager.getIBusManager();
        if (!ibm || this._pnRimeFocusId)
            return;
        const tryLater = () => {
            if (!this._pnRimePending)
                return;
            // 引擎在 focus-in 之後才 attach；給它一拍。
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._pnRimeFlushPending();
                return GLib.SOURCE_REMOVE;
            });
        };
        this._pnRimeFocusId = ibm.connect("focus-in", tryLater);
        // 🔴 只接 focus-in。曾經也接候選列收起（等 1 秒安靜再切），那條拆了：
        //    「使用者停了沒」猜不準 —— 1 秒的窗口跟他下一個字撞。現在的做法是
        //    戳臉當下若在打字就先幫他 Enter 再切（見 _pnRimeSelectSchema），
        //    不需要等任何時刻。
    }

    _pnRemoveRimeFocusHook() {
        if (this._pnRimeFocusId) {
            IBusManager.getIBusManager()?.disconnect(this._pnRimeFocusId);
            this._pnRimeFocusId = 0;
        }
    }

    // 對 RIME 說「換到 face 那個方案」：送一個直達鍵（見 PN_RIME_FACES）。
    //
    // 🔴 這裡曾經是一台機器：F4 開選單 → 遮住候選列 → 讀每格文字找目標 → 讀游標
    //    → Down/Up 走過去 → space 確認 → 600ms 後讀回來驗證 → 失敗重試。每一步
    //    都是一個 race，修一個冒一個（選單開在使用者輸入底下、space 太快、驗證
    //    太早、Return 無限迴圈…）。key_binder 的 select 動作把這一切變成一個
    //    同步的鍵 —— 探針實測 F7/F8 兩個方向都直達，沒有任何可見的中間狀態。
    //    如果將來壞了，先查 default.custom.yaml 的 key_binder/bindings 有沒有
    //    活過 RIME 重編（rime_deployer 那個 last_build_time 陷阱，見 ime.sh）。
    _pnRimeSelectSchema(face) {
        const target = PN_RIME_FACES[face];
        if (!target)
            return;
        const im = Main.inputMethod;
        const send = keyval => {
            const ctx = im?._context;
            if (!ctx)
                return false;
            // 簽名照 inputMethod.js 的 vfunc_filter_key_event：
            //   (keyval, keycode, state, timeout, cancellable, callback)
            ctx.process_key_event_async(keyval, 0, 0, -1, null, null);
            ctx.process_key_event_async(keyval, 0, IBus.ModifierType.RELEASE_MASK, -1, null, null);
            return true;
        };

        const finish = () => {
            if (!send(IBus[`KEY_${target.key}`])) {
                console.log(`[pn-panel] rime: no IM context for ${target.key}, keeping pending`);
                return;
            }
            this._pnRimePending = null;
            this._pnRimeFace = face;
            this._pnSyncInputLabel();
            console.log(`[pn-panel] rime: → ${target.schema} via ${target.key}`);
        };

        // 使用者在打字（終端裡那串底線字）就先幫他送出再切 —— 戳臉＝「我要換
        // 了」，把手上那段送出是他要的；直接送 F8 會把組字**默默丟掉**（探針：
        // 沒有 COMMIT 事件，下一鍵直接是新方案），那是掉字。
        //
        // 🔴 送出之後**不驗證、不遞迴**，等一拍直接切。驗證那版死過兩次：
        //    200ms 內 preedit 沒清（SoC 上往返比這慢、或使用者緊接著又打）→
        //    判 stale → pending 掛起 → 使用者一直在終端裡，focus-in 永遠不來
        //    → 「怎麼戳都無法打開」。而遞迴那版每分鐘灌 169 個 Enter。
        //    Return＋切換鍵都送給同一個 context，到得了就都到得了；上面
        //    currentFocus 守門保證這時真的有輸入框在收。
        const clientPre = im?._preeditStr ?? "";
        if (clientPre && !clientPre.includes("方案選單")) {
            console.log(`[pn-panel] rime: committing user's composition (${JSON.stringify(clientPre)}) then switching`);
            send(IBus.KEY_Return);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                finish();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        finish();
    }

    // Caps 的目的地：拉丁那一源。找 type === 'xkb' 而不是寫死 'us'，因為版面
    // 代號是設定裡的值，換一天改成 dvorak 這裡不該跟著壞。
    //
    // 已經在 US 的時候往回跳到剛才那個源 —— 這是 macOS 的行為，而維護者的日文
    // 是羅馬字、keymap 也選了 Kotoeri，整台的手感本來就往那邊靠。只寫單向
    // （JP/TW → US）的話，Caps 會變成一個有去無回的鍵。
    _pnInputGoLatin() {
        const ism = Keyboard.getInputSourceManager();
        const sources = Object.keys(ism.inputSources)
            .map(Number)
            .sort((a, b) => a - b)
            .map(i => ism.inputSources[i]);
        const latin = sources.find(s => s.type === "xkb");
        if (!latin) {
            console.log("[pn-panel] input: no xkb source to fall back to");
            return;
        }
        const cur = ism.currentSource;
        if (cur?.index !== latin.index) {
            this._pnInputLast = cur?.index ?? null;
            latin.activate(true);
        } else if (this._pnInputLast != null) {
            ism.inputSources[this._pnInputLast]?.activate(true);
        }
    }

    // 實體鍵盤的兩個鍵。
    //
    // 🔴 用 setCustomKeybindingHandler 挾持 GNOME 既有的兩個 keybinding，而不是
    //    addKeybinding 自己開一個 —— 後者要求擴充自帶 GSettings schema，等於為了
    //    兩個鍵多一個 schemas/ 目錄和一次 glib-compile-schemas。挾持不用。
    //
    // 🔴 switch-input-source 的預設行為是 MRU 循環，這正是我們要換掉的：三個源
    //    一個鍵，MRU 會讓第三個永遠輪不到。挾持之後它走的是跟面板按鈕同一個
    //    _pnInputCycle，清單順序，US → TW → JP → US。
    //
    // ⚠️ switch-input-source-backward 被拿去做「回到 US」，名字對不上實際行為。
    //    這是刻意的取捨：它是一個現成的、已經有 accel 欄位的綁定槽，借它比自帶
    //    schema 便宜。accel 本身由 setup/ime.sh 寫（Ctrl+Space 和 Menu），這裡
    //    只負責行為 —— 跟 pn-tone 把狀態留在 pnhelper 的 gsetting 是同一種分工。
    _pnInstallKeybindings() {
        Main.wm.setCustomKeybindingHandler("switch-input-source",
            Shell.ActionMode.ALL, () => this._pnInputCycle());
        Main.wm.setCustomKeybindingHandler("switch-input-source-backward",
            Shell.ActionMode.ALL, () => this._pnInputGoLatin());
    }

    _pnRemoveKeybindings() {
        // 還原就是把處理器指回 InputSourceManager 自己那一個。它是私有方法，
        // 但這是唯一誠實的還原 —— shell 沒有把原處理器暴露出來，而留著我們的
        // 處理器不還原，停用擴充之後 Ctrl+Space 會靜靜地什麼都不做。
        const ism = Keyboard.getInputSourceManager();
        const orig = ism._switchInputSource?.bind(ism);
        if (!orig) {
            console.warn("[pn-panel] cannot restore input-source keybindings: " +
                "InputSourceManager._switchInputSource is gone");
            return;
        }
        Main.wm.setCustomKeybindingHandler("switch-input-source",
            Shell.ActionMode.ALL, orig);
        Main.wm.setCustomKeybindingHandler("switch-input-source-backward",
            Shell.ActionMode.ALL, orig);
    }

    // Ctrl+Space 會叫出 GNOME 的輸入源切換 OSD（InputSourceSwitcher），而它畫的
    // 是 source.shortName —— 也就是 en／朙／あ，跟頂列那顆講的是同一件事卻用不同
    // 的詞。把 shortName 也換成同一組標籤，兩邊才是同一個東西。
    //
    // 安全的原因：shortName 只在 InputSource 建構時設一次（由引擎的 symbol 來），
    // 之後 IBus 的 property 更新走的是 source.properties，不會回頭蓋它。所以設
    // 一次就穩，不需要盯著每個 source 的 changed。
    // setter 會 emit 'changed'，所以要用相等就跳過來擋掉回授。
    _pnApplyShortNames() {
        const ism = Keyboard.getInputSourceManager();
        for (const source of Object.values(ism.inputSources)) {
            const label = PN_INPUT_LABELS[source.id];
            if (label && source.shortName !== label)
                source.shortName = label;
        }
    }

    _pnSyncInputLabel() {
        const label = Main.panel.statusArea?.["pn-input"]?._pnLabel;
        if (!label)
            return;
        const source = Keyboard.getInputSourceManager().currentSource;
        // 標籤只到語言層：rime 源不管哪張臉都是 TW（見 PN_RIME_FACES 上面那段）。
        // id 先於 shortName：覆寫表存在的理由就是 shortName 有時沒有用。
        label.text = PN_INPUT_LABELS[source?.id] ?? source?.shortName ?? "—";
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

        this._pnConfig = readPanelConfig();
        const wanted = key => this._pnConfig.buttons?.[key.replace(/^pn-/, "")] !== false;
        const add = (key, name, icon, fn) => {
            if (!wanted(key))
                return;
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

        // 第四顆。文字版，見 PN_INPUT_LABELS 上面那段。
        if (wanted("pn-input")) {
            const input = this._pnMakeTextButton("PN Input", "—",
                () => this._pnInputCycle());
            Main.panel.addToStatusArea("pn-input", input, 0, "right");
            this._pnPanelButtons.push("pn-input");
        }
        // 輸入源也可能從別處被換掉（快速設定、應用程式自己切、Super+Space），
        // 不接這個訊號的話標籤會說謊 —— 跟 _pnSyncRotateIcon 接 monitors-changed
        // 是同一個理由。sources-changed 也要接：清單本身變了（例如剛裝好引擎、
        // 或改了 gsettings）之後，currentSource 會換成別的物件。
        const ism = Keyboard.getInputSourceManager();
        this._pnInputSignals = [
            ism.connect("current-source-changed", () => this._pnSyncInputLabel()),
            // 🔴 sources-changed 要順手再藏一次 GNOME 那顆。它自己會依源的數量
            //    決定要不要現身（一個源的時候收起來，兩個以上跳出來），而
            //    PanelMenu.Button 把自己的 visible 綁到 container 上 —— 也就是
            //    我們 hide 的那個。上面那條 child-added 守衛擋不住這種情形：
            //    面板沒有長出新東西，是舊東西自己把自己打開。
            ism.connect("sources-changed", () => {
                this._pnApplyShortNames();
                this._pnSyncInputLabel();
                this._pnHidePanelItems();
            }),
        ];
        // 🔴 這裡一定要跑一次，不能只靠 sources-changed。擴充是在 shell 起來之後
        //    才 enable 的，那時候輸入源早就建好了，那個訊號不會再為我們發一次。
        //    少了這一行的症狀很安靜：頂列那顆是對的（它查 PN_INPUT_LABELS），
        //    只有 Ctrl+Space 的 OSD 還講 en／㞢／あ。
        this._pnApplyShortNames();
        this._pnSyncInputLabel();
        this._pnInstallKeybindings();
        this._pnInstallRimeFocusHook();
        // 🔴 啟動對齊。RIME 記得上次的方案（user.yaml），我們不記得 —— 重啟後
        //    標籤說 TW 而 RIME 可能在注音（實測就是這樣）。與其讓使用者戳一下
        //    才對回來，啟動時就把「標籤說的那張臉」設成待送，第一次 focus-in
        //    RIME 就會被拉回來。標籤是真值，RIME 跟標籤走，不是反過來 ——
        //    因為 RIME 不回報方案，反過來根本做不到。
        const cur = ism.currentSource;
        if (cur?.type === "ibus" && cur.id === "rime")
            this._pnRimePending = this._pnRimeFace ?? PN_RIME_FACE_ORDER[0];

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
        this._pnRemoveKeybindings();
        this._pnRemoveRimeFocusHook();
        for (const id of this._pnInputSignals ?? [])
            Keyboard.getInputSourceManager().disconnect(id);
        this._pnInputSignals = null;
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
            // 輸入源的實際值。pn-input 的標籤查的是 PN_INPUT_LABELS，而 Ctrl+Space
            // 那個切換 OSD 畫的是 source.shortName —— 兩個不同的來源說同一件事，
            // 所以「面板對了但 OSD 沒對」是查得出來的，前提是這裡看得到 shortName。
            inputSources: Object.values(
                Keyboard.getInputSourceManager()?.inputSources ?? {})
                .map(s => ({
                    index: s.index,
                    type: s.type,
                    id: s.id,
                    shortName: s.shortName,
                })),
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
