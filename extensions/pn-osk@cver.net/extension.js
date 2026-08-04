// PineNote OSK — make GNOME's on-screen keyboard stop wasting landscape.
//
// What is wrong, on a 1872x1404 panel:
//
// Keyboard._relayout() reserves a band the full width of the monitor and
// monitor.height / 3 tall in landscape (a quarter in portrait). The keys are
// drawn inside an AspectContainer, which preserves the layout's column:row
// ratio and centres whatever it cannot fill. In landscape the band is far
// wider than that ratio, so a large part of the reserved strip is blank — you
// pay a third of a shorter screen and get nothing for it — while the keys stay
// narrow enough that the terminal layout's labels ellipsize: "Tab" renders as
// "T…", "Ctrl" as "C…", "?123" as "?…". Those are not mystery keys. They are
// keys that cannot spell their own names.
//
// Settings live in ~/.config/pn-osk.json and are re-read every time the
// keyboard is rebuilt, so changing them needs no session restart:
//
//   { "fillWidth": true, "addTopRow": true, "symbolKeyWidth": 1.5 }
//
// The D-Bus interface at org.cver.PnOsk exists because this device is driven
// over SSH and GNOME refuses screenshots to outside callers. An extension runs
// inside the shell, so it can both take the picture and report the actual
// allocation boxes — which is the difference between measuring this layout and
// guessing at it from a photograph of the glass.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Keyboard} from 'resource:///org/gnome/shell/ui/keyboard.js';

const BUILD = 5;

const DEFAULTS = {
    fillWidth: true,
    addTopRow: true,
    // The stock '?123' key is one column wide and its label does not fit.
    // Widening it takes the difference out of the space bar, which has four.
    symbolKeyWidth: 1.5,
    trace: false,
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
        if (ok)
            return {...DEFAULTS, ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch (e) {
        // No file, or bad JSON: fall back to defaults rather than breaking the
        // keyboard. A typo in a config file must not cost you your input.
        if (!(e instanceof GLib.FileError))
            console.warn(`[pn-osk] ignoring bad config: ${e.message}`);
    }
    return {...DEFAULTS};
}

// Fresh objects every build: _addRowKeys does `strings?.shift()`, mutating the
// key it is handed. A shared constant would be drained of its characters the
// second time the keyboard is built.
function topRow() {
    return [
        {label: 'Esc', keyval: Clutter.KEY_Escape},
        ...[...'1234567890'].map(c => ({label: c, strings: [c]})),
    ];
}

function isSpaceKey(key) {
    return key.label === ' ' || key.strings?.[0] === ' ';
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
            out.padding = [
                node.get_padding(St.Side.TOP),
                node.get_padding(St.Side.RIGHT),
                node.get_padding(St.Side.BOTTOM),
                node.get_padding(St.Side.LEFT),
            ].map(Math.round);
            out.margin = [
                node.get_margin(St.Side.TOP),
                node.get_margin(St.Side.RIGHT),
                node.get_margin(St.Side.BOTTOM),
                node.get_margin(St.Side.LEFT),
            ].map(Math.round);
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
            if (ext._config.fillWidth)
                ext._forceFullWidth(this);
        };

        proto._updateLayout = function (groupName, purpose) {
            // Re-read here: this runs on every rebuild, which makes the config
            // file take effect without reloading the extension.
            ext._config = readConfig();
            this._pnPurpose = purpose;
            const ret = ext._origUpdateLayout.call(this, groupName, purpose);
            // _relayout only runs on monitor changes, so installing the ratio
            // override from there leaves it uninstalled after the extension is
            // re-enabled on a session that already has a keyboard. This runs
            // on every rebuild, which is the honest place for it.
            if (ext._config.fillWidth)
                ext._forceFullWidth(this);
            return ret;
        };

        proto._addRowKeys = function (keys, layout, emojiVisible) {
            const cfg = ext._config;
            const isTerminal =
                this._pnPurpose === Clutter.InputContentPurpose.TERMINAL;

            if (cfg.addTopRow && isTerminal && !layout._pnTopRowDone) {
                layout._pnTopRowDone = true;
                ext._origAddRowKeys.call(this, topRow(), layout, emojiVisible);
                layout.appendRow();
            }

            return ext._origAddRowKeys.call(
                this, ext._widenSymbolKey(keys, cfg), layout, emojiVisible);
        };

        this._exportDBus();
        this._rebuild();
        console.log(`[pn-osk] enabled, build=${BUILD}, config=${JSON.stringify(this._config)}`);
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

    // Give '?123' the columns its label needs, and take them from the space
    // bar, which is the only key on that row with any to spare. Clone the two
    // keys touched — the originals belong to the freshly parsed model, but the
    // row array is walked more than once per build.
    _widenSymbolKey(keys, cfg) {
        const extra = (cfg.symbolKeyWidth ?? 1) - 1;
        if (extra <= 0)
            return keys;

        const symbolIdx = keys.findIndex(k => k.label === '?123');
        const spaceIdx = keys.findIndex(k => isSpaceKey(k) && (k.width ?? 1) > extra + 1);
        if (symbolIdx < 0 || spaceIdx < 0)
            return keys;

        const out = [...keys];
        out[symbolIdx] = {...keys[symbolIdx], width: cfg.symbolKeyWidth};
        out[spaceIdx] = {...keys[spaceIdx], width: (keys[spaceIdx].width ?? 1) - extra};
        return out;
    }

    // AspectContainer keeps the keys at the layout's column:row ratio and
    // centres the remainder. Its class is not exported, but the instance is,
    // and setRatio() is called on it every time the page changes — so
    // overriding the instance's own method catches every caller, including the
    // ones inside the shell we cannot reach from here.
    _forceFullWidth(keyboard) {
        const self = this;
        const ac = keyboard._aspectContainer;
        if (!ac)
            return;

        if (!ac._pnOrigSetRatio) {
            ac._pnOrigSetRatio = ac.setRatio.bind(ac);
            ac.setRatio = (relWidth, relHeight) => {
                const monitor = Main.layoutManager.keyboardMonitor;
                if (monitor && monitor.width > monitor.height) {
                    // Use the container's own allocation when it has one: the
                    // keyboard actor is larger than the box the keys land in,
                    // and matching the wrong box is what leaves a margin.
                    // An actor that has never been allocated reports the empty
                    // box, whose corners are +/-Infinity. `|| fallback` does
                    // not catch that — -Infinity is truthy — and feeding it to
                    // setRatio yields a NaN ratio, which AspectContainer
                    // silently ignores in favour of the layout's own. That is
                    // exactly how this looked like "the override did nothing".
                    const b = ac.get_allocation_box();
                    const bw = b.x2 - b.x1;
                    const bh = b.y2 - b.y1;
                    const allocated =
                        Number.isFinite(bw) && Number.isFinite(bh) &&
                        bw > 0 && bh > 0;
                    const w = allocated ? Math.round(bw) : keyboard.width;
                    const h = allocated ? Math.round(bh) : keyboard.height;
                    if (self._trace) {
                        console.log(`[pn-osk] setRatio(${relWidth},${relHeight})` +
                            ` -> forcing ${w}/${h}`);
                    }
                    ac._pnOrigSetRatio(w, h);
                } else {
                    ac._pnOrigSetRatio(relWidth, relHeight);
                }
            };
            if (this._config.trace)
                console.log('[pn-osk] ratio override installed');
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

    // --- D-Bus methods -----------------------------------------------------

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
                    rows: container.get_children?.().length ?? null,
                };
            }
        }

        // One real key, to see what the labels are actually being given.
        let sampleKey = null;
        const firstLayer = kb?._layers ? Object.values(kb._layers)[0] : null;
        const firstRow = firstLayer?.get_children?.()[0];
        const firstKey = firstRow?.get_children?.()[0];
        if (firstKey)
            sampleKey = box(firstKey);

        return JSON.stringify({
            build: BUILD,
            config: this._config,
            monitor: monitor
                ? {x: monitor.x, y: monitor.y, w: monitor.width, h: monitor.height}
                : null,
            keyboardBox: box(Main.layoutManager.keyboardBox),
            keyboard: box(kb),
            keyboardVisible: kb?.visible ?? null,
            aspectContainer: box(kb?._aspectContainer),
            currentLayout: box(kb?._currentLayout),
            layers,
            sampleKey,
        }, null, 2);
    }

    Rebuild() {
        this._config = readConfig();
        this._rebuild();
    }
}
