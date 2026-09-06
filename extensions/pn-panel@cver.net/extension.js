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

const BUILD = 8;

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

// ── Display tone ────────────────────────────────────────────────────────
// The driver has four bw_modes. PineNote Helper lists all four on one menu
// and puts a `BW+D:1` label on the panel. That is the driver's vocabulary:
// D for dither, 1 for waveform index. We only actually need two — text needs
// to be sharp and not flash, photos need halftones — so only two are kept
// here, cycled by a single button just like rotation.
//
// 🔴 The owner of the state is pnhelper's gsetting, not the driver. pnhelper
// reapplies the remembered value on enable, so writing only to the driver
// gets overwritten on next login (this was the 'waveform reset to grayscale
// on boot' seen on 2026-08-06). Upstream's own menu also only writes this
// key, leaving the rest to its changed handler — sharing the same path,
// so one switch triggers exactly one global refresh. If nobody is listening,
// the deadline guard below will supply one, and it will complain.
const PN_TONE_SCHEMA = 'org.gnome.shell.extensions.pnhelper';
const PN_TONE_SCHEMA_DIR =
    '/usr/share/gnome-shell/extensions/pnhelper@m-weigand.github.com/schemas';

// bw_mode 0=grayscale 1=BW+dither 2=pure BW 3=DU4, each paired with a
// partial waveform. We only send the first two, but must recognise all four
// when reading: we are not the only ones writing this value.
const PN_TONE_GRAY = 0;
const PN_TONE_MONO = 1;
const PN_TONE_WAVEFORM = {[PN_TONE_GRAY]: 4 /* GC16 */, [PN_TONE_MONO]: 1 /* A2 */};

// 🔴 2026-09-06: the panel had been sitting in 5 Hz "quality" mode
// (dclk_select 0) the whole time, live and unremarked. Measured with the
// owner's pen: 80 Hz + GC16 draws fast but the strokes come out broken —
// GC16 is a 450 ms pulse train, damage rects during writing arrive every
// 12 ms, it cannot keep up. 80 Hz + mono (bw_mode 1, waveform 1/A2) draws
// fast *and* solid. 5 Hz + GC16 is right for reading. So the tone this
// button already picks is also the thing that decides whether 80 Hz is
// usable — mono implies performance, grey implies quality, no third
// combination is offered.
//
// This does NOT call SetDclkSelect or spawn mode_switcher.js. pnhelper's
// PerformanceModeButton owns dclk_select and the Mutter mode change
// (extension.js ~207-300 in pnhelper@m-weigand.github.com): it watches its
// own gsetting `quality-mode` (false = performance) and does the D-Bus call
// and the mode switch itself, one owner, one code path, same reason bw-mode
// above is written through pnhelper's gsetting rather than the driver
// directly. We only flip the switch it is already watching. Set this to
// false to decouple tone from mode again.
const PN_TONE_SETS_MODE = true;
const PN_TONE_MODE_KEY = "quality-mode";

// Measured order: SetBwMode → BwModeChanged → SetDefaultWaveform →
// WaveformChanged. All complete within the same main loop turn, only the
// global refresh is scheduled 500ms out. So this is a deadline, not a
// sampling point — if it has not moved by then, nobody is listening.
const PN_TONE_DEADLINE_MS = 400;
const PN_TONE_REFRESH_MS = 500;

// Things hidden on the top bar. The reasoning lives here instead of in a
// 'see top of file' comment — the top of the file lacked that section, and
// the pointer had pointed at nothing since day one.
const PN_HIDDEN_PANEL_ROLES = [
    // Accessibility icon. It is lit because screen-keyboard-enabled is true,
    // and this tablet has no physical keyboard: the on-screen keyboard is the
    // primary input device, not an accessibility feature. The setting stays,
    // it simply stops reporting.
    "a11y",
    // `Q` / `N`: Quality vs Performance mode. The maintainer does not know
    // what it does and has never pressed it; the state lives in gsettings, so
    // hiding the button does not affect it.
    "PN Switch Performance Modes",
    // Their global refresh button. Not removed, superseded by pn-refresh.
    "PN Trigger Global Refresh",
    // `BW+D:1`. Hidden along with its menu, replaced by the two-state
    // pn-tone button.
    //
    // ⚠️ An honest ledger: this button contained more than those two modes.
    // Threshold slider, DU4, invert, waveform list, auto refresh, suspend
    // clear, USB MTP — we did not replace these, we only removed their
    // entrance. The principle 'do not hide what you have not replaced, that
    // is deciding what someone else no longer needs' was waived here by the
    // maintainer themselves (2026-08-08: 'I think that BW+D1 can be removed').
    // All remain reachable via gsettings and the system bus; the README
    // has a list.
    "Pinenote Helper Indicator",
    // GNOME's own input source indicator. On 48 it is a **standalone
    // statusArea item** (not folded into quickSettings, confirmed by dumping
    // PanelInfo, not guessed), so keeping it would display the same thing
    // alongside pn-input.
    //
    // This button can be hidden because we actually superseded it: its entire
    // function is to show the active input source and open to select one.
    // pn-input does both, changing on tap. The introspection above about 'do
    // not hide what you have not replaced' does not apply here.
    "keyboard",
];

// ── Input sources ─────────────────────────────────────────────────────────
// One layout, three engines: pinyin, romaji, and English consume the same 26
// letters, so k6 does not need changing (pn-osk's us-extended fallback
// catches ibus engines with layout=default). The cost is that 'which engine
// is active' becomes the only thing that can go wrong, and that was
// originally written on an indicator that is now hidden.
//
// 🔑 This button draws the **current state**, same rule as pn-tone, not
//    pn-rotate's 'what happens if pressed'. Three states have no 'the other
//    one', so 'what happens if pressed' cannot be drawn at all.
//
// 🔑 And it uses text, not icons. Same reason as pn-osk's caps lock: on a
//    two-colour panel with no animation, text is the signal that survives.
//    Drawing three states as icons means forcing oneself to memorise three
//    images.
//
// The labels are all hardcoded, keyed by source.id (the layout code for xkb
// sources, the engine name for ibus sources).
//
// ⚠️ This was traded for one thing: shortName used to be **dynamic**, mozc
//    would toggle it between あ / A according to its internal mode, so that
//    button originally also reported 'receiving kana or latin'. Hardcoding it
//    to JP lost that message — this was requested by the maintainer
//    (2026-08-17: 'just use US/JP/TW for me'), noted here so anyone wanting
//    it back knows it was there.
//
// All three are two uppercase latin letters of almost identical width, so the
// fixed width in the stylesheet below degrades from 'required' to 'insurance'
// — but must be kept, JP's J is narrower than U.
//
// 🔴 The Japanese source is mozc-on, not mozc-jp. ibus-mozc declares three
//    engines: mozc-jp (generic), mozc-on (Mozc:あ, hiragana on activation),
//    mozc-off (Mozc:A_). Hooking up mozc-jp leaves it in direct-input mode,
//    typing romaji outputs latin letters — looking exactly like a broken
//    input method, and the k6 layout has no hankaku/zenkaku key to escape it.
//    mozc-on is kana from the start. This is exactly macOS's approach of
//    making 'かな' and '英数' two input sources.
//    Both names are kept in the table: anyone switching back should not lose
//    the label too.
//
// The bottom two are not in this device's default sources, but labels are
// provided — this keyboard and button must serve other CJK users, and
// 'engine installed but missing label' is the hardest failure to trace. Both
// use US keys:
//   chewing  declares layout=us, mapping US keys to bopomofo itself, so k6
//            is untouched
//   hangul   declares layout=kr, but _composeLayout lacks kr-extended and
//            falls back to us-extended, and 2-set hangul uses latin keys to
//            type letters anyway
// Bopomofo gets no separate label: pinyin and bopomofo are both Traditional
// Chinese, both are TW. The first version gave it 'ㄅ' (at 11px bold, two
// strokes read as a smudge, looking broken), then 'BP' — both were drawing
// an input-method difference onto a language-layer label. What distinguishes
// the two is the key caps. See the three layers above PN_RIME_FACES.
const PN_INPUT_LABELS = {
    us: "US",
    "mozc-on": "JP",
    "mozc-jp": "JP",
    rime: "TW",
    chewing: "TW",   // Also Traditional Taiwan; it is another input method choice, not another language
    hangul: "KR",
};

// ── One rime source, two faces ────────────────────────────────────────────
// Three layers; mixing them creates chaos, so draw the lines first:
//
//   Language layer       US / JP / TW              ← Top bar label stops here
//   Input method layer   TW: pinyin / bopomofo     ← 'Face'. Two phonetic systems for one language
//                        JP: romaji (kana will go here)
//   Alphabet layer       pinyin, romaji print latin; bopomofo prints bopomofo; kana prints kana
//                                                  ← Key caps. pn-osk derives this from the face, it is not another state
//
// So bopomofo is **not called BP**, and the top bar does not show BP: pinyin
// and bopomofo are both Traditional Chinese, both are TW. What distinguishes
// them is the key caps (latin vs bopomofo), the top bar does not repeat this
// message. When the OSK is hidden under a physical keyboard, there are no
// caps to see — typing one key tells you (pinyin gives letters, bopomofo
// gives symbols), just like macOS.
//
// RIME's bopomofo (bopomofo_tw) and pinyin (luna_pinyin_tw) are two
// **schemas** within the same IBus engine, not two sources — IBus refuses
// duplicate engines in sources, and ibus-rime only declares one engine name.
// Bopomofo routes through RIME rather than chewing because of what the
// maintainer saw on the glass: RIME emits candidates while typing (exactly
// like pinyin, same strip, same dictionary), whereas chewing requires a
// space after typing to emit them.
//
// So pn-input's cycle is a 'list of faces', not a 'list of sources': every
// face = one source + optional RIME schema.
// US → JP → TW(pinyin) → TW(bopomofo).
//
// 🔴 RIME lacks an external entry point for 'switch directly to schema X',
//    only the F4 menu. So the menu route is taken, but determinism is
//    required: switcher/fix_schema_list_order fixes the menu order (not
//    MRU), send F4 → read the candidate strip (ours) for the target cell →
//    send the selection key to highlight → send space to commit.
//
// 🔴 The face is remembered here, not read from the engine: RIME does not
//    report the active schema via IBus properties (measured: neither
//    register-properties nor update-property fired). The ground truth for
//    'pinyin or bopomofo' is whatever pn-panel successfully switched to
//    last. After reboot RIME remembers its schema while we do not — so on
//    enable the default face is queued as pending, aligning on the first
//    focus-in.
// key is the direct shortcut bound by ime.sh in default.custom.yaml:
//   key_binder/bindings: {when: always, accept: F7, select: luna_pinyin_tw} …
// librime's select action switches schemas directly — opening no menu. F7/F8
// were chosen because they are absent from the k6 layout, unpressable by a
// human, synthesised only by us.
const PN_RIME_FACES = {
    pinyin:   {schema: "luna_pinyin_tw", key: "F7"},
    bopomofo: {schema: "bopomofo_tw",    key: "F8"},
};
// The rime source expands into these faces in the cycle, order is tap order.
const PN_RIME_FACE_ORDER = ["pinyin", "bopomofo"];

// ── The language you are typing in is the language you are speaking ────────
// The panel already knows: PN_INPUT_LABELS resolves an input source down to a
// language, and stops there on purpose. Speech wants exactly that layer, so it
// borrows it rather than building a second answer to the same question -- two
// tables mapping input sources to languages would disagree eventually, and the
// disagreement would show up as a sentence transcribed in the wrong language.
//
// 🔴 This chooses the PROMPT, not whisper's language. Forcing a language the
//    audio is not in does not sharpen it, it makes it translate: an English
//    sentence forced to zh came back as fluent Chinese that nobody said, and
//    nothing on screen suggested a rewrite had happened. Detection got every
//    case right in testing, and when detection is wrong it is visibly wrong.
//    So whisper detects the language; the input source only says which prompt
//    to put in front of it.
const PN_VOICE_LANGS = {
    US: "en",
    JP: "ja",
    TW: "zh",
    KR: "ko",
};

// ~/.config/pn-panel.json. Same pattern as pn-osk.json: missing = all defaults.
// Only one key currently:
//   buttons: { "input": true, "tone": true, "refresh": true, "rotate": true }
// Disabled buttons are not built (not built then hidden) — hidden items
// still occupy names in statusArea, and the _pnHidePanelItems guard would
// run an extra loop for them. Unwanted things should simply not be born.
// Read/written by setup/pn; requires extension disable/enable (or restart gdm3) to apply.
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

// ── Rotation: resyncing after unlock ────────────────────────────────────
// net.hadess.SensorProxy's AccelerometerOrientation, mapped onto the same
// transform values _pnRotate already uses (0=normal 1=left 2=inverted
// 3=right). Matches mutter's own mapping (meta-orientation-manager.c,
// meta_orientation_to_transform): normal→NORMAL, left-up→90 ("left"),
// bottom-up→180 ("inverted"), right-up→270 ("right"). Confirmed live via
// `gdbus call --system --dest net.hadess.SensorProxy … GetAll` — the
// property is readable without Claim*, which is the only part polkit gates
// over ssh.
//
// This device's accelerometer only reports all four values because of two
// things this repository itself installs (setup.sh step [14]): the
// iio-sensor-proxy package, and setup/udev/61-sensor-pinenote.rules, which
// overrides a udev hwdb entry that otherwise mislabels this chip's mount
// matrix as the PineTab2's and collapses the four orientations to two.
const PN_ORIENTATION_TRANSFORM = {
    "normal": 0,
    "left-up": 1,
    "bottom-up": 2,
    "right-up": 3,
};

// ── Touch chords: undo/redo, delivered system-wide ──────────────────────
// `grep -A8 touch /proc/bus/input/devices` on the device names the panel
// cyttsp5, ABS_MT_SLOT 0..31 — a 32-slot protocol, which is not the same
// claim as 32-way real multitouch. Measured with evtest and libinput
// debug-events straight off /dev/input/event5 (docs/panel.md carries the
// lines): the panel only ever resolves **two** concurrent contacts. A third
// finger either steals one of the two slots mid-gesture or is never
// reported at all — every three-finger attempt topped out at peak=2 at the
// kernel, at libinput, and in this file, in that order, so it is not
// Mutter's or libinput's doing to fix. Hence two fingers for both undo and
// redo, told apart by hold time instead of by count.
//
// On Wayland the compositor never turns a bare finger into
// button-press-event (the same fact _pnBindTaps above works around for our
// own buttons); pure touch only ever arrives as Clutter's TOUCH_* types, so
// the chord has to be read at that level or not at all.
//
// gestures: {undo: "tap", redo: "hold", fingers: 2, holdMs: 500, trace}
// in pn-panel.json. fingers is the one concurrent count both gestures
// require (peak === fingers, nothing else); undo/redo say which duration
// class each fires on — "tap" (under GESTURE_MAX_DURATION), "hold" (at
// least holdMs), or false/omitted to disable that side. The gap between
// the two (300–500ms here) fires nothing on purpose: a hold that arrived a
// little early is closer to "still deciding" than to either gesture, and
// guessing which one it meant is how a real tap starts a wrong redo.
const GESTURE_DEFAULTS = {undo: 'tap', redo: 'hold', fingers: 2, holdMs: 500};

// Tuned against an actual hand, not a spec. A tap lands each finger a few
// milliseconds apart and lets none of them sit perfectly still, so the
// thresholds are slack enough to survive that and tight enough that a
// pinch — which drifts far more and on a different axis per finger — is
// never mistaken for either gesture.
const GESTURE_MAX_DRIFT = 24;      // px any one contact may wander
const GESTURE_MAX_DURATION = 300;  // ms, first finger down to last finger up: below this is a tap
const GESTURE_MAX_LEAD = 120;      // ms one finger may sit alone before the rest land
const GESTURE_STALE_MS = 1000;     // a group that never saw every finger lift is abandoned

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
        this._pnInstallGestures();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/cver/PnPanel');
        this._nameId = Gio.bus_own_name(
            Gio.BusType.SESSION, 'org.cver.PnPanel',
            Gio.BusNameOwnerFlags.NONE, null, null, null);
        console.log(`[pn-panel] enabled, build=${BUILD}`);
    }

    disable() {
        this._pnRemoveGestures();
        this._pnRemovePanel();
        this._dbus?.unexport();
        this._dbus = null;
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
    }

    // Same reason as Rotate/Tone: the effect only appears on the glass, and this machine is driven over SSH.
    Refresh() {
        this._pnTriggerRefresh();
    }

    Input() {
        this._pnInputCycle();
    }

    // Jump directly to a face (US / JP / TW / BP / …). Used by pn ime face;
    // also the only way to verify RIME schema switching over SSH — the cycle
    // takes multiple taps to reach, traversing other sources on the way.
    // name is the face's name (pinyin / bopomofo / romaji…) or the language
    // layer's name (US / JP / TW). Language layer names map to that source's
    // first face.
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

    // ── Top bar ─────────────────────────────────────────────────────────────
    // The two most heavily pressed things here are 'global refresh' and
    // 'rotate', and rotate was originally buried a dozen items deep in a
    // status indicator's menu. Both are elevated to standalone buttons, calling
    // underlying interfaces ourselves, rather than borrowing someone else's
    // button — borrowing means being returned to the original spot every
    // package upgrade.
    _pnMakePanelButton(name, icon, onActivate) {
        const button = new PanelMenu.Button(0.0, name, true);
        // The three must read as a group. The stock .panel-button left/right
        // padding is reserved for the mouse pointer, leaving a copy on all
        // three pushes them further apart than the system indicators group on
        // the right — and that group is tight only because the entire group is
        // **a single button**. We cannot copy that structure (all three must be
        // pressable individually), so the padding is reduced. The actual numbers
        // are in the stylesheet, reread on disable/enable.
        button.add_style_class_name("pn-panel-button");
        // icon can be a name in the theme, or a file we ship ourselves
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

    // The same button, but containing text instead of an icon. Used for
    // pn-input — three input sources cannot be articulated with three icons,
    // reason noted above PN_INPUT_LABELS.
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

    // Touch must be connected ourselves: button-press-event is not guaranteed
    // to arrive on pure touch.
    // (Long-press used to live here, three implementations failed to fire,
    // and the functionality already had a visible toggle in quick settings —
    // see the note in _pnInstallPanel.)
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

    // ── Voice input ─────────────────────────────────────────────────────────
    // Tap to start, tap again to stop. Deliberately not press-and-hold: holding
    // a panel button down while speaking means pinning a 10" slab with one
    // thumb, and long-press on this touchscreen has already lost three
    // implementations to the shell's own gestures (see the note in
    // _pnBindTaps).
    //
    // 🔴 commit() only lands where Main.inputMethod.currentFocus is live. That
    //    is the same wall _pnRimeFlushPending is built around: with no input
    //    box listening, the shell accepts the call and nothing happens, with no
    //    error. Losing a schema switch that way is an annoyance; losing a
    //    spoken sentence is the tool's worst failure, because the person
    //    watched it record and got nothing and no reason. So a transcript that
    //    cannot land is held, and flushed on the next focus-in, exactly as a
    //    pending RIME schema is.
    //
    // 🔴 Stop the recorder with SIGINT, never SIGKILL. arecord finalises the
    //    WAV header on interrupt; killed outright it leaves a file whose header
    //    still claims a length it never wrote, and whisper reads whatever that
    //    implies.
    _pnVoicePath(name) {
        const configured = this._pnConfig?.voice?.dir;
        const dir = configured ||
            GLib.build_filenamev([GLib.get_home_dir(), "pinenote", "setup", "mic"]);
        return GLib.build_filenamev([dir, name]);
    }

    // The label is the ground truth here too, for the same reason it is for
    // RIME: it is what the person can see. Unknown source falls back to the
    // Chinese prompt, which is what "auto" selects -- not knowing is not the
    // same as knowing it is not Chinese.
    _pnVoicePromptLang() {
        const source = Keyboard.getInputSourceManager().currentSource;
        const label = PN_INPUT_LABELS[source?.id];
        return PN_VOICE_LANGS[label] ?? "auto";
    }

    _pnVoiceToggle() {
        if (this._pnVoiceState === "recording") {
            this._pnVoiceStop();
            return;
        }
        if (this._pnVoiceState === "working")
            return;   // transcribing; a second tap has nothing to do
        this._pnVoiceStart();
    }

    _pnVoiceStart() {
        const script = this._pnVoicePath("transcribe");
        if (!GLib.file_test(script, GLib.FileTest.IS_EXECUTABLE)) {
            console.error(`pn-panel: no transcribe at ${script} — set voice.dir `
                        + `in pn-panel.json to the repository's setup/mic`);
            return;
        }
        this._pnVoiceWav = "/tmp/pn-voice.wav";
        try {
            this._pnVoiceProc = Gio.Subprocess.new(
                ["arecord", "-D", "plughw:PineNote,1", "-c", "4", "-r", "16000",
                 "-f", "S16_LE", this._pnVoiceWav],
                Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.error(`pn-panel: could not start arecord: ${e}`);
            return;
        }
        // Whether the button steals the text field's focus is the question this
        // whole design turns on, so record the answer rather than trusting it.
        const im = Main.inputMethod;
        console.log(`pn-panel: voice recording, prompt=${this._pnVoicePromptLang()}, `
                  + `currentFocus=${!!im?.currentFocus}`);
        this._pnVoiceState = "recording";
        this._pnVoiceSyncIcon();
    }

    _pnVoiceStop() {
        const proc = this._pnVoiceProc;
        this._pnVoiceProc = null;
        this._pnVoiceState = "working";
        this._pnVoiceSyncIcon();
        if (proc) {
            proc.send_signal(2);   // SIGINT: let arecord close the file properly
            proc.wait_async(null, () => this._pnVoiceTranscribe());
        } else {
            this._pnVoiceTranscribe();
        }
    }

    _pnVoiceTranscribe() {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [this._pnVoicePath("transcribe"), this._pnVoiceWav, this._pnVoicePromptLang()],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.error(`pn-panel: could not start transcribe: ${e}`);
            this._pnVoiceState = "idle";
            this._pnVoiceSyncIcon();
            return;
        }
        proc.communicate_utf8_async(null, null, (o, res) => {
            let text = "";
            try {
                const [, out] = o.communicate_utf8_finish(res);
                text = (out ?? "").trim();
            } catch (e) {
                console.error(`pn-panel: transcribe failed: ${e}`);
            }
            this._pnVoiceState = "idle";
            this._pnVoiceSyncIcon();
            if (text)
                this._pnVoiceDeliver(text);
        });
    }

    _pnVoiceDeliver(text) {
        const im = Main.inputMethod;
        if (im?.currentFocus) {
            im.commit(text);
            return;
        }
        // Nowhere to put it yet. Hold rather than drop; see the note above.
        console.log("pn-panel: voice held, no input focus");
        this._pnVoicePending = this._pnVoicePending
            ? `${this._pnVoicePending} ${text}` : text;
    }

    _pnVoiceFlushPending() {
        const text = this._pnVoicePending;
        if (!text)
            return;
        const im = Main.inputMethod;
        if (!im?.currentFocus)
            return;   // keep holding
        this._pnVoicePending = null;
        im.commit(text);
    }

    _pnVoiceSyncIcon() {
        const icon = Main.panel.statusArea?.["pn-voice"]?._pnIcon;
        if (!icon)
            return;
        // Three states, three redraws for a whole dictation, and none of them
        // animated. An indicator that pulses would undo the one advantage
        // speech has on this panel: nothing needs to redraw while you talk.
        const name = this._pnVoiceState === "recording" ? "media-record-symbolic"
                   : this._pnVoiceState === "working" ? "content-loading-symbolic"
                   : "audio-input-microphone-symbolic";
        icon.icon_name = name;
    }

    // ── Input source cycle ──────────────────────────────────────────────────
    // 🔴 Walk the sources list in order, **do not** borrow GNOME's
    //    switch-input-source keybinding. That is an MRU cycle: with three
    //    sources and one button, you bounce between the two most recently used
    //    and the third is unreachable. List order makes US → pinyin → kana → US
    //    a cycle that can be memorised.
    //
    // inputSources is a sparse {index: source}, indices are not guaranteed to
    // be contiguous (GNOME skips sources it cannot build), so extract keys
    // before sorting, do not assume 0..n-1.
    // Every face in the cycle: {source, face}. The rime source expands to
    // PN_RIME_FACE_ORDER, other sources are one face.
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


    // Key caps are drawn by pn-osk, the face is tracked by us. Push it over, asynchronous, missing it is fine.
    _pnPushFaceToOsk(face) {
        Gio.DBus.session.call(
            "org.cver.PnOsk", "/org/cver/PnOsk", "org.cver.PnOsk",
            "SetInputFace", new GLib.Variant("(s)", [face ?? ""]), null,
            Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                try {
                    bus.call_finish(res);
                } catch (e) {
                    // pn-osk missing or down, caps remain latin, not an error
                }
            });
    }

    _pnInputCycle() {
        const faces = this._pnInputFaces();
        if (faces.length < 2) {
            // This button is meaningless when there is only one face, but it
            // still occupies space on the top bar — speak up, do not let an
            // unresponsive tap look broken.
            console.log("[pn-panel] input: only one face, nothing to cycle");
            return;
        }
        const ism = Keyboard.getInputSourceManager();
        const cur = ism.currentSource;
        // Where are we now: within the same source, rime uses the remembered face; fallback to the first face.
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
            // 🔴 Labels and caps **do not change here** — they change in
            //    _pnRimeSelectSchema's finish(), which is after the switch key
            //    is actually sent. The first version changed the caps to
            //    bopomofo immediately here, while F8 had to wait for the
            //    focus-in / dispatch delay to reach the engine: in those few
            //    hundred milliseconds the user typed on bopomofo caps while
            //    the engine was still in pinyin, outputting romaji (real
            //    machine: 'sometimes it emits romaji'). Caps follow the engine,
            //    not the intent — delayed but honest.
            // 🔴 Schema switching is 'lazy': queue as pending, send if possible,
            //    wait for the next focus otherwise. RIME only processes keys
            //    while an input box is listening — sending F4 while no input
            //    box listens (like tapping the top bar in overview) does
            //    nothing (measured: menu did not enter candidate strip, n=0).
            //    This is the same wall as our external context key sends failing
            //    to drive the shell, just hit from the inside. So
            //    Main.inputMethod's focus_in is intercepted (see
            //    _pnInstallRimeFocusHook): the moment the next input box gets
            //    focus, the pending schema is sent. RIME remembers its own
            //    switches, no need to send again.
            this._pnRimePending = face;
            const delay = switching ? 400 : 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._pnRimeFlushPending();
                return GLib.SOURCE_REMOVE;
            });
        }
        this._pnSyncInputLabel();
    }

    // Send if focused, hold otherwise.
    _pnRimeFlushPending() {
        const face = this._pnRimePending;
        if (!face)
            return;
        // 🔴 Guard on currentFocus, not _context: context is created once and
        //    persists, guarding on it is no guard — tapping a face in the
        //    overview sends the key into the void, RIME does not switch, and
        //    pending is cleared. currentFocus is the shell's ground truth for
        //    'is an input box actively receiving text'.
        const im = Main.inputMethod;
        if (!im?.currentFocus || !im?._context)
            return;   // Keep, revisit on focus-in
        this._pnRimeSelectSchema(face);
    }

    _pnInstallRimeFocusHook() {
        // 🔴 Connect to IBusManager's focus-in, do not override
        //    Main.inputMethod.vfunc_focus_in. GObject vfuncs are dispatched
        //    from the prototype, overriding the instance property is never
        //    called from C — the first version did this, logged absolutely
        //    nothing, and looked like 'user has not typed yet'. IBusManager's
        //    focus-in comes from the IBus panel service, the exact moment the
        //    engine begins receiving keys, more precise than the shell's focus.
        const ibm = IBusManager.getIBusManager();
        if (!ibm || this._pnRimeFocusId)
            return;
        const tryLater = () => {
            // A held transcript waits on the same event for the same reason.
            this._pnVoiceFlushPending();
            if (!this._pnRimePending)
                return;
            // The engine attaches after focus-in; give it a beat.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._pnRimeFlushPending();
                return GLib.SOURCE_REMOVE;
            });
        };
        this._pnRimeFocusId = ibm.connect("focus-in", tryLater);
        // 🔴 Hook focus-in only. Used to also hook candidate window closed
        //    (wait 1s of silence before switching); that was dismantled: 'has
        //    the user stopped' cannot be guessed accurately — a 1s window
        //    collides with their next word. The current approach is to hit
        //    Enter for them if they are typing when tapping the face (see
        //    _pnRimeSelectSchema), requiring no timing.
    }

    _pnRemoveRimeFocusHook() {
        if (this._pnRimeFocusId) {
            IBusManager.getIBusManager()?.disconnect(this._pnRimeFocusId);
            this._pnRimeFocusId = 0;
        }
    }

    // Tell RIME to 'switch to face's schema': send a direct shortcut (see
    // PN_RIME_FACES).
    //
    // 🔴 This used to be a machine: F4 opens menu → occlude candidate strip →
    //    read cells for target → read cursor → walk with Down/Up → space to
    //    commit → read back 600ms later to verify → retry if failed. Every
    //    step was a race, fixing one exposed another (menu opening under user
    //    input, space too fast, verification too early, Return infinite
    //    loop…). key_binder's select action turns all this into a single
    //    synchronous key — probed on real hardware, F7/F8 direct switch in
    //    both directions, zero visible intermediate states.
    //    If it ever breaks, first check if default.custom.yaml's
    //    key_binder/bindings survived a RIME rebuild (the rime_deployer
    //    last_build_time trap, see ime.sh).
    _pnRimeSelectSchema(face) {
        const target = PN_RIME_FACES[face];
        if (!target)
            return;
        const im = Main.inputMethod;
        const send = keyval => {
            const ctx = im?._context;
            if (!ctx)
                return false;
            // Signature follows inputMethod.js's vfunc_filter_key_event:
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
            this._pnPushFaceToOsk(face);
            this._pnSyncInputLabel();
            console.log(`[pn-panel] rime: → ${target.schema} via ${target.key}`);
        };

        // If the user is typing (the underlined text in the terminal), commit
        // it for them before switching — tapping the face means 'I want to
        // switch', submitting the current composition is what they want;
        // sending F8 directly discards the composition **silently** (probe:
        // zero COMMIT events, the very next key is the new schema), which is
        // data loss.
        //
        // 🔴 Do **not verify, do not recurse** after submitting, just switch
        //    after a beat. The verifying version died twice: preedit uncleared
        //    within 200ms (SoC roundtrip is slower, or user typed again
        //    immediately) → judged stale → pending suspended → user remains in
        //    terminal, focus-in never arrives → 'tapping does nothing'. The
        //    recursive version pumped 169 Enters a minute. Return and the
        //    switch key both go to the same context; if one reaches it, both
        //    do; the currentFocus guard above guarantees a listening box.
        // 🔴 hasPreedit() is not _preeditStr: hide-preedit-text clears visible
        //    only, not the string (read by inputMethod.js), the residual makes
        //    'already submitted' misjudged as 'still typing' — every previous
        //    'preedit still stale after Return' case was exactly this.
        const clientPre = im?.hasPreedit?.() ? (im._preeditStr ?? "") : "";
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

    // Caps' destination: the latin source. Look for type === 'xkb' instead of
    // hardcoding 'us', because the layout code comes from settings, and
    // changing to dvorak tomorrow should not break this.
    //
    // If already on US, jump back to the previous source — this is macOS's
    // behaviour, and the maintainer's Japanese is romaji, the keymap is
    // Kotoeri, the machine's feel is already aligned that way. Writing it
    // one-way (JP/TW → US) would make Caps a one-way trip.
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

    // The two physical keyboard keys.
    //
    // 🔴 Use setCustomKeybindingHandler to hijack GNOME's two existing
    //    keybindings, rather than addKeybinding to open our own — the latter
    //    requires the extension to ship a GSettings schema, meaning a schemas/
    //    directory and glib-compile-schemas just for two keys. Hijacking
    //    avoids this.
    //
    // 🔴 switch-input-source's default is an MRU cycle, which is exactly what
    //    we want to remove: three sources, one key, MRU ensures the third is
    //    never reached. Hijacking it routes it through the same _pnInputCycle
    //    as the panel button, in list order, US → TW → JP → US.
    //
    // ⚠️ switch-input-source-backward is used for 'return to US', the name does
    //    not match the behaviour. This is a deliberate trade-off: it is an
    //    existing, bindable slot with an accel field, cheaper to borrow than
    //    shipping our own schema. The accel itself is written by setup/ime.sh
    //    (Ctrl+Space and Menu), this only provides the behaviour — the same
    //    division of labour as pn-tone leaving its state in pnhelper's
    //    gsetting.
    _pnInstallKeybindings() {
        Main.wm.setCustomKeybindingHandler("switch-input-source",
            Shell.ActionMode.ALL, () => this._pnInputCycle());
        Main.wm.setCustomKeybindingHandler("switch-input-source-backward",
            Shell.ActionMode.ALL, () => this._pnInputGoLatin());
    }

    _pnRemoveKeybindings() {
        // Restoration means pointing the handler back to InputSourceManager's
        // own. It is a private method, but it is the only honest restoration —
        // the shell does not expose the original handler, and leaving ours
        // un-restored means Ctrl+Space fails silently after disabling the
        // extension.
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

    // Ctrl+Space summons GNOME's input source switching OSD
    // (InputSourceSwitcher), which draws source.shortName — i.e. en/朙/あ,
    // talking about the same thing as the top bar button but using different
    // words. Replacing shortName with the same label set unifies the two.
    //
    // Safety: shortName is only set once during InputSource construction (from
    // the engine's symbol), subsequent IBus property updates route through
    // source.properties and do not overwrite it. So setting it once is
    // durable, no need to watch every source's changed signal.
    // The setter emits 'changed', use equality to short-circuit the feedback loop.
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
        // Labels stop at the language layer: the rime source is TW for all
        // faces (see the block above PN_RIME_FACES).
        // id precedes shortName: the override table exists precisely because
        // shortName is sometimes useless.
        label.text = PN_INPUT_LABELS[source?.id] ?? source?.shortName ?? "—";
    }

    _pnTriggerRefresh() {
        // org.pinenote.ebc is on the **system** bus, provided by
        // pinenote-dbus-service — not part of any extension, so we are a peer
        // caller.
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

    // targetTransform, when given, is applied directly instead of bouncing
    // portrait/landscape — the sensor resync path (_pnApplySensorOrientation)
    // uses this to land on the orientation the accelerometer actually
    // reports. cancellable lets that same caller abort an in-flight call on
    // extension teardown, which a bare tap or the D-Bus Rotate() method never
    // need to.
    _pnRotate(targetTransform, cancellable = null) {
        // 🔴 Must be asynchronous. DisplayConfig is provided by mutter, and
        //    mutter is this process — call_sync blocks the main loop waiting
        //    for a reply that only the main loop can produce, freezing the
        //    screen until timeout (default 25s, verified: one tap froze once,
        //    logs showed the failure after the fact).
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
            Gio.DBusCallFlags.NONE, -1, cancellable,
            (conn, res) => {
                let state;
                try {
                    state = conn.call_finish(res);
                } catch (e) {
                    // Teardown cancelled us mid-flight — not a failure, say nothing.
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        this._pnRotating = false;
                        return;
                    }
                    done(`GetCurrentState failed: ${e.message}`);
                    return;
                }

                const [serial, monitors, logicalMonitors] = state.deepUnpack();

                // Which mode each connector is currently using.
                // ApplyMonitorsConfig needs the mode id, while
                // GetCurrentState's logical_monitors only provides the
                // connector name.
                const currentMode = new Map();
                for (const [spec, modes] of monitors) {
                    for (const mode of modes) {
                        if (mode[6]["is-current"]?.deepUnpack?.() === true)
                            currentMode.set(spec[0], mode[0]);
                    }
                }

                const out = [];
                let changed = false;
                for (const [x, y, scale, transform, primary, mons] of logicalMonitors) {
                    // 0=normal 1=left 2=inverted 3=right. A bare tap only
                    // bounces between portrait and landscape — this panel
                    // only has two ways to be held. A sensor resync instead
                    // passes targetTransform: the orientation the
                    // accelerometer actually reports, which may be any of
                    // the four.
                    const next = targetTransform !== undefined
                        ? targetTransform
                        : (transform === 0 || transform === 2 ? 1 : 0);
                    if (next !== transform)
                        changed = true;
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

                // A sensor resync landing on the transform already in effect
                // has nothing to apply — skip the round trip rather than
                // reconfigure the display for a visible no-op.
                if (targetTransform !== undefined && !changed) {
                    done(null);
                    return;
                }

                bus.call(
                    "org.gnome.Mutter.DisplayConfig",
                    "/org/gnome/Mutter/DisplayConfig",
                    "org.gnome.Mutter.DisplayConfig", "ApplyMonitorsConfig",
                    new GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})",
                        [serial, 2 /* persistent */, out, {}]),
                    null, Gio.DBusCallFlags.NONE, -1, cancellable,
                    (c2, r2) => {
                        try {
                            c2.call_finish(r2);
                            done(null);
                        } catch (e) {
                            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                                this._pnRotating = false;
                                return;
                            }
                            done(`apply failed: ${e.message}`);
                        }
                    });
            });
    }

    // Unlocking orientation-lock does not, by itself, restore rotation:
    // mutter reacts to the sensor's orientation *change* signals, not its
    // resting value, so the screen sits at whatever transform was persisted
    // until the tablet is physically tilted through a fresh transition. This
    // reads the sensor's current value once and applies it directly, so
    // clearing the lock takes effect immediately. Called only from the
    // orientation-lock changed handler, on the true→false edge.
    _pnApplySensorOrientation() {
        Gio.DBus.system.call(
            "net.hadess.SensorProxy", "/net/hadess/SensorProxy",
            "org.freedesktop.DBus.Properties", "GetAll",
            new GLib.Variant("(s)", ["net.hadess.SensorProxy"]),
            null, Gio.DBusCallFlags.NONE, -1, this._pnSensorCancellable,
            (bus, res) => {
                let props;
                try {
                    props = bus.call_finish(res).deepUnpack()[0];
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return; // teardown raced us, say nothing
                    console.log(`[pn-osk] rotate: SensorProxy GetAll failed: ${e.message}`);
                    return;
                }

                // Same deepUnpack?.() guard as GetCurrentState's is-current
                // above: a{sv} values arrive as GLib.Variant, not plain JS.
                const orientation = props["AccelerometerOrientation"]?.deepUnpack?.();
                const transform = PN_ORIENTATION_TRANSFORM[orientation];
                if (transform === undefined) {
                    console.log(`[pn-osk] rotate: sensor reports "${orientation}", not one of the four mapped orientations — leaving the screen as-is`);
                    return;
                }
                this._pnRotate(transform, this._pnSensorCancellable);
            });
    }

    // ── Tone: two modes, one button ─────────────────────────────────────────
    _pnToneOpenSettings() {
        // pnhelper's schema is not registered to the system path, its own
        // schemas directory must be specified. Resolved from the running
        // extension itself (Main.extensionManager knows where it is
        // actually installed) rather than trusting the hardcoded path to
        // still be right; that path is kept only as a fallback for the
        // unlikely case pnhelper is on disk but not (yet) known to the
        // extension manager. Same schema also holds `quality-mode` (see
        // PN_TONE_SETS_MODE), so this one Settings object serves both bw-mode
        // and the mode flip. Missing is not an error, it means 'pnhelper is
        // absent', the guard below takes over — logged once, here, not on
        // every tap.
        const dir = Main.extensionManager.lookup(
            'pnhelper@m-weigand.github.com')?.path;
        const schemaDir = dir ? `${dir}/schemas` : PN_TONE_SCHEMA_DIR;
        try {
            const src = Gio.SettingsSchemaSource.new_from_directory(
                schemaDir, Gio.SettingsSchemaSource.get_default(), true);
            const schema = src.lookup(PN_TONE_SCHEMA, false);
            if (schema)
                return new Gio.Settings({settings_schema: schema});
        } catch (e) {
            console.log(`[pn-osk] tone: no pnhelper schema: ${e.message}`);
        }
        return null;
    }

    // Flip pnhelper's own performance-mode switch to match the tone just
    // set. See the note above PN_TONE_SETS_MODE for why: this writes the
    // gsetting PerformanceModeButton already watches (changed::quality-mode
    // → its _apply_quality_mode → SetDclkSelect + mode_switcher.js + a
    // refresh of its own, none of which we touch). No settings object means
    // no pnhelper — skip, already logged once in _pnToneOpenSettings.
    _pnToneSyncMode(mode) {
        if (!PN_TONE_SETS_MODE || !this._pnToneSettings)
            return;
        // quality-mode true = 5 Hz/GC16 (grey), false = 80 Hz (mono).
        this._pnToneSettings.set_boolean(PN_TONE_MODE_KEY, mode === PN_TONE_GRAY);
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
        // One-shot timer, but must be cancellable: a callback firing after
        // extension disable hits a dismantled object.
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
        // Order is strict: mode first, then waveform, so the driver's bw
        // transition executes under the new mode. This copies upstream
        // _change_bw_mode's comment verbatim, no independent derivation.
        call("SetBwMode", new GLib.Variant("(y)", [mode]), () =>
            call("SetDefaultWaveform",
                new GLib.Variant("(y)", [PN_TONE_WAVEFORM[mode]]), () =>
                    this._pnToneLater(PN_TONE_REFRESH_MS,
                        () => this._pnTriggerRefresh())));
    }

    _pnToneSet(mode) {
        this._pnToneSettings?.set_uint("bw-mode", mode);
        // Mode follows tone, not the reverse, and it is written second: the
        // waveform/bw_mode write above must already be committed before
        // pnhelper's quality-mode refresh (its own timeout_add_seconds(1))
        // fires, or that refresh paints the display in the mode being left
        // rather than the one being entered. See PN_TONE_SETS_MODE.
        this._pnToneSyncMode(mode);
        // Guard: pnhelper might be missing, disabled, or eventually stop
        // listening to this key. If the deadline passes without movement, do
        // it ourselves and log it — a tap doing nothing is the worst failure
        // mode here, and looks identical on the glass to 'I pressed it but see
        // no difference'.
        this._pnToneLater(PN_TONE_DEADLINE_MS, () => this._pnToneRead(now => {
            if (now === mode)
                return;
            console.log(`[pn-osk] tone: bw-mode still ${now}, applying here`);
            this._pnToneApplyDirect(mode);
        }));
    }

    _pnToneToggle() {
        this._pnToneRead(now =>
            // Of the four modes only 0 is grayscale, the other three are some
            // form of black and white. Someone else might set it to 2 or 3,
            // this button must be able to answer for those states.
            this._pnToneSet(now === PN_TONE_GRAY ? PN_TONE_MONO : PN_TONE_GRAY));
    }

    // Draws 'what it becomes when pressed', following the rotate button's
    // rule, and more justifiable here: the current state is clearer on the
    // glass than any icon, the button need not repeat it.
    //
    // The icon means 'what happens when pressed', not 'what this button is
    // called'. Portrait pressed turns to landscape ⇒ draw clockwise; landscape
    // pressed turns reverse. A rotate button that always looks the same only
    // says 'rotation happens here'.
    _pnRotationLocked() {
        return this._pnTouchSettings?.get_boolean("orientation-lock") ?? true;
    }

    _pnSyncRotateIcon() {
        const icon = Main.panel.statusArea?.["pn-rotate"]?._pnIcon;
        const mon = Main.layoutManager.primaryMonitor;
        if (!icon || !mon)
            return;
        // Auto draws 'sensor in control', locked draws 'pressing will rotate
        // this way'. Both states draw what happens next, not what the button is
        // called.
        icon.icon_name = this._pnRotationLocked()
            ? (mon.height > mon.width
                ? "object-rotate-right-symbolic"
                : "object-rotate-left-symbolic")
            : "rotation-allowed-symbolic";
    }

    // The maintainer's own words: auto-rotate "很常默默失效" — very often
    // silently stops working — without ever connecting it back to this
    // button. Locking on every tap is deliberate (see the comment where the
    // button is built), so the fix is not to lock less, it is to stop being
    // silent about it and to make unlocking actually take effect.
    //
    // GSettings only emits "changed" when the value actually flips, so this
    // fires once per real lock/unlock transition — not on every tap of a
    // button that keeps a locked screen locked (that would be tap-chatty),
    // and not on every call to _pnRotate(). Quick Settings' Auto Rotate
    // toggle writes the same key, so this also covers unlocking from there.
    _pnOnRotationLockChanged() {
        this._pnSyncRotateIcon();
        if (this._pnRotationLocked()) {
            console.log("[pn-osk] rotate: orientation-lock set, auto-rotate is now off");
            Main.notify("Auto-rotate is off",
                "Rotation is locked to the panel button now. Quick Settings > Auto Rotate turns it back on.");
        } else {
            console.log("[pn-osk] rotate: orientation-lock cleared, resyncing to the sensor");
            this._pnApplySensorOrientation();
        }
    }

    // Hide the container, not the actor: that is the layer the panel actually layouts.
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
        // Cancels the SensorProxy read (and, transitively, the _pnRotate()
        // call it may trigger) if disable() lands mid-flight — same intent as
        // _pnToneTimers above, for an async D-Bus call instead of a timer.
        this._pnSensorCancellable = new Gio.Cancellable();

        this._pnHidePanelItems();
        // 🔴 Hiding once is not enough. pnhelper disabled then enabled —
        //    which package upgrades do, and which I did while testing the
        //    guard — adds its buttons back, as **entirely new objects**. The
        //    ones we hid on startup are gone. The symptom is three extra items
        //    suddenly appearing on the top bar while the extension remains
        //    ACTIVE and the logs are silent. So look again when the panel
        //    grows new things.
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
        // Tapping implies an override, so lock first — otherwise the sensor
        // rotates it right back the next second.
        // Returning to auto uses the Auto Rotate button in GNOME's quick
        // settings (the same gsetting), which enables itself when it detects
        // an accelerometer, no need to build another invisible gesture here.
        add("pn-rotate", "PN Rotate", "object-rotate-right-symbolic",
            () => {
                this._pnTouchSettings.set_boolean("orientation-lock", true);
                this._pnRotate();
            });
        add("pn-refresh", "PN Refresh",
            `${this.path}/icons/pn-screen-refresh-symbolic.svg`,
            () => this._pnTriggerRefresh());
        this._pnToneSettings = this._pnToneOpenSettings();
        // 🔑 Only one image, and **deliberately** breaks the rotate button's
        //    rule (which draws 'what happens if pressed'). This draws current
        //    state, because current state here is free and honest: the grey
        //    inside the icon is real, the grayscale mode renders it as a
        //    smooth ramp, the black-and-white mode sees the driver dither it
        //    into dots — the same image changes itself, and the change is
        //    exactly what the mode does to 'grey'. The hardware as the
        //    instrument is more accurate than me drawing two states, and saves
        //    an image. Modes are only two, so 'what happens if pressed' = the
        //    other one.
        add("pn-tone", "PN Tone", `${this.path}/icons/pn-tone.svg`,
            () => this._pnToneToggle());
        // Speech is the one input this panel is good at: it is the only one
        // where nothing has to redraw while you use it.
        this._pnVoiceState = "idle";
        add("pn-voice", "PN Voice", "audio-input-microphone-symbolic",
            () => this._pnVoiceToggle());

        // The fourth button. Text based, see the block above PN_INPUT_LABELS.
        if (wanted("pn-input")) {
            const input = this._pnMakeTextButton("PN Input", "—",
                () => this._pnInputCycle());
            Main.panel.addToStatusArea("pn-input", input, 0, "right");
            this._pnPanelButtons.push("pn-input");
        }
        // Input sources can also be changed elsewhere (quick settings,
        // applications switching themselves, Super+Space). Without listening
        // here the label lies — same reason _pnSyncRotateIcon listens to
        // monitors-changed.
        // sources-changed must also be caught: when the list itself changes
        // (e.g. engine installed, or gsettings altered), currentSource becomes
        // a different object.
        const ism = Keyboard.getInputSourceManager();
        this._pnInputSignals = [
            ism.connect("current-source-changed", () => this._pnSyncInputLabel()),
            // 🔴 sources-changed must hide GNOME's button again. It decides
            //    whether to appear based on the number of sources (hidden for
            //    one, visible for two+), and PanelMenu.Button binds its own
            //    visible property to the container — the very thing we hid.
            //    The child-added guard above cannot catch this: the panel did
            //    not grow a new item, the old item opened itself.
            ism.connect("sources-changed", () => {
                this._pnApplyShortNames();
                this._pnSyncInputLabel();
                this._pnHidePanelItems();
            }),
        ];
        // 🔴 This must run once here, sources-changed is not enough. The
        //    extension is enabled after the shell is up, the input sources
        //    are long established by then, the signal will not fire again for
        //    us. Missing this line is a silent failure: the top bar button is
        //    correct (it consults PN_INPUT_LABELS), only the Ctrl+Space OSD
        //    still says en/㞢/あ.
        this._pnApplyShortNames();
        this._pnSyncInputLabel();
        this._pnInstallKeybindings();
        this._pnInstallRimeFocusHook();
        // 🔴 Align on startup. RIME remembers its last schema (user.yaml),
        //    we do not — after reboot the label says TW while RIME might be
        //    on bopomofo (verified on hardware). Rather than making the user
        //    tap to fix it, queue 'the face the label claims' as pending on
        //    startup; the first focus-in pulls RIME back into alignment.
        //    The label is the ground truth, RIME follows the label, not the
        //    other way around — doing it the other way is impossible because
        //    RIME does not report its schema.
        const cur = ism.currentSource;
        if (cur?.type === "ibus" && cur.id === "rime")
            this._pnRimePending = this._pnRimeFace ?? PN_RIME_FACE_ORDER[0];

        // The six match, it is not 3+3. Our three are packed tight (see
        // stylesheet), the remaining gap is entirely on the neighbour: from
        // quickSettings' left edge to the Wi-Fi centre is 24.5 logical pixels,
        // while consistency needs 14.5. It lacks a class of its own to select,
        // so we attach one.
        //
        // 🔴 Reduce only, never give negative values. Tested on 2026-08-08 by
        //    putting `margin-right: -10px` on our own button: St neither
        //    ignores nor clamps it, the negative allocated width propagates all
        //    the way to the offscreen framebuffer, is treated as unsigned
        //    becoming 4294967232 (0xFFFFFFC0 = −64), and g_error aborts the
        //    entire gnome-shell. See upstream/.
        this._pnNeighbour = Main.panel.statusArea?.["quickSettings"];
        this._pnNeighbour?.add_style_class_name("pn-panel-neighbour");

        this._pnSyncRotateIcon();
        this._pnPanelMonitorSignal = Main.layoutManager.connect(
            "monitors-changed", () => this._pnSyncRotateIcon());
        // Quick settings also contains this toggle, the icon must follow when
        // changed from there — and so must the notify/resync in
        // _pnOnRotationLockChanged, unlocking from Quick Settings hits the
        // same "mutter needs a nudge" problem as unlocking from this button.
        this._pnLockSignal = this._pnTouchSettings.connect(
            "changed::orientation-lock", () => this._pnOnRotationLockChanged());
    }

    _pnRemovePanel() {
        this._pnRemoveKeybindings();
        this._pnRemoveRimeFocusHook();
        // A recorder outlives the extension that started it: disable during a
        // dictation and arecord keeps the capture device open, so the next
        // attempt finds it busy and fails with nothing on screen to explain it.
        if (this._pnVoiceProc) {
            this._pnVoiceProc.send_signal(2);
            this._pnVoiceProc = null;
        }
        this._pnVoiceState = "idle";
        this._pnVoicePending = null;
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
        // Signal is disconnected above, so no new call starts after this
        // point; cancel aborts one already in flight.
        this._pnSensorCancellable?.cancel();
        this._pnSensorCancellable = null;
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
        // The list may contain multiple generations: if pnhelper added buttons
        // again, the previous ones were already destroyed by it, and touching
        // them throws an exception, skipping the rest of the restoration.
        for (const item of this._pnPanelHidden ?? []) {
            try {
                item.container?.show();
            } catch (e) {
                // Already gone, no need to restore
            }
        }
        this._pnPanelHidden = null;
    }

    PanelInfo() {
        const panel = Main.panel;
        // statusArea is 'name -> object', reverse lookup identifies the button on screen
        const roles = new Map();
        for (const [role, obj] of Object.entries(panel.statusArea ?? {})) {
            if (obj)
                roles.set(obj, role);
        }

        const describe = actor => {
            // Each box's children are usually containers, the identity belongs to the PanelMenu.Button inside
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
                // The text and icon visible on the panel, used to match the screen
                content: labels.slice(0, 6),
            };
        };

        const box = b => (b?.get_children() ?? []).map(describe);

        return JSON.stringify({
            panel: {w: Math.round(panel.width), h: Math.round(panel.height)},
            left: box(panel._leftBox),
            center: box(panel._centerBox),
            right: box(panel._rightBox),
            // Those in statusArea but missing from all three boxes (hidden or taken by others)
            statusAreaRoles: Object.keys(panel.statusArea ?? {}),
            // The input source's actual value. pn-input's label consults
            // PN_INPUT_LABELS, while the Ctrl+Space OSD draws source.shortName
            // — two different sources saying the same thing, so 'panel matches
            // but OSD does not' can be caught, provided shortName is visible here.
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

    // ── Touch chords: undo/redo ───────────────────────────────────────────
    // Reads gestures.{undo,redo,fingers,holdMs} from pn-panel.json, falls
    // back to GESTURE_DEFAULTS. Skipped entirely, no stage handler
    // connected, when fingers is 0 or both undo and redo are disabled — a
    // stage-wide captured-event listener is not free to leave running for
    // nothing.
    _pnInstallGestures() {
        const cfg = this._pnConfig?.gestures ?? {};
        this._pnGestureFingers = cfg.fingers ?? GESTURE_DEFAULTS.fingers;
        this._pnGestureUndoKind = cfg.undo ?? GESTURE_DEFAULTS.undo; // 'tap' | 'hold' | false
        this._pnGestureRedoKind = cfg.redo ?? GESTURE_DEFAULTS.redo;
        this._pnGestureHoldMs = cfg.holdMs ?? GESTURE_DEFAULTS.holdMs;
        // Diagnostic only: one line per touch group when it resolves, one
        // line per raw TOUCH_* event. Off by default — a stage-wide capture
        // handler is loud enough without narrating every tap forever.
        this._pnGestureTrace = cfg.trace ?? false;
        if (!this._pnGestureFingers || (!this._pnGestureUndoKind && !this._pnGestureRedoKind))
            return;
        // Same seat/device call keyboard.js's OSK makes to type a real key:
        // one virtual keyboard, created once, fed synthetic press/release
        // pairs for the life of the extension.
        this._pnVirtualKeyboard = Clutter.get_default_backend()
            .get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._pnTouchGroup = null;
        // Capture phase, not bubble: we want to see every touch before any
        // actor (a button, Xournal++'s own surface, whatever) gets a chance
        // to consume or reinterpret it, and captured-event runs regardless of
        // which actor is under the finger.
        this._pnCapturedId = global.stage.connect('captured-event',
            (actor, event) => this._pnOnCapturedEvent(event));
        console.log(`[pn-panel] gestures: fingers=${this._pnGestureFingers} ` +
            `undo=${this._pnGestureUndoKind} redo=${this._pnGestureRedoKind} ` +
            `holdMs=${this._pnGestureHoldMs} trace=${this._pnGestureTrace}`);
    }

    _pnRemoveGestures() {
        if (this._pnCapturedId) {
            global.stage.disconnect(this._pnCapturedId);
            this._pnCapturedId = 0;
        }
        // No destroy() on a Clutter virtual device; dropping the last
        // reference is what keyboard.js relies on too, and GJS's refcounting
        // frees the underlying device once it does.
        this._pnVirtualKeyboard = null;
        this._pnTouchGroup = null;
    }

    // True when (x, y) — stage coordinates, same space TOUCH_* events report
    // — falls inside the on-screen keyboard's own box. A bounding-box test
    // rather than keyboardBox.contains(actor): the actor under a captured
    // touch is whatever St picked at that point, and asking "is this point
    // inside that box" is one fact instead of two. The keyboard's own
    // two-finger use (dragging its arrow pad, say) must not undo the
    // document it is typing into.
    _pnOverKeyboard(x, y) {
        const kb = Main.layoutManager.keyboardBox;
        if (!kb || !kb.visible)
            return false;
        const [kx, ky] = kb.get_transformed_position();
        return x >= kx && x < kx + kb.width && y >= ky && y < ky + kb.height;
    }

    // Human-readable name for a raw trace line; anything unexpected prints
    // its numeric type rather than being swallowed.
    _pnEventTypeName(type) {
        switch (type) {
        case Clutter.EventType.TOUCH_BEGIN: return 'BEGIN';
        case Clutter.EventType.TOUCH_UPDATE: return 'UPDATE';
        case Clutter.EventType.TOUCH_END: return 'END';
        case Clutter.EventType.TOUCH_CANCEL: return 'CANCEL';
        default: return String(type);
        }
    }

    // One entry per finger currently down, kept for the group's whole life
    // (not removed on TOUCH_END) so a late-lifting finger's peak drift is
    // still there to check when the group finally empties.
    //
    // 🔴 Keyed by slot (ABS_MT_SLOT), not by the ClutterEventSequence object
    //    from get_event_sequence(). A GJS boxed wrapper for the same
    //    underlying sequence is not guaranteed to be the same JS object on
    //    every callback, so comparing those with === (or using one as a
    //    Map/Set key) can silently stop matching a finger's own UPDATE/END
    //    to its BEGIN — the exact failure this was built to catch: peak one
    //    short of the real finger count, drift and lead stuck at zero
    //    because the "second" entry never found its "first". keyboard.js
    //    keys touches by get_slot() for the same reason.
    _pnOnCapturedEvent(event) {
        const type = event.type();
        if (type !== Clutter.EventType.TOUCH_BEGIN &&
            type !== Clutter.EventType.TOUCH_UPDATE &&
            type !== Clutter.EventType.TOUCH_END &&
            type !== Clutter.EventType.TOUCH_CANCEL)
            return Clutter.EVENT_PROPAGATE;

        const slot = event.get_event_sequence().get_slot();
        const time = event.get_time();
        const [x, y] = event.get_coords();
        let g = this._pnTouchGroup;
        // Only BEGIN, the first UPDATE per finger, END and CANCEL get a raw
        // line -- a still-held finger reports UPDATE many times a second,
        // and none of it after the first is new information for a tap.
        let traceThis = true;

        if (type === Clutter.EventType.TOUCH_BEGIN) {
            // A group that never reached zero (a dropped TOUCH_END, a grab
            // stealing the rest of the sequence) is forgotten here rather
            // than kept alive by a live timer — it only matters again once
            // something new touches down, and that is exactly this branch.
            if (g && time - g.start > GESTURE_STALE_MS)
                g = null;
            if (!g) {
                g = {start: time, lastBegin: time, active: new Set(), peak: 0, entries: new Map()};
                this._pnTouchGroup = g;
            }
            g.lastBegin = time;
            g.active.add(slot);
            g.peak = Math.max(g.peak, g.active.size);
            g.entries.set(slot, {
                x, y, time, drift: 0,
                overKeyboard: this._pnOverKeyboard(x, y),
                cancelled: false,
                traced: false,
            });
        } else if (g) {
            const entry = g.entries.get(slot);
            if (type === Clutter.EventType.TOUCH_UPDATE) {
                traceThis = !!entry && !entry.traced;
                if (entry) {
                    entry.traced = true;
                    const d = Math.hypot(x - entry.x, y - entry.y);
                    if (d > entry.drift)
                        entry.drift = d;
                }
            } else { // TOUCH_END or TOUCH_CANCEL
                // Mutter cancels a client's in-flight touches the moment it
                // decides some other actor (a workspace-switch gesture, say)
                // owns the sequence instead. That is a real, distinct outcome
                // from a normal lift and must show up as one in the trace,
                // not vanish into whatever the group's other checks say.
                if (type === Clutter.EventType.TOUCH_CANCEL && entry)
                    entry.cancelled = true;
                g.active.delete(slot);
            }
        } else {
            traceThis = false; // UPDATE/END/CANCEL with no group at all: nothing to say
        }

        if (this._pnGestureTrace && traceThis) {
            const device = event.get_device()?.get_device_name() ?? '?';
            const active = g ? [...g.active].sort((a, b) => a - b).join(',') : '';
            console.log(`[pn-panel] gesture raw ${this._pnEventTypeName(type)} ` +
                `slot=${slot} x=${Math.round(x)} y=${Math.round(y)} ` +
                `active=[${active}] device="${device}"`);
        }

        if (g && (type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) &&
            g.active.size === 0) {
            this._pnMaybeFireGesture(g, time);
            this._pnTouchGroup = null; // one gesture per group; next BEGIN starts fresh
        }

        // Never eaten: the app under the finger (Xournal++, a text field,
        // whatever) still needs its own copy of every one of these to draw
        // or scroll. This is the one place in the file that watches touch
        // without owning it.
        return Clutter.EVENT_PROPAGATE;
    }

    // Computes the same verdict trace and production code share -- one
    // group in, one reason out, whether that reason is a fire or a specific
    // rejection. Trace logging reads this rather than duplicating the
    // threshold order, so the two can never disagree about why.
    _pnMaybeFireGesture(g, endTime) {
        const duration = endTime - g.start;
        const lead = g.lastBegin - g.start;
        const entries = [...g.entries.values()];
        const maxDrift = entries.reduce((m, e) => Math.max(m, e.drift), 0);
        const overKeyboard = entries.some(e => e.overKeyboard);
        const overviewOrModal = Main.overview.visible || Main.modalCount > 0;
        const cancelled = entries.some(e => e.cancelled);
        const rightCount = g.peak === this._pnGestureFingers;

        let verdict;
        // Overview/modal and keyboard-box read state at the moment the group
        // completes, which is close enough to "during" for a gesture under a
        // second -- undo/redo must not reach through a lock screen to the
        // document underneath it, or through the keyboard's own two-finger use.
        if (cancelled)
            verdict = 'cancelled';
        else if (overviewOrModal)
            verdict = 'rejected: overview/modal';
        else if (overKeyboard)
            verdict = 'rejected: keyboard-box';
        // Only two concurrent contacts are real on this panel (measured with
        // evtest/libinput straight off the kernel — see docs/panel.md); a
        // third finger takes over one of the two slots or never shows up at
        // all, so peak is checked against one configured count, not two.
        else if (!rightCount)
            verdict = `rejected: peak=${g.peak}`;
        else if (maxDrift >= GESTURE_MAX_DRIFT)
            verdict = `rejected: drift=${maxDrift.toFixed(1)}px`;
        // Every finger arrived close together: rules out a single tap that a
        // second finger joined a beat later, which is a real sequence of
        // events on a device this size and must stay two single taps, not
        // one two-finger one.
        else if (lead >= GESTURE_MAX_LEAD)
            verdict = `rejected: lead=${lead}ms`;
        else if (duration < GESTURE_MAX_DURATION)
            verdict = this._pnGestureUndoKind === 'tap' ? 'fired undo' :
                this._pnGestureRedoKind === 'tap' ? 'fired redo' :
                    'rejected: no action bound to tap';
        else if (duration >= this._pnGestureHoldMs)
            verdict = this._pnGestureUndoKind === 'hold' ? 'fired undo' :
                this._pnGestureRedoKind === 'hold' ? 'fired redo' :
                    'rejected: no action bound to hold';
        // The dead band between "definitely a tap" and "definitely a hold":
        // firing either guess here is how a slightly-late tap starts an
        // unwanted redo, or a slightly-short hold erases a stroke instead.
        else
            verdict = `rejected: ambiguous duration=${duration}ms`;

        if (this._pnGestureTrace) {
            // Where the chord is about to go, at the moment it is decided —
            // not where the finger landed. A tap that fires but does
            // nothing to the app is a focus question, not a gesture one,
            // and this is the one line that can tell the two apart.
            const focus = global.display.focus_window;
            const focusClass = focus?.get_wm_class() ?? '(none)';
            const focusTitle = focus?.get_title() ?? '';
            console.log(`[pn-panel] gesture peak=${g.peak} lead=${lead}ms ` +
                `drift=${maxDrift.toFixed(1)}px duration=${duration}ms ` +
                `keyboard=${overKeyboard} overview/modal=${overviewOrModal} ` +
                `verdict=${verdict} focus=${focusClass} title="${focusTitle}"`);
        }

        if (verdict === 'fired undo' || verdict === 'fired redo')
            this._pnSendChord(verdict === 'fired redo');
    }

    // Ctrl+Z / Ctrl+Shift+Z rather than Ctrl+Y: Ctrl+Shift+Z is GTK's own
    // redo convention (Ctrl+Y is Word's), so this reaches every GTK app the
    // owner runs, not only the one it was built for. Xournal++ itself binds
    // both, which is how this was checked without a second chord to build.
    _pnSendChord(withShift) {
        const kb = this._pnVirtualKeyboard;
        if (!kb)
            return;
        // Matches keyboard.js: the event time a synthetic key event should
        // carry is the current one, in microseconds.
        const now = () => Clutter.get_current_event_time() * 1000;
        if (withShift)
            kb.notify_keyval(now(), Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        kb.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        kb.notify_keyval(now(), Clutter.KEY_z, Clutter.KeyState.PRESSED);
        kb.notify_keyval(now(), Clutter.KEY_z, Clutter.KeyState.RELEASED);
        kb.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        if (withShift)
            kb.notify_keyval(now(), Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
    }

    Rotate() {
        this._pnRotate();
    }

    // Same reason as Rotate: both effects only appear on the glass, and this
    // machine is driven over SSH. This goes through the same function as a real
    // tap, it is not a separate test-only path.
    Tone() {
        this._pnToneToggle();
    }
}
