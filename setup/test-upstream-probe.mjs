// Does the probe that watches for gnome-shell!4396 actually tell the two
// shells apart? Run it with `node setup/test-upstream-probe.mjs`.
//
// The probe lives in extensions/pn-osk@cver.net/extension.js, which imports
// gnome-shell modules and cannot be loaded outside the compositor, so the one
// function under test is lifted out by reading the file and evaluating that
// function alone. That keeps this a test of the shipped source rather than of
// a copy somebody has to remember to update: change the function and this file
// tests the change; delete the function and this file fails loudly.
//
// The two arms are built to be exactly the two shapes gnome-shell has had:
//
//   48.7 as shipped     a Map that the code never calls .set() on. _addRowKeys
//                       does `this._modifierKeys[keyval] = [...]`, which hangs
//                       a property off the Map object and leaves .size at 0.
//                       This is the shell that needs our reset.
//
//   with !4396          the same field, filled with .set(). .size follows the
//                       number of modifier keys on the layout. This is the
//                       shell where our reset is redundant, and the arm that
//                       has to make the extension say so.
//
// Both arms are `instanceof Map`, which is the whole reason the probe cannot
// ask that question.

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
    join(here, "..", "extensions", "pn-osk@cver.net", "extension.js"), "utf8");

const match = src.match(
    /function pnUpstreamOwnsModifierKeys\(mk\) \{[\s\S]*?\n\}/);
if (!match) {
    console.error("FAIL: pnUpstreamOwnsModifierKeys is not in extension.js");
    process.exit(1);
}
const probe = new Function(`${match[0]}; return pnUpstreamOwnsModifierKeys;`)();

const shipped48_7 = () => {
    const mk = new Map();
    mk[0xffe3] = ["ctrl key actor"];      // what bracket assignment really does
    mk[0xffe9] = ["alt key actor"];
    return mk;
};
const with4396 = () => {
    const mk = new Map();
    mk.set(0xffe3, ["ctrl key actor"]);
    mk.set(0xffe9, ["alt key actor"]);
    return mk;
};

const cases = [
    ["48.7 as shipped: our reset is still needed", shipped48_7(), false],
    ["with !4396: our reset is redundant", with4396(), true],
    ["a fresh keyboard before any rebuild", new Map(), false],
    ["a shell that dropped the Map entirely", {}, false],
    ["nothing there at all", undefined, false],
];

let failed = 0;
for (const [name, value, expected] of cases) {
    const got = probe(value);
    const ok = got === expected;
    if (!ok)
        failed++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${name} -> ${got} (expected ${expected})`);
}

// The premise the probe rests on, asserted rather than assumed: both arms are
// Maps, so instanceof cannot be the test.
if (!(shipped48_7() instanceof Map) || !(with4396() instanceof Map)) {
    console.log("FAIL  the two arms were supposed to both be Map instances");
    failed++;
} else {
    console.log("ok    both arms are `instanceof Map`, which is why .size is the question");
}

console.log(failed === 0
    ? `\n${cases.length + 1} checks, all green`
    : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
