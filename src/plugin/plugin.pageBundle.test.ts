import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { Eleventy } from "@11ty/eleventy";
import type EleventyUserConfig from "@11ty/eleventy/UserConfig";

import { yetiPlugin } from "./plugin.ts";
import { getConfig, updateConfig } from "../config.ts";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../test_data/pageScopedBundles");

// Snapshot the default page-bundle path derivers before any test mutates the global config
// singleton. `updateConfig` merges (it never resets), and all tests in this file share one
// process, so a test that configures custom derivers would otherwise leak them into later tests.
// `buildFixture` resets to these defaults on every build; per-build overrides re-apply on top.
const DEFAULT_PAGE_BUNDLE_DERIVERS = {
  css: getConfig().css.derivePageBundleFilePath,
  js: getConfig().js.derivePageBundleFilePath,
  html: getConfig().html.derivePageBundleFilePath,
};

/**
 * Build a fixture under `pageScopedBundles/`. Minification is disabled across the board so we can
 * inspect rendered bundle bytes directly. `overrides` is shallow-merged per asset type on top of
 * the minify-off defaults, so a test can supply e.g. `{ css: { derivePageBundleFilePath } }`
 * without clobbering the `defaultBundleTransformConfig`.
 */
const buildFixture = async (
  fixtureName: string,
  overrides: { js?: object; css?: object; html?: object } = {},
  // Yeti's warnings respect quiet mode (derived from Eleventy's), so tests that need to assert on
  // `logWarning` output build with `quiet: false`. Defaults to quiet to keep test output clean.
  quiet = true,
) => {
  const inputDir = resolve(FIXTURE_ROOT, fixtureName);
  const outputDir = resolve(inputDir, "_site");

  await rm(outputDir, { recursive: true, force: true }).catch(() => { });

  // Reset page-bundle derivers to defaults so a prior test's custom derivers don't leak into this
  // build. Any per-build overrides below re-apply via addPlugin after this reset.
  updateConfig({
    css: { derivePageBundleFilePath: DEFAULT_PAGE_BUNDLE_DERIVERS.css },
    js: { derivePageBundleFilePath: DEFAULT_PAGE_BUNDLE_DERIVERS.js },
    html: { derivePageBundleFilePath: DEFAULT_PAGE_BUNDLE_DERIVERS.html },
  });

  const eleventy = new Eleventy(inputDir, outputDir, {
    config(eleventyConfig: EleventyUserConfig) {
      eleventyConfig.addPlugin(yetiPlugin, {
        js: { defaultBundleTransformConfig: { minify: false }, ...overrides.js },
        css: { defaultBundleTransformConfig: { minify: false }, ...overrides.css },
        html: { minify: false, defaultBundleTransformConfig: { minify: false }, ...overrides.html },
      });
      eleventyConfig.setQuietMode(quiet);
    },
  });

  await eleventy.write();
  return outputDir;
};

describe("Yeti Plugin — @page bundle isolation", () => {
  test("two templates produce isolated @page bundles with no cross-contamination", async () => {
    const outputDir = await buildFixture("twoTemplatesIsolated");

    const pageAJs = await readFile(resolve(outputDir, "js/_pages/pageA.js"), "utf-8");
    const pageBJs = await readFile(resolve(outputDir, "js/_pages/pageB.js"), "utf-8");

    // Each template's bundle contains its own dep + raw content, and nothing from the other.
    assert.match(pageAJs, /from-pageA-dep/);
    assert.match(pageAJs, /pageA-raw-marker/);
    assert.doesNotMatch(pageAJs, /from-pageB-dep/, "pageA's bundle must not contain pageB's dep");
    assert.doesNotMatch(pageAJs, /pageB-raw-marker/, "pageA's bundle must not contain pageB's raw content");

    assert.match(pageBJs, /from-pageB-dep/);
    assert.match(pageBJs, /pageB-raw-marker/);
    assert.doesNotMatch(pageBJs, /from-pageA-dep/, "pageB's bundle must not contain pageA's dep");
    assert.doesNotMatch(pageBJs, /pageA-raw-marker/, "pageB's bundle must not contain pageA's raw content");

    // Each rendered page references only its own @page bundle path.
    const pageAHtml = await readFile(resolve(outputDir, "pageA/index.html"), "utf-8");
    const pageBHtml = await readFile(resolve(outputDir, "pageB/index.html"), "utf-8");

    assert.match(pageAHtml, /\/js\/_pages\/pageA\.js/);
    assert.doesNotMatch(pageAHtml, /\/js\/_pages\/pageB\.js/, "pageA's HTML must not reference pageB's bundle path");

    assert.match(pageBHtml, /\/js\/_pages\/pageB\.js/);
    assert.doesNotMatch(pageBHtml, /\/js\/_pages\/pageA\.js/, "pageB's HTML must not reference pageA's bundle path");
  });

  test("pagination variants of a single template share one @page bundle file", async () => {
    const outputDir = await buildFixture("paginationVariantsShareBundle");

    // The fixture emits 3 pages (slug/a, slug/b, slug/c) from a single `slug.page.ts` template.
    // Because they share the same template inputPath, they must share a single `@page` bundle
    // file rather than producing one bundle per URL.
    const pagesJsDir = resolve(outputDir, "js/_pages");
    const entries = await readdir(pagesJsDir);
    assert.deepEqual(
      entries.sort(),
      ["slug.js"],
      `Expected exactly one @page JS bundle file for paginated template, got: ${entries.join(", ")}`,
    );

    const bundleJs = await readFile(resolve(pagesJsDir, "slug.js"), "utf-8");

    // The shared dep should appear exactly once even though all 3 paginated pages reference it.
    const sharedDepMatches = bundleJs.match(/paginated-shared-dep/g) ?? [];
    assert.equal(
      sharedDepMatches.length, 1,
      `Expected shared-dep to appear exactly once in the merged @page bundle. Got ${sharedDepMatches.length} occurrences. Bundle:\n${bundleJs}`,
    );

    // The template's raw contribution must appear exactly once: each pagination render invokes the
    // template and contributes the same module-static rawContent reference, which the cross-render
    // merge dedupes by reference identity.
    const rawMarkerMatches = bundleJs.match(/paginated-raw-marker/g) ?? [];
    assert.equal(
      rawMarkerMatches.length, 1,
      `Expected the template's raw marker to appear exactly once after reference-dedupe. Got ${rawMarkerMatches.length}. Bundle:\n${bundleJs}`,
    );

    // Each paginated page's rendered HTML should reference the same bundle path.
    for (const slug of ["a", "b", "c"]) {
      const pageHtml = await readFile(resolve(outputDir, `slug/${slug}.html`), "utf-8");
      assert.match(pageHtml, /\/js\/_pages\/slug\.js/, `slug ${slug} HTML must reference the shared @page bundle path`);
    }
  });

  test("HTML imported into @page is written to an external _pages bundle file, not inlined", async () => {
    const outputDir = await buildFixture("htmlPageBundle");

    // The fragment is imported into the `@page` HTML bundle, so it must be written to the
    // external page-bundle file (default path `/html/_pages/index.html`) and NOT inlined into
    // the page itself.
    const bundleHtml = await readFile(resolve(outputDir, "html/_pages/index.html"), "utf-8");
    assert.match(bundleHtml, /page-html-fragment-marker/, "the @page HTML bundle file must contain the imported fragment");

    const pageHtml = await readFile(resolve(outputDir, "index.html"), "utf-8");
    assert.doesNotMatch(
      pageHtml, /page-html-fragment-marker/,
      "a bundled @page HTML import must not be inlined into the page",
    );
    // The page references the external @page HTML bundle path (with a version query param).
    assert.match(pageHtml, /\/html\/_pages\/index\.html\?v=[a-f0-9]+/, "page must reference the @page HTML bundle file path");
  });

  test("custom derivePageBundleFilePath is honored for css, js, and html @page bundles", async () => {
    const outputDir = await buildFixture("customPageBundlePaths", {
      css: { derivePageBundleFilePath: (page: { fileSlug: string }) => `/assets/${page.fileSlug}.custom.css` },
      js: { derivePageBundleFilePath: (page: { fileSlug: string }) => `/assets/${page.fileSlug}.custom.js` },
      html: { derivePageBundleFilePath: (page: { fileSlug: string }) => `/assets/${page.fileSlug}.custom.html` },
    });

    // `widget.page.ts` → fileSlug "widget" → bundle files land at the custom `/assets/` paths.
    const css = await readFile(resolve(outputDir, "assets/widget.custom.css"), "utf-8");
    // lightningcss normalizes `rebeccapurple` → `#639`, so match the selector + normalized color.
    assert.match(css, /h1\s*\{/, "custom-path CSS @page bundle must contain the page's rule");
    assert.match(css, /#639/, "custom-path CSS @page bundle must contain the page's color");

    const js = await readFile(resolve(outputDir, "assets/widget.custom.js"), "utf-8");
    assert.match(js, /custom-page-js-marker/, "custom-path JS @page bundle must contain the page's script");

    const htmlBundle = await readFile(resolve(outputDir, "assets/widget.custom.html"), "utf-8");
    assert.match(htmlBundle, /custom-path-html-marker/, "custom-path HTML @page bundle must contain the imported fragment");

    // The rendered page must reference each custom path.
    const pageHtml = await readFile(resolve(outputDir, "widget/index.html"), "utf-8");
    assert.match(pageHtml, /\/assets\/widget\.custom\.css\?v=[a-f0-9]+/, "page must reference the custom CSS path");
    assert.match(pageHtml, /\/assets\/widget\.custom\.js\?v=[a-f0-9]+/, "page must reference the custom JS path");
    assert.match(pageHtml, /\/assets\/widget\.custom\.html\?v=[a-f0-9]+/, "page must reference the custom HTML path");
  });

  test("contributions from a component rendered on only one pagination variant survive the cross-variant merge", async () => {
    const outputDir = await buildFixture("paginationConditionalContributions");

    // `SpecialWidget` is rendered only on the "b" variant (a/c render an empty component). Before
    // the cross-render merge, the template's accumulated contributions were overwritten per render,
    // so whichever variant rendered last (here "c", without the widget) determined the bundles —
    // dropping the widget's assets entirely. The merge must preserve them.

    // @page JS: base contribution (every variant) + the widget's page-scoped JS (only "b").
    const pageJs = await readFile(resolve(outputDir, "js/_pages/slug.js"), "utf-8");
    assert.match(pageJs, /base-paginated-js-marker/, "every variant's base @page JS must be present");
    assert.match(
      pageJs, /special-widget-page-js-marker/,
      "the conditionally-rendered widget's @page JS must survive the merge",
    );

    // @page CSS exists only because the widget (rendered on "b") contributed it.
    const pageCss = await readFile(resolve(outputDir, "css/_pages/slug.css"), "utf-8");
    assert.match(
      pageCss, /special-widget-css-marker/,
      "the conditionally-rendered widget's @page CSS must survive the merge",
    );

    // Shared "global" bundle (non-@page path): the widget's contribution must also survive.
    const globalJs = await readFile(resolve(outputDir, "js/global.js"), "utf-8");
    assert.match(
      globalJs, /special-widget-global-js-marker/,
      "the conditionally-rendered widget's shared-bundle JS must survive the merge",
    );
  });

  test("referencing empty bundles via src() does not throw and drops the attribute", async () => {
    // The page contributes nothing, yet references @page (css/js/html) and a named bundle via
    // src(). Before Phase 6 this threw during bundle assembly; now the build must succeed.
    const outputDir = await buildFixture("emptyBundleReference");

    const pageHtml = await readFile(resolve(outputDir, "index.html"), "utf-8");

    // Each empty bundle reference has its attribute removed from the rendered element.
    for (const attr of ["data-page-css", "data-named-css", "data-page-js", "data-page-html"]) {
      assert.ok(
        !pageHtml.includes(attr),
        `expected empty-bundle attribute "${attr}" to be dropped from the output, but it was present`,
      );
    }

    // No @page bundle files should be written, since the page contributed no content.
    for (const bundlePath of ["css/_pages/index.css", "js/_pages/index.js", "html/_pages/index.html"]) {
      await assert.rejects(
        readFile(resolve(outputDir, bundlePath), "utf-8"),
        /ENOENT/,
        `no @page bundle file should be written at ${bundlePath} for a page with no content`,
      );
    }
  });

  test("a per-page-keyed derivePageBundleFilePath on a paginated template warns about inconsistent paths", async (t) => {
    const warnings: string[] = [];
    t.mock.method(console, "warn", (...args: any[]) => {
      warnings.push(args.map(String).join(" "));
    });

    // The paginated fixture references its JS via `js.src("@page")`. Keying the deriver off the
    // per-page `url` makes each variant (slug/a, slug/b, slug/c) reference a different path while
    // only one bundle file is written — exactly the silent-404 footgun. Build non-quiet so Yeti's
    // warning is emitted.
    await buildFixture("paginationVariantsShareBundle", {
      js: { derivePageBundleFilePath: (page: { url: string }) => `/js/pages${page.url}.js` },
    }, false);

    const inconsistent = warnings.filter((w) => w.includes("Inconsistent @page"));
    assert.ok(
      inconsistent.length > 0,
      `expected a warning about inconsistent @page bundle paths, got:\n${warnings.join("\n")}`,
    );
    assert.ok(inconsistent.some((w) => /JS/.test(w)), "the warning should name the JS asset type");
    assert.ok(
      inconsistent.some((w) => /slug\.page\.ts/.test(w)),
      "the warning should name the offending template",
    );
  });

  test("empty @page references are silent while empty named references still warn", async (t) => {
    const warnings: string[] = [];
    t.mock.method(console, "warn", (...args: any[]) => {
      warnings.push(args.map(String).join(" "));
    });

    // Build non-quiet so Yeti's warnings are emitted (they respect quiet mode).
    await buildFixture("emptyBundleReference", {}, false);

    const pageWarnings = warnings.filter((w) => w.includes("@page"));
    const namedWarnings = warnings.filter((w) => w.includes("named-empty-bundle"));

    assert.equal(
      pageWarnings.length, 0,
      `empty @page references must not warn, but got:\n${pageWarnings.join("\n")}`,
    );
    assert.ok(
      namedWarnings.length > 0,
      "an empty named-bundle reference must still produce a warning",
    );
  });
});
