import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import browserslist from "browserslist";
import { transform as transformCSS } from "lightningcss";
import { transform as transformJS } from "esbuild";

import {
  resolveBrowserTargets,
  resetBrowserTargetsCache,
  getESBuildBrowserTargets,
  getLightningCSSBrowserTargets,
  withESBuildBrowserTargets,
  withLightningCSSBrowserTargets,
} from "./browserTargets.ts";
import { getConfig, updateConfig } from "./config.ts";
import type { JSBundleTransformConfig, CSSBundleTransformConfig } from "./config.ts";
import { YetiConfigError } from "./error.ts";
import { fileURLToPath } from "node:url";

// Repo root has no browserslist config, so it's a stable "no auto-detect" project path.
const repoRoot = fileURLToPath(import.meta.resolve("../"));
// Fixture project that ships a `.browserslistrc` (chrome 90 / firefox 88).
const configFixtureDir = resolve(repoRoot, "test_data/browserslistConfig");

describe("resolveBrowserTargets", () => {
  test("translates an explicit query into both esbuild and lightningcss targets", () => {
    const query = "chrome 90, firefox 88";
    const resolved = resolveBrowserTargets(query, repoRoot);

    assert.ok(resolved);
    // esbuild target: engine+min-version strings, order-independent.
    assert.deepEqual(
      new Set(resolved.esbuildTarget),
      new Set(["chrome90", "firefox88"]),
    );
    // lightningcss targets: exactly what browserslistToTargets produces for the same list.
    assert.deepEqual(
      resolved.lightningcssTargets,
      {
        // Lightning CSS encodes the major/minor/patch version as a single integer: (major << 16) | (minor << 8) | patch
        // This is chrome 90.0.0 and firefox 88.0.0
        chrome: 5898240,
        firefox: 5767168
      },
    );
  });

  test("an old target lowers modern JS syntax; a modern target leaves it", async () => {
    const old = resolveBrowserTargets("chrome 60", repoRoot); // chrome 60 predates `??` (chrome 80)
    const modern = resolveBrowserTargets("chrome 120", repoRoot);
    assert.ok(old && modern);

    const source = "const x = a ?? b;";
    const lowered = await transformJS(source, { target: old.esbuildTarget });
    const preserved = await transformJS(source, { target: modern.esbuildTarget });

    assert.doesNotMatch(lowered.code, /\?\?/); // nullish-coalescing transpiled away
    assert.match(preserved.code, /\?\?/); // left intact for a modern target
  });

  test("an old target transpiles CSS nesting; a modern one keeps it", () => {
    const old = resolveBrowserTargets("chrome 90", repoRoot); // before native CSS nesting
    const modern = resolveBrowserTargets("chrome 130", repoRoot);
    assert.ok(old && modern);

    const code = Buffer.from("a { color: red; & b { color: blue; } }");
    const lowered = transformCSS({ filename: "t.css", code, targets: old.lightningcssTargets });
    const preserved = transformCSS({ filename: "t.css", code, targets: modern.lightningcssTargets });

    // Flattened to a descendant selector when nesting isn't supported.
    assert.match(lowered.code.toString(), /a b/);
    // Native nesting retained (still uses the `&` nesting selector) for a modern target.
    assert.match(preserved.code.toString(), /&/);
  });

  test("auto-detects a project browserslist config when no explicit query is set", () => {
    const resolved = resolveBrowserTargets(null, configFixtureDir);
    assert.ok(resolved);
    assert.deepEqual(
      new Set(resolved.esbuildTarget),
      new Set(["chrome90", "firefox88"]),
    );
  });

  test("returns null when there's no explicit query and no project config", () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), "yeti-bl-"));
    // Precondition: nothing in this dir's ancestry defines a browserslist config.
    assert.equal(browserslist.findConfig(isolatedDir), undefined);
    assert.equal(resolveBrowserTargets(null, isolatedDir), null);
  });

  test("drops browsers esbuild can't target but keeps them for lightningcss", () => {
    const resolved = resolveBrowserTargets("samsung 4", repoRoot);
    assert.ok(resolved);
    // esbuild has no Samsung Internet engine → empty target.
    assert.deepEqual(resolved.esbuildTarget, []);
    // lightningcss supports a broader set and still includes it.
    assert.ok("samsung" in resolved.lightningcssTargets);
  });

  test("throws YetiConfigError on an invalid query", () => {
    assert.throws(
      () => resolveBrowserTargets("not-a-real-browser 999", repoRoot),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /browserslist/);
        return true;
      },
    );
  });
});

// Point the config singleton at a given browserslist query + project path, then clear the resolution
// cache so the next getter call re-resolves. `getConfig()` returns the live config object, so this is
// the most direct way to drive the config-reading getters in a unit test.
const configureBrowserslist = (query: string | string[] | null, inputDir: string): void => {
  updateConfig({
    browserslist: query,
    inputDir,
  });
  resetBrowserTargetsCache();
};

describe("getESBuildBrowserTargets / getLightningCSSBrowserTargets", () => {
  test("return undefined when there's no query and no project config", () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), "yeti-bl-"));
    assert.equal(browserslist.findConfig(isolatedDir), undefined);
    configureBrowserslist(null, isolatedDir);

    assert.equal(getESBuildBrowserTargets(), undefined);
    assert.equal(getLightningCSSBrowserTargets(), undefined);
  });

  test("resolve an explicit query for both engines", () => {
    configureBrowserslist("chrome 90, firefox 88", repoRoot);

    assert.deepEqual(
      new Set(getESBuildBrowserTargets()),
      new Set(["chrome90", "firefox88"]),
    );
    assert.deepEqual(getLightningCSSBrowserTargets(), {
      chrome: 5898240,
      firefox: 5767168
    });
  });

  test("auto-detect a project browserslist config when no explicit query is set", () => {
    configureBrowserslist(null, configFixtureDir);

    assert.deepEqual(
      new Set(getESBuildBrowserTargets()),
      new Set(["chrome90", "firefox88"]),
    );
    assert.deepEqual(getLightningCSSBrowserTargets(), {
      chrome: 5898240,
      firefox: 5767168
    });
  });

  test("getESBuildBrowserTargets is undefined when no browser maps to an esbuild engine", () => {
    configureBrowserslist("samsung 4", repoRoot);

    // No esbuild-targetable engine → undefined (esbuild keeps its default)...
    assert.equal(getESBuildBrowserTargets(), undefined);
    // ...but lightningcss supports the broader set.
    assert.deepEqual(getLightningCSSBrowserTargets(), {
      samsung: 262144,
    });
  });

  test("cache resolution within a build and re-resolve after a reset", () => {
    configureBrowserslist("chrome 90", repoRoot);
    const first = getLightningCSSBrowserTargets();
    const second = getLightningCSSBrowserTargets();
    // Same object reference → resolved once, then served from cache.
    assert.strictEqual(first, second);

    // Changing the query without resetting is ignored (still cached)...
    updateConfig({ browserslist: "firefox 88" });
    assert.strictEqual(getLightningCSSBrowserTargets(), first);

    // ...until the cache is reset, at which point it re-resolves.
    resetBrowserTargetsCache();
    assert.notStrictEqual(getLightningCSSBrowserTargets(), first);
  });

  test("throws YetiConfigError on an invalid configured query", () => {
    configureBrowserslist("not-a-real-browser 999", repoRoot);
    assert.throws(() => getESBuildBrowserTargets(), (err: Error) => {
      assert(err instanceof YetiConfigError);
      assert.match(err.message, /browserslist/);
      return true;
    });
  });
});

describe("withESBuildBrowserTargets / withLightningCSSBrowserTargets", () => {
  test("apply the resolved targets when the user hasn't set them", () => {
    configureBrowserslist("chrome 90", repoRoot);

    const js = withESBuildBrowserTargets({ minify: true });
    assert.deepEqual(new Set(js.target), new Set(["chrome90"]));
    assert.equal(js.minify, true);

    const css = withLightningCSSBrowserTargets({ minify: true });
    assert.ok(css.targets);
    assert.equal(css.minify, true);
  });

  test("the user's explicit target/targets always wins", () => {
    configureBrowserslist("chrome 90", repoRoot);

    const userJS: JSBundleTransformConfig = { minify: true, target: ["es2015"] };
    const userCSS: CSSBundleTransformConfig = { minify: true, targets: {} };

    assert.deepStrictEqual(withESBuildBrowserTargets(userJS).target, ["es2015"]);
    assert.deepStrictEqual(withLightningCSSBrowserTargets(userCSS).targets, {});
  });

  test("return the input unchanged when no browser target resolves (no-op default)", () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), "yeti-bl-"));
    configureBrowserslist(null, isolatedDir);

    const js: JSBundleTransformConfig = { minify: true, target: undefined };
    const css: CSSBundleTransformConfig = { minify: true, targets: undefined };
    // Same object reference back → byte-identical no-op for projects that never opted in.
    assert.deepStrictEqual(withESBuildBrowserTargets(js), js);
    assert.deepStrictEqual(withLightningCSSBrowserTargets(css), css);
  });
});
