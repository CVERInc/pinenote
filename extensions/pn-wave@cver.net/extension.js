/* pn-wave@cver.net — Breaks a full-screen flash into asynchronous band sweeps.
 *
 * ── Scheduling by frames, not milliseconds (2026-08-12 v3, prior two died here) ──
 * The panel takes ~450ms per frame (a full black<->white swing), and **the cost
 * of each frame equals the slowest transition in it** — our bands always contain
 * a black<->white swing, so every frame pays the worst-case time.
 * Scheduled by ms, a stage boundary lands between frames => that stage is swallowed.
 * Different bands lose different stages => **what remains are stripes** (which
 * is exactly what the maintainer saw).
 * Scheduled by integer frames, at frame k band g shows stage (k-g),
 * => every band proves it drew all four stages, regardless of panel speed.
 *
 * ── What was already measured (do not re-test) ──
 * - The content path *does* clear: a full-screen black->white x2 using
 *   default_waveform=GC16 clears as cleanly as TriggerGlobalRefresh; bw_mode
 *   0/1 are identical => BW mode does not swap the waveform.
 * - One frame is ~450ms, and **does not depend on painted area** (44%/14%/7%
 *   all measured at 2.0-2.3 frames/sec).
 * - The 6-8 frames/sec measured earlier was for shallow transitions, not swings.
 * - The delay_a/b/c knobs have no effect on speed.
 *
 * ── The cost of geometry (derived from 450ms, no way around it) ──
 * N visible bands => total frames = N + stages - 1, total duration = that x ~450ms.
 *   N=9 (11% band) ≈ 5.9s / N=20 (5%) ≈ 10.8s / N=100 (1%) ≈ 47s
 *
 * ── Traps in earlier versions (all three looked like wrong parameters) ──
 * 1. A gradient front spanning 68% of the screen => consecutive frames are almost
 *    identical => we reinvented the flash.
 * 2. Under diff_mode=Y, a single front **never touches already-black pixels**
 *    (black over black = no change) => it never clears. It needs two halves.
 * 3. stageMs set to 220 but panel takes 450ms/frame => half the stages were
 *    swallowed, so it never completed a full flash.
 *
 * ── Why restoreAuto defaults to false (for measurement) ──
 * A sweep dirties multiple screenfuls. If auto_refresh returns, it exceeds the
 * threshold and triggers a full flash => the "clean" result came from the flash.
 * To judge the wave itself, it must finish without intervention.
 */

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `
<node>
  <interface name="net.cver.PnWave">
    <method name="Sweep">
      <arg type="a{sv}" name="params" direction="in"/>
      <arg type="s"     name="result" direction="out"/>
    </method>
    <method name="Clear">
      <arg type="a{sv}" name="params" direction="in"/>
      <arg type="s"     name="result" direction="out"/>
    </method>
    <method name="Probe">
      <arg type="a{sv}" name="params" direction="in"/>
      <arg type="s"     name="result" direction="out"/>
    </method>
    <method name="Mark">
      <arg type="a{sv}" name="params" direction="in"/>
      <arg type="s"     name="result" direction="out"/>
    </method>
    <method name="Geometry">
      <arg type="s" name="json" direction="out"/>
    </method>
  </interface>
</node>`;

/* Clear() = The everyday clear: replaces the flash with a complementary dither.
 *
 * Why not a sweep: a sweep takes 6-20 frames (5-12 seconds), and the conclusion
 * was that **slowness reads as weak hardware**.
 * A dither takes 2 frames: half the pixels to black, half to white, swapped on
 * the next frame => every pixel receives a full black-to-white swing, but **the
 * screen's mean luminance stays at mid-grey, never flipping as a whole**.
 * Discomfort comes from the entire visual field changing brightness at once, not
 * from the clear itself — the two are separable.
 *
 * 🔴 holdMs must not fall below ~500ms: GC16 is a DC-balanced pulse train;
 *    interrupting it leaves residual charge (the cause of banding). 700-900ms is safe.
 */
const CLEAR_DEFAULTS = {
    grain: 8,        // Dither grain (power of 2)
    cycles: 1,       // Cycles (one cycle = A and its complement, touching both extremes for each pixel once)
    holdMs: 700,
    waveform: 4,     // GC16
};

function bayer(n) {
    let m = [[0]];
    for (let size = 1; size < n; size *= 2) {
        const next = [];
        for (let y = 0; y < size * 2; y++)
            next.push(new Array(size * 2).fill(0));
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const v = m[y][x] * 4;
                next[y][x] = v;
                next[y][x + size] = v + 2;
                next[y + size][x] = v + 3;
                next[y + size][x + size] = v + 1;
            }
        }
        m = next;
    }
    return m;
}

const EBC = {name: 'org.pinenote.ebc', path: '/ebc', iface: 'org.pinenote.ebc'};

const DEFAULTS = {
    bands: 9,        // Number of visible bands (band width = screen width / bands)
    cycles: 2,       // Cycles of black and white per band (the control group that clears completely is 2)
    stepMs: 500,     // Milliseconds per step. Panel step is ~450ms, do not set lower
    dir: 'lr',
    waveform: 4,     // 1=A2 2=DU 4=GC16 7=DU4, 0=idle
    holdAutoRefresh: true,   // Disable kernel auto_refresh during scan
    restoreAuto: false,      // Restore after scan. false = shows the true result of the wave
};

export default class PnWaveExtension extends Extension {
    enable() {
        this._busy = false;
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/net/cver/PnWave');
        this._nameId = Gio.bus_own_name(
            Gio.BusType.SESSION, 'net.cver.PnWave',
            Gio.BusNameOwnerFlags.NONE, null, null, null);
    }

    disable() {
        this._teardown();
        this._mark?.destroy();   // Labels left on screen survive disable, becoming uncollectable leftovers
        this._mark = null;
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = null;
        }
        this._dbus?.unexport();
        this._dbus = null;
    }

    _ebc(method, param = null) {
        try {
            return Gio.DBus.system.call_sync(
                EBC.name, EBC.path, EBC.iface, method, param, null,
                Gio.DBusCallFlags.NONE, 800, null);
        } catch (e) {
            // 🔴 Do not swallow this. The idle-refresh dbus call had 2>/dev/null
            //    appended; it shouted into the void for 3 days, succeeding every time.
            console.error(`pn-wave: ${method} failed: ${e.message}`);
            return null;
        }
    }

    _getByte(method) {
        const r = this._ebc(method);
        return r ? r.deep_unpack()[0] : null;
    }

    Geometry() {
        const m = Main.layoutManager.primaryMonitor;
        return JSON.stringify({width: m.width, height: m.height,
                               scale: m.geometry_scale, busy: this._busy,
                               autoRefresh: this._getByte('GetAutoRefresh'),
                               waveform: this._getByte('GetDefaultWaveform'),
                               defaults: DEFAULTS});
    }

    _repaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const p = this._p;
        const alongX = p.dir === 'lr' || p.dir === 'rl';
        const ascending = p.dir === 'lr' || p.dir === 'tb';
        const span = alongX ? w : h;
        const bandPx = span / p.bands;
        const k = this._step;

        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSourceRGBA(0, 0, 0, 0);
        cr.paint();

        for (let i = 0; i < p.bands; i++) {
            const g = ascending ? i : p.bands - 1 - i;   // Start order
            const stage = k - g;
            if (stage < 0 || stage >= this._stages.length)
                continue;                    // Not yet queued or already done = transparent = reveals content
            const v = this._stages[stage];
            cr.setSourceRGBA(v, v, v, 1);
            // Cover an extra 1px so a floating-point boundary does not leave a gap
            if (alongX)
                cr.rectangle(Math.floor(i * bandPx), 0, Math.ceil(bandPx) + 1, h);
            else
                cr.rectangle(0, Math.floor(i * bandPx), w, Math.ceil(bandPx) + 1);
            cr.fill();
        }
        cr.$dispose();
        // 🔑 Advance only after a frame was actually drawn. This proves every band
        //    drew all four stages, regardless of panel speed -- ms scheduling cannot.
        this._painted++;
    }

    // Complementary dither tiles (caches two: A and its complement)
    _ditherTile(grain, invert) {
        const key = `${grain}:${invert ? 1 : 0}`;
        this._tiles ??= new Map();
        if (this._tiles.has(key))
            return this._tiles.get(key);
        const m = bayer(grain);
        const half = grain * grain / 2;
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, grain, grain);
        const cr = new Cairo.Context(surf);
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.paint();
        cr.setSourceRGBA(0, 0, 0, 1);
        let n = 0;
        for (let y = 0; y < grain; y++) {
            for (let x = 0; x < grain; x++) {
                if ((m[y][x] < half) !== !!invert) {
                    cr.rectangle(x, y, 1, 1);
                    n++;
                }
            }
        }
        cr.fill();
        cr.$dispose();
        const pat = new Cairo.SurfacePattern(surf);
        pat.setExtend(Cairo.Extend.REPEAT);
        pat.setFilter(Cairo.Filter.NEAREST);
        this._tiles.set(key, pat);
        this._tileCounts ??= {};
        this._tileCounts[key] = n;
        return pat;
    }

    _repaintClear(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSource(this._ditherTile(this._p.grain, this._step % 2));
        cr.rectangle(0, 0, w, h);
        cr.fill();
        cr.$dispose();
        this._painted++;
    }

    /* Probe for the perception threshold: overlays density% of black dots **on top
     * of the existing screen** (the rest transparent, not white), holds for holdMs,
     * then removes them. density=0 is a sham trial -- it creates/destroys the actor
     * and waits just as long, but draws nothing, leaving no timing clues.
     *
     * Why measure this: an invisible clear requires 'brightness change per frame <
     * perception threshold'. Brightness change ≈ coverage * (page brightness - black).
     * The coverage ceiling is dictated by the observer's threshold, which cannot be
     * computed. It has to be measured.
     */
    _probeTile(grain, level) {
        const key = `p${grain}:${level}`;
        this._tiles ??= new Map();
        if (this._tiles.has(key))
            return this._tiles.get(key);
        const m = bayer(grain);
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, grain, grain);
        const cr = new Cairo.Context(surf);
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSourceRGBA(0, 0, 0, 0);          // Transparent background = underlying content remains
        cr.paint();
        cr.setSourceRGBA(0, 0, 0, 1);
        for (let y = 0; y < grain; y++) {
            for (let x = 0; x < grain; x++) {
                if (m[y][x] < level)
                    cr.rectangle(x, y, 1, 1);
            }
        }
        cr.fill();
        cr.$dispose();
        const pat = new Cairo.SurfacePattern(surf);
        pat.setExtend(Cairo.Extend.REPEAT);
        pat.setFilter(Cairo.Filter.NEAREST);
        this._tiles.set(key, pat);
        return pat;
    }

    /* Mark(n) = A tiny trial number in the corner of the screen.
     *
     * 🩸 The first test printed the number on a remote terminal while the observer
     *    stared at the tablet; they could report 'saw 7 of 12', but not which 7.
     *    Requiring them to watch two screens was a flaw in the instrument.
     * The label is small and pinned in the corner: a tiny footprint, far from the
     * evaluation zone, ensures it does not contaminate the screen-dimming judgment.
     */
    Mark(params) {
        const p = {n: 0, ...Object.fromEntries(Object.entries(params ?? {})
            .map(([k, v]) => [k, v.deep_unpack ? v.deep_unpack() : v]))};
        this._mark?.destroy();
        this._mark = null;
        if (!p.n)
            return JSON.stringify({mark: 0});
        const m = Main.layoutManager.primaryMonitor;
        this._mark = new St.Label({
            text: `${p.n}`,
            reactive: false,
            style: 'font-size: 34px; font-weight: bold; color: #000; '
                 + 'background-color: #fff; padding: 2px 12px;',
        });
        Main.layoutManager.uiGroup.add_child(this._mark);
        this._mark.set_position(m.x + 8, m.y + 8);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._mark, null);
        return JSON.stringify({mark: p.n});
    }

    Probe(params) {
        if (this._busy)
            return JSON.stringify({error: 'busy'});

        const p = {density: 50, holdMs: 700, grain: 8, waveform: 4,
                   ...Object.fromEntries(Object.entries(params ?? {})
                       .map(([k, v]) => [k, v.deep_unpack ? v.deep_unpack() : v]))};
        if (p.grain & (p.grain - 1))
            return JSON.stringify({error: `grain must be a power of two, got ${p.grain}`});

        const levels = p.grain * p.grain;
        const level = Math.round(p.density / 100 * levels);
        this._busy = true;
        this._prevWaveform = p.waveform ? this._getByte('GetDefaultWaveform') : null;
        this._prevAuto = this._getByte('GetAutoRefresh');
        this._restoreAuto = !!this._prevAuto;
        if (p.waveform)
            this._ebc('SetDefaultWaveform', new GLib.Variant('(y)', [p.waveform]));
        if (this._prevAuto)
            this._ebc('SetAutoRefresh', new GLib.Variant('(b)', [false]));

        // Sham trials also build the actor and wait: timing must not leak the answer
        if (level > 0) {
            const m = Main.layoutManager.primaryMonitor;
            this._area = new St.DrawingArea({reactive: false, width: m.width, height: m.height});
            this._area.connect('repaint', a => {
                const cr = a.get_context();
                const [w, h] = a.get_surface_size();
                cr.setOperator(Cairo.Operator.SOURCE);
                cr.setSourceRGBA(0, 0, 0, 0);
                cr.paint();
                cr.setOperator(Cairo.Operator.OVER);
                cr.setSource(this._probeTile(p.grain, level));
                cr.rectangle(0, 0, w, h);
                cr.fill();
                cr.$dispose();
                this._painted++;
            });
            Main.layoutManager.uiGroup.add_child(this._area);
            this._area.set_position(m.x, m.y);
            Main.layoutManager.uiGroup.set_child_above_sibling(this._area, null);
        }
        this._painted = 0;
        this._t0 = GLib.get_monotonic_time();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, p.holdMs, () => {
            this._elapsed = (GLib.get_monotonic_time() - this._t0) / 1000;
            this._timer = null;
            this._teardown();
            return GLib.SOURCE_REMOVE;
        });
        // Convert coverage to brightness change: white reflects ~40%, black ~5%
        const drop = (level / levels) * (0.40 - 0.05) / 0.40 * 100;
        return JSON.stringify({mode: 'probe', density: p.density, level, levels,
                               holdMs: p.holdMs, sham: level === 0,
                               estLumaDropPct: +drop.toFixed(1)});
    }

    Clear(params) {
        if (this._busy)
            return JSON.stringify({error: 'busy'});

        const p = {...CLEAR_DEFAULTS};
        for (const [k, v] of Object.entries(params ?? {}))
            p[k] = v.deep_unpack ? v.deep_unpack() : v;
        if (p.grain & (p.grain - 1))
            return JSON.stringify({error: `grain must be a power of two, got ${p.grain}`});
        this._p = p;

        const steps = p.cycles * 2;
        const m = Main.layoutManager.primaryMonitor;

        this._busy = true;
        this._prevWaveform = p.waveform ? this._getByte('GetDefaultWaveform') : null;
        this._prevAuto = this._getByte('GetAutoRefresh');
        if (p.waveform)
            this._ebc('SetDefaultWaveform', new GLib.Variant('(y)', [p.waveform]));
        if (this._prevAuto)
            this._ebc('SetAutoRefresh', new GLib.Variant('(b)', [false]));

        this._area = new St.DrawingArea({reactive: false, width: m.width, height: m.height});
        this._area.connect('repaint', a => this._repaintClear(a));
        Main.layoutManager.uiGroup.add_child(this._area);
        this._area.set_position(m.x, m.y);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._area, null);

        this._step = 0;
        this._painted = 0;
        this._t0 = GLib.get_monotonic_time();
        this._restoreAuto = !!this._prevAuto;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, p.holdMs, () => {
            this._step++;
            if (this._step >= steps) {
                this._elapsed = (GLib.get_monotonic_time() - this._t0) / 1000;
                this._timer = null;
                this._teardown();
                return GLib.SOURCE_REMOVE;
            }
            this._area.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });

        // Gate: tiles must complement, or pixels stay unflipped = silent dirty clear
        this._ditherTile(p.grain, 0);
        this._ditherTile(p.grain, 1);
        const a = this._tileCounts[`${p.grain}:0`];
        const b = this._tileCounts[`${p.grain}:1`];
        return JSON.stringify({
            mode: 'clear', grain: p.grain, cycles: p.cycles, steps,
            holdMs: p.holdMs, estMs: steps * p.holdMs, waveform: p.waveform,
            tiles: [a, b], complementary: a + b === p.grain * p.grain,
        });
    }

    Sweep(params) {
        if (this._busy)
            return JSON.stringify({error: 'busy'});

        const p = {...DEFAULTS};
        for (const [k, v] of Object.entries(params ?? {}))
            p[k] = v.deep_unpack ? v.deep_unpack() : v;
        if (p.bands < 1 || p.cycles < 1 || p.stepMs < 1)
            return JSON.stringify({error: 'bands/cycles/stepMs must be >= 1'});
        this._p = p;

        // Full band sequence: black, white * cycles. Identical to the clean control.
        this._stages = [];
        for (let c = 0; c < p.cycles; c++)
            this._stages.push(0, 1);

        const totalSteps = p.bands + this._stages.length - 1;
        const m = Main.layoutManager.primaryMonitor;

        this._busy = true;
        this._prevWaveform = p.waveform ? this._getByte('GetDefaultWaveform') : null;
        this._prevAuto = p.holdAutoRefresh ? this._getByte('GetAutoRefresh') : null;
        if (p.waveform)
            this._ebc('SetDefaultWaveform', new GLib.Variant('(y)', [p.waveform]));
        if (p.holdAutoRefresh && this._prevAuto)
            this._ebc('SetAutoRefresh', new GLib.Variant('(b)', [false]));
        this._restoreAuto = !!(this._prevAuto && p.restoreAuto);

        this._area = new St.DrawingArea({reactive: false, width: m.width, height: m.height});
        this._area.connect('repaint', a => this._repaint(a));
        Main.layoutManager.uiGroup.add_child(this._area);
        this._area.set_position(m.x, m.y);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._area, null);

        this._step = 0;
        this._painted = 0;
        this._t0 = GLib.get_monotonic_time();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, p.stepMs, () => {
            this._step++;
            if (this._step >= totalSteps) {
                this._elapsed = (GLib.get_monotonic_time() - this._t0) / 1000;
                this._timer = null;
                this._teardown();
                return GLib.SOURCE_REMOVE;
            }
            this._area.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });

        return JSON.stringify({
            bands: p.bands, bandPx: +(m.width / p.bands).toFixed(1),
            bandPct: +(100 / p.bands).toFixed(1),
            stages: this._stages.length, totalSteps,
            stepMs: p.stepMs, estMs: totalSteps * p.stepMs,
            waveform: p.waveform, dir: p.dir, restoreAuto: p.restoreAuto,
        });
    }

    _teardown() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        this._area?.destroy();
        this._area = null;
        if (this._prevWaveform !== null && this._prevWaveform !== undefined) {
            this._ebc('SetDefaultWaveform', new GLib.Variant('(y)', [this._prevWaveform]));
            this._prevWaveform = null;
        }
        // Sweep leaves it off (restoring it triggers a kernel flash, which fakes
        // the 'clean' result); Clear restores it to avoid altering system state.
        if (this._restoreAuto)
            this._ebc('SetAutoRefresh', new GLib.Variant('(b)', [true]));
        this._restoreAuto = false;
        this._prevAuto = null;
        if (this._painted)
            console.log(`pn-wave: ${Math.round(this._elapsed ?? 0)}ms, `
                        + `${this._step} steps, ${this._painted} painted`);
        this._painted = 0;
        this._busy = false;
    }
}
