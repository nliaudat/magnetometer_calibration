/**
 * Node entry point for the port's parity checks: `node --test web/tests`.
 *
 * The assertions live in `./spec.js`, so this runner and the browser page
 * (`web/tests/parity.html`) cannot drift apart.  CI runs this after regenerating
 * `./golden/python-golden.json` with the same numeric stack, which is what makes the port's
 * numbers verifiable rather than merely plausible.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

import { runTests } from "./spec.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "golden", "python-golden.json"), "utf8"));
const results = runTests(fixture);

test("the fixture was produced by tools/dump_golden.py", () => {
  assert.equal(fixture.generator, "tools/dump_golden.py");
});

for (const result of results) {
  test(result.name, () => {
    assert.ok(result.ok, result.detail);
  });
}

test("every check ran", () => {
  assert.ok(results.length > 100, `only ${results.length} checks ran`);
});
