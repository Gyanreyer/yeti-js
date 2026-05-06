import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Eleventy } from "@11ty/eleventy";
import type EleventyUserConfig from "@11ty/eleventy/UserConfig";

import { yetiPlugin } from "./plugin.ts";
import {
  clearBundleImportCache,
  getBundleCacheStats,
  resetBundleCacheStats,
} from "../bundle/bundleImportCache.ts";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../test_data/incrementalBuild");
const SHARED_BUNDLES_FIXTURE = join(FIXTURE_ROOT, "sharedBundles");

/**
 * Create an Eleventy instance configured with the yeti plugin for testing.
 * Sets a test-specific cacheDir inside the temp directory so cache files
 * don't leak between tests or pollute the real node_modules cache.
 */
const buildEleventyForFixture = (inputDir: string, outputDir: string) => {
  return new Eleventy(inputDir, outputDir, {
    config(eleventyConfig: EleventyUserConfig) {
      eleventyConfig.addPlugin(yetiPlugin, {
        js: { defaultBundleTransformConfig: { minify: false } },
        css: { defaultBundleTransformConfig: { minify: false } },
        html: { minify: false, defaultBundleTransformConfig: { minify: false } },
        cacheDir: join(inputDir, ".yeti-cache"),
      });
      eleventyConfig.setQuietMode(true);
    },
  });
};

/**
 * Copy a fixture directory to a temp directory and run the callback against it.
 *
 * The temp directory is created as a *sibling* of the fixture (not in the OS temp dir)
 * so that any relative imports in the fixture's page files (like
 * `from "../../../src/index.ts"`) still resolve correctly — the depth from the
 * project root must match.
 */
const withTempFixture = async (
  fixturePath: string,
  callback: (tempDir: string) => Promise<void>,
) => {
  const tempDir = await mkdtemp(join(FIXTURE_ROOT, ".tmp-"));
  try {
    await cp(fixturePath, tempDir, { recursive: true });
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

/**
 * Extract bundle hashes from rendered HTML by matching the `?v=<8 hex chars>` query
 * string pattern that yeti-js appends to bundle URLs.
 *
 * Returns a map of bundle URL path -> hash (e.g. `{ "/css/global.css" => "abc12345" }`).
 */
const extractBundleHashes = (html: string): Map<string, string> => {
  const hashes = new Map<string, string>();
  const pattern = /(\/[^"'\s?]+\.(?:css|js))\?v=([a-f0-9]{8})/g;
  for (const match of html.matchAll(pattern)) {
    hashes.set(match[1], match[2]);
  }
  return hashes;
};

/** Read both page output files and return their extracted hashes. */
const readPageHashes = async (outputDir: string) => {
  const pageAHtml = await readFile(join(outputDir, "pageA/index.html"), "utf-8");
  const pageBHtml = await readFile(join(outputDir, "pageB/index.html"), "utf-8");
  return {
    pageA: extractBundleHashes(pageAHtml),
    pageB: extractBundleHashes(pageBHtml),
    pageAHtml,
    pageBHtml,
  };
};

describe("Yeti Plugin — incremental builds", () => {
  test("fixture sanity: full build produces both pages with shared bundle hashes", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");
      const eleventy = buildEleventyForFixture(tempDir, outputDir);
      await eleventy.write();

      const { pageA, pageB } = await readPageHashes(outputDir);

      assert.ok(pageA.has("/css/global.css"), "pageA should reference /css/global.css");
      assert.ok(pageA.has("/js/global.js"), "pageA should reference /js/global.js");
      assert.ok(pageB.has("/css/global.css"), "pageB should reference /css/global.css");
      assert.ok(pageB.has("/js/global.js"), "pageB should reference /js/global.js");

      assert.equal(pageA.get("/css/global.css"), pageB.get("/css/global.css"),
        "both pages should reference the same CSS bundle hash");
      assert.equal(pageA.get("/js/global.js"), pageB.get("/js/global.js"),
        "both pages should reference the same JS bundle hash");
    });
  });

  test("cross-page CSS hash propagation: mutating pageA-only.css updates pageB's hash", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");
      const eleventy = buildEleventyForFixture(tempDir, outputDir);

      // Build 1: full build
      await eleventy.write();
      const build1 = await readPageHashes(outputDir);
      const originalCSSHash = build1.pageA.get("/css/global.css")!;

      // Mutate pageA-only.css
      const cssPath = join(tempDir, "pageA-only.css");
      await writeFile(cssPath, ".pageA-heading { color: hotpink; }\n");

      // Build 2: incremental — only pageA should recompile
      eleventy.setIncrementalFile(cssPath);
      await eleventy.write();

      const build2 = await readPageHashes(outputDir);
      const newCSSHash = build2.pageA.get("/css/global.css")!;

      // The CSS hash should have changed
      assert.notEqual(newCSSHash, originalCSSHash,
        "CSS bundle hash should change after modifying pageA-only.css");

      // Both pages should reference the SAME new hash
      assert.equal(build2.pageA.get("/css/global.css"), build2.pageB.get("/css/global.css"),
        "pageA and pageB should both reference the new CSS hash");

      // JS hashes should be unchanged
      assert.equal(build2.pageA.get("/js/global.js"), build1.pageA.get("/js/global.js"),
        "JS bundle hash should not change");
    });
  });

  test("cross-page JS hash propagation: mutating pageB-only.js updates pageA's hash", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");
      const eleventy = buildEleventyForFixture(tempDir, outputDir);

      // Build 1: full build
      await eleventy.write();
      const build1 = await readPageHashes(outputDir);
      const originalJSHash = build1.pageB.get("/js/global.js")!;

      // Mutate pageB-only.js
      const jsPath = join(tempDir, "pageB-only.js");
      await writeFile(jsPath, 'console.log("modified pageB-only.js");\n');

      // Build 2: incremental — only pageB should recompile
      eleventy.setIncrementalFile(jsPath);
      await eleventy.write();

      const build2 = await readPageHashes(outputDir);
      const newJSHash = build2.pageB.get("/js/global.js")!;

      // The JS hash should have changed
      assert.notEqual(newJSHash, originalJSHash,
        "JS bundle hash should change after modifying pageB-only.js");

      // Both pages should reference the SAME new hash
      assert.equal(build2.pageA.get("/js/global.js"), build2.pageB.get("/js/global.js"),
        "pageA and pageB should both reference the new JS hash");

      // CSS hashes should be unchanged
      assert.equal(build2.pageA.get("/css/global.css"), build1.pageA.get("/css/global.css"),
        "CSS bundle hash should not change");
    });
  });

  test("transitive JS dependency triggers cross-page hash update", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");
      const eleventy = buildEleventyForFixture(tempDir, outputDir);

      // Build 1: full build
      await eleventy.write();
      const build1 = await readPageHashes(outputDir);
      const originalJSHash = build1.pageB.get("/js/global.js")!;

      // Mutate nested-dep.js (transitive dep of pageB via pageB-only.js)
      const nestedDepPath = join(tempDir, "nested-dep.js");
      await writeFile(nestedDepPath, 'export const nestedValue = "modified nested value";\n');

      // Build 2: incremental targeting the transitive dep
      eleventy.setIncrementalFile(nestedDepPath);
      await eleventy.write();

      const build2 = await readPageHashes(outputDir);
      const newJSHash = build2.pageB.get("/js/global.js")!;

      // The JS hash should have changed because nested-dep.js content changed
      assert.notEqual(newJSHash, originalJSHash,
        "JS bundle hash should change after modifying nested-dep.js");

      // Both pages should have the same new JS hash
      assert.equal(build2.pageA.get("/js/global.js"), build2.pageB.get("/js/global.js"),
        "pageA and pageB should both reference the new JS hash");
    });
  });

  test("build cache is required for correctness: without cache, incremental build produces incomplete bundles", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");
      const cacheDir = join(tempDir, ".yeti-cache");
      const eleventy = buildEleventyForFixture(tempDir, outputDir);

      // Build 1: full build — populates cache
      await eleventy.write();
      const build1 = await readPageHashes(outputDir);

      // Simulate a fresh process: clear both in-memory and on-disk caches
      clearBundleImportCache();
      await rm(cacheDir, { recursive: true, force: true });

      // Mutate pageA-only.css so a rebuild is triggered
      const cssPath = join(tempDir, "pageA-only.css");
      await writeFile(cssPath, ".pageA-heading { color: lime; }\n");

      // Build 2: incremental without cache — only pageA recompiles.
      // Without the cache, pageB's bundle contributions are missing from the merge,
      // so the global CSS bundle only contains pageA's content.
      eleventy.setIncrementalFile(cssPath);
      await eleventy.write();

      const build2 = await readPageHashes(outputDir);

      // Read the CSS bundle file to check its contents
      const cssBundleContent = await readFile(join(outputDir, "css/global.css"), "utf-8");

      // The CSS bundle should be MISSING pageB's contribution (pageB-only.css content).
      // This proves the cache is load-bearing for correctness.
      assert.ok(
        !cssBundleContent.includes(".pageB-heading"),
        "Without cache, the CSS bundle should be missing pageB's contribution (pageB-only.css)",
      );

      // pageA should have a new hash (it was rebuilt)
      assert.notEqual(build2.pageA.get("/css/global.css"), build1.pageA.get("/css/global.css"),
        "pageA's CSS hash should change after the rebuild");
    });
  });

  test("persisted bundle import cache: fresh process hits cache for unchanged imports", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");

      // Build 1: full build with a fresh Eleventy instance — populates the on-disk
      // bundle import cache as a side effect of `eleventy.after`.
      const eleventy1 = buildEleventyForFixture(tempDir, outputDir);
      await eleventy1.write();

      // Simulate a new process: drop the in-memory cache, but leave the on-disk cache
      // file intact. Use a fresh Eleventy instance so no cross-build state leaks.
      clearBundleImportCache();
      resetBundleCacheStats();

      const eleventy2 = buildEleventyForFixture(tempDir, outputDir);
      await eleventy2.write();

      const stats = getBundleCacheStats();
      // Both pages share the same JS and CSS bundle import sets, so we expect the
      // bundle import cache to be hit for each merged-bundle resolution. There must be
      // zero misses — every miss means esbuild/lightningcss had to re-bundle from scratch.
      assert.equal(stats.jsMisses, 0, "no JS cache misses expected on simulated fresh process");
      assert.equal(stats.cssMisses, 0, "no CSS cache misses expected on simulated fresh process");
      assert.ok(stats.jsHits > 0, "expected at least one JS cache hit from persisted state");
      assert.ok(stats.cssHits > 0, "expected at least one CSS cache hit from persisted state");
    });
  });

  test("no-change rebuild produces byte-identical output", async () => {
    await withTempFixture(SHARED_BUNDLES_FIXTURE, async (tempDir) => {
      const outputDir = join(tempDir, "_site");
      const eleventy = buildEleventyForFixture(tempDir, outputDir);

      // Build 1: full build
      await eleventy.write();
      const build1PageA = await readFile(join(outputDir, "pageA/index.html"), "utf-8");
      const build1PageB = await readFile(join(outputDir, "pageB/index.html"), "utf-8");
      const build1CSS = await readFile(join(outputDir, "css/global.css"));
      const build1JS = await readFile(join(outputDir, "js/global.js"));

      // Build 2: full rebuild with no changes
      await eleventy.write();
      const build2PageA = await readFile(join(outputDir, "pageA/index.html"), "utf-8");
      const build2PageB = await readFile(join(outputDir, "pageB/index.html"), "utf-8");
      const build2CSS = await readFile(join(outputDir, "css/global.css"));
      const build2JS = await readFile(join(outputDir, "js/global.js"));

      assert.equal(build2PageA, build1PageA, "pageA HTML should be identical across builds");
      assert.equal(build2PageB, build1PageB, "pageB HTML should be identical across builds");
      assert.deepEqual(build2CSS, build1CSS, "CSS bundle should be identical across builds");
      assert.deepEqual(build2JS, build1JS, "JS bundle should be identical across builds");
    });
  });
});
