import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  warnOnPageBundlePathCollisions,
  recordRenderedPageBundlePaths,
  warnOnInconsistentPageBundlePaths,
  type MergedPageBundle,
  type MergedBundleAggregate,
  type PageBundlePathTracker,
} from "./processExternalBundles.ts";
import type { YetiConfig } from "../config.ts";
import type { PageContext } from "./types.ts";

const emptyAggregate = (): MergedBundleAggregate => ({ importPaths: new Set(), rawContents: [] });

const makePageContext = (inputPath: string, fileSlug: string): PageContext => ({
  inputPath,
  fileSlug,
  filePathStem: `/${fileSlug}`,
  templateSyntax: "page.ts",
  date: new Date(0),
  url: `/${fileSlug}/`,
  outputPath: `_site/${fileSlug}/index.html`,
});

const makePageBundle = (
  inputPath: string,
  fileSlug: string,
  assets: { css?: boolean; js?: boolean; html?: boolean },
): MergedPageBundle => ({
  inputPath,
  page: makePageContext(inputPath, fileSlug),
  css: assets.css ? emptyAggregate() : null,
  js: assets.js ? emptyAggregate() : null,
  htmlImportPaths: assets.html ? new Set(["/some/import.html"]) : null,
});

/**
 * A config stub whose page-bundle derivers key off `fileSlug` (rather than the default
 * `inputPath`), so two templates that share a slug collide on the derived path. Each asset type
 * uses a distinct prefix, so css/js/html never collide with each other.
 */
const collidableConfig = {
  css: { derivePageBundleFilePath: (page: PageContext) => `/css/_pages/${page.fileSlug}.css` },
  js: { derivePageBundleFilePath: (page: PageContext) => `/js/_pages/${page.fileSlug}.js` },
  html: { derivePageBundleFilePath: (page: PageContext) => `/html/_pages/${page.fileSlug}.html` },
} as unknown as YetiConfig;

const captureWarnings = (t: { mock: { method: typeof import("node:test").mock.method } }): string[] => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (...args: any[]) => {
    warnings.push(args.map(String).join(" "));
  });
  return warnings;
};

describe("warnOnPageBundlePathCollisions", () => {
  test("no warning when every template derives a distinct path", (t) => {
    const warnings = captureWarnings(t);
    const merged = new Map<string, MergedPageBundle>([
      ["a.page.ts", makePageBundle("a.page.ts", "a", { css: true, js: true })],
      ["b.page.ts", makePageBundle("b.page.ts", "b", { css: true, js: true })],
    ]);

    warnOnPageBundlePathCollisions(merged, collidableConfig);
    assert.equal(warnings.length, 0);
  });

  test("warns when two templates derive the same CSS path", (t) => {
    const warnings = captureWarnings(t);
    // Same fileSlug "shared" from two different input paths → same derived CSS path.
    const merged = new Map<string, MergedPageBundle>([
      ["dir-a/page.page.ts", makePageBundle("dir-a/page.page.ts", "shared", { css: true })],
      ["dir-b/page.page.ts", makePageBundle("dir-b/page.page.ts", "shared", { css: true })],
    ]);

    warnOnPageBundlePathCollisions(merged, collidableConfig);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /dir-a\/page\.page\.ts/);
    assert.match(warnings[0], /dir-b\/page\.page\.ts/);
    assert.match(warnings[0], /\/css\/_pages\/shared\.css/);
    assert.match(warnings[0], /CSS/);
  });

  test("does not warn when only one of the colliding templates has content for that asset type", (t) => {
    const warnings = captureWarnings(t);
    // Both derive the same CSS path, but only A actually has CSS content — B contributes nothing,
    // so there is no real collision (B's @page CSS bundle is never written).
    const merged = new Map<string, MergedPageBundle>([
      ["dir-a/page.page.ts", makePageBundle("dir-a/page.page.ts", "shared", { css: true })],
      ["dir-b/page.page.ts", makePageBundle("dir-b/page.page.ts", "shared", { js: true })],
    ]);

    warnOnPageBundlePathCollisions(merged, collidableConfig);
    assert.equal(warnings.length, 0);
  });

  test("collisions are tracked independently per asset type", (t) => {
    const warnings = captureWarnings(t);
    // Two templates collide on both CSS and JS paths (shared slug, both have both asset types).
    const merged = new Map<string, MergedPageBundle>([
      ["dir-a/page.page.ts", makePageBundle("dir-a/page.page.ts", "shared", { css: true, js: true })],
      ["dir-b/page.page.ts", makePageBundle("dir-b/page.page.ts", "shared", { css: true, js: true })],
    ]);

    warnOnPageBundlePathCollisions(merged, collidableConfig);

    // One warning for the CSS collision, one for the JS collision.
    assert.equal(warnings.length, 2);
    assert.ok(warnings.some((w) => /CSS/.test(w) && /shared\.css/.test(w)));
    assert.ok(warnings.some((w) => /JS/.test(w) && /shared\.js/.test(w)));
  });

  test("warns once per additional colliding template (three-way collision)", (t) => {
    const warnings = captureWarnings(t);
    const merged = new Map<string, MergedPageBundle>([
      ["a.page.ts", makePageBundle("a.page.ts", "shared", { html: true })],
      ["b.page.ts", makePageBundle("b.page.ts", "shared", { html: true })],
      ["c.page.ts", makePageBundle("c.page.ts", "shared", { html: true })],
    ]);

    warnOnPageBundlePathCollisions(merged, collidableConfig);

    // First template claims the path; each of the other two warns against the claimant.
    assert.equal(warnings.length, 2);
    for (const w of warnings) {
      assert.match(w, /a\.page\.ts/); // the original claimant is named in both warnings
      assert.match(w, /HTML/);
    }
  });

  test("empty htmlImportPaths set is treated as no content", (t) => {
    const warnings = captureWarnings(t);
    const a = makePageBundle("a.page.ts", "shared", { html: true });
    const b = makePageBundle("b.page.ts", "shared", { html: true });
    // B has an html bundle entry but with zero import paths — nothing will be written.
    b.htmlImportPaths = new Set();
    const merged = new Map<string, MergedPageBundle>([["a.page.ts", a], ["b.page.ts", b]]);

    warnOnPageBundlePathCollisions(merged, collidableConfig);
    assert.equal(warnings.length, 0);
  });
});

/**
 * A config stub whose page-bundle derivers key off the *per-page* `url` field. For pagination
 * variants of one template (same `inputPath`, different `url`) this yields a different derived path
 * per variant — the footgun `warnOnInconsistentPageBundlePaths` is meant to catch.
 */
const urlKeyedConfig = {
  css: { derivePageBundleFilePath: (page: PageContext) => `/css/_pages${page.url}.css` },
  js: { derivePageBundleFilePath: (page: PageContext) => `/js/_pages${page.url}.js` },
  html: { derivePageBundleFilePath: (page: PageContext) => `/html/_pages${page.url}.html` },
} as unknown as YetiConfig;

/** A config stub whose derivers key off the template-constant `inputPath` (the safe pattern). */
const inputPathKeyedConfig = {
  css: { derivePageBundleFilePath: (page: PageContext) => `/css/_pages/${page.inputPath}.css` },
  js: { derivePageBundleFilePath: (page: PageContext) => `/js/_pages/${page.inputPath}.js` },
  html: { derivePageBundleFilePath: (page: PageContext) => `/html/_pages/${page.inputPath}.html` },
} as unknown as YetiConfig;

const cssAggregate = (): MergedBundleAggregate => emptyAggregate();

describe("warnOnInconsistentPageBundlePaths", () => {
  test("warns when one template derives different @page paths across its rendered pages", (t) => {
    const warnings = captureWarnings(t);
    const tracker: PageBundlePathTracker = new Map();

    // Two pagination variants of "slug.page.ts": same inputPath, different url → different CSS path.
    recordRenderedPageBundlePaths(tracker, "slug.page.ts", { css: cssAggregate(), js: null, html: null }, makePageContext("slug.page.ts", "a"), urlKeyedConfig);
    recordRenderedPageBundlePaths(tracker, "slug.page.ts", { css: cssAggregate(), js: null, html: null }, makePageContext("slug.page.ts", "b"), urlKeyedConfig);

    const merged = new Map<string, MergedPageBundle>([
      ["slug.page.ts", makePageBundle("slug.page.ts", "b", { css: true })],
    ]);

    warnOnInconsistentPageBundlePaths(tracker, merged, urlKeyedConfig);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Inconsistent @page/);
    assert.match(warnings[0], /slug\.page\.ts/);
    assert.match(warnings[0], /CSS/);
    // Both distinct derived paths are named so the author can see the divergence.
    assert.match(warnings[0], /\/css\/_pages\/a\/\.css/);
    assert.match(warnings[0], /\/css\/_pages\/b\/\.css/);
  });

  test("does not warn when the deriver is constant across variants", (t) => {
    const warnings = captureWarnings(t);
    const tracker: PageBundlePathTracker = new Map();

    // Different per-page contexts, but the inputPath-keyed deriver returns the same path each time.
    recordRenderedPageBundlePaths(tracker, "slug.page.ts", { css: cssAggregate(), js: null, html: null }, makePageContext("slug.page.ts", "a"), inputPathKeyedConfig);
    recordRenderedPageBundlePaths(tracker, "slug.page.ts", { css: cssAggregate(), js: null, html: null }, makePageContext("slug.page.ts", "b"), inputPathKeyedConfig);

    const merged = new Map<string, MergedPageBundle>([
      ["slug.page.ts", makePageBundle("slug.page.ts", "b", { css: true })],
    ]);

    warnOnInconsistentPageBundlePaths(tracker, merged, inputPathKeyedConfig);
    assert.equal(warnings.length, 0);
  });

  test("catches a mismatch even when the final variant referenced no content for the asset type", (t) => {
    const warnings = captureWarnings(t);
    const tracker: PageBundlePathTracker = new Map();

    // Variant "a" referenced @page CSS (recorded), the final variant "b" did not (nothing recorded).
    recordRenderedPageBundlePaths(tracker, "slug.page.ts", { css: cssAggregate(), js: null, html: null }, makePageContext("slug.page.ts", "a"), urlKeyedConfig);
    recordRenderedPageBundlePaths(tracker, "slug.page.ts", { css: null, js: null, html: null }, makePageContext("slug.page.ts", "b"), urlKeyedConfig);

    // The merged bundle still has CSS content (from "a") and is written at the last context's path
    // ("b"). Folding that written path into the comparison must reveal the mismatch with "a".
    const merged = new Map<string, MergedPageBundle>([
      ["slug.page.ts", makePageBundle("slug.page.ts", "b", { css: true })],
    ]);

    warnOnInconsistentPageBundlePaths(tracker, merged, urlKeyedConfig);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Inconsistent @page/);
    assert.match(warnings[0], /CSS/);
  });

  test("skips templates with no tracker entry (e.g. incremental cache hits not rendered this build)", (t) => {
    const warnings = captureWarnings(t);
    const tracker: PageBundlePathTracker = new Map(); // empty — template was not rendered this build

    const merged = new Map<string, MergedPageBundle>([
      ["slug.page.ts", makePageBundle("slug.page.ts", "b", { css: true, js: true, html: true })],
    ]);

    warnOnInconsistentPageBundlePaths(tracker, merged, urlKeyedConfig);
    assert.equal(warnings.length, 0);
  });

  test("a single non-paginated render never warns", (t) => {
    const warnings = captureWarnings(t);
    const tracker: PageBundlePathTracker = new Map();

    recordRenderedPageBundlePaths(tracker, "page.page.ts", { css: cssAggregate(), js: cssAggregate(), html: new Set(["/x.html"]) }, makePageContext("page.page.ts", "page"), urlKeyedConfig);

    const merged = new Map<string, MergedPageBundle>([
      ["page.page.ts", makePageBundle("page.page.ts", "page", { css: true, js: true, html: true })],
    ]);

    warnOnInconsistentPageBundlePaths(tracker, merged, urlKeyedConfig);
    assert.equal(warnings.length, 0);
  });
});
