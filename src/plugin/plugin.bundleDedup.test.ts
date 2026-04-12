import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { glob, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { Eleventy } from "@11ty/eleventy";
import type EleventyUserConfig from "@11ty/eleventy/UserConfig";

import { yetiPlugin } from "./plugin.ts";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../test_data/sharedBundleImports");

const buildFixture = async (fixtureName: string) => {
  const inputDir = resolve(FIXTURE_ROOT, fixtureName);
  const outputDir = resolve(inputDir, "_site");

  await rm(outputDir, { recursive: true, force: true }).catch(() => { });

  const eleventy = new Eleventy(inputDir, outputDir, {
    config(eleventyConfig: EleventyUserConfig) {
      eleventyConfig.addPlugin(yetiPlugin, {
        // Disable minification so generated output is easier to inspect.
        js: { defaultBundleTransformConfig: { minify: false } },
        css: { defaultBundleTransformConfig: { minify: false } },
        html: { minify: false, defaultBundleTransformConfig: { minify: false } },
      });
      eleventyConfig.setQuietMode(true);
    },
  });

  await eleventy.write();
  return outputDir;
};

const countOccurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) {
    throw new Error("countOccurrences called with empty needle");
  }
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
};

describe("Yeti Plugin — shared bundle import dedup", () => {
  test("two pages importing the same JS file with a named export build successfully and dedupe", async () => {
    const outputDir = await buildFixture("twoPageSharedJSImport");

    // Both pages should have been written.
    const htmlFilePaths = (await Array.fromAsync(glob(`${outputDir}/**/*.html`))).map((f) =>
      f.slice(outputDir.length + 1),
    );
    assert.deepStrictEqual(htmlFilePaths.sort(), ["pageA/index.html", "pageB/index.html"]);

    const globalJs = await readFile(resolve(outputDir, "js/global.js"), "utf-8");

    // shared.js's contents should appear exactly once in the merged bundle.
    assert.equal(
      countOccurrences(globalJs, "hello-from-shared-js"),
      1,
      `Expected shared.js content to appear exactly once in global.js, but found ${countOccurrences(globalJs, "hello-from-shared-js")} occurrences.\n\nglobal.js contents:\n${globalJs}`,
    );
  });

  test("two pages importing the same CSS file dedupe in the merged CSS bundle", async () => {
    const outputDir = await buildFixture("twoPageSharedCSSImport");

    const globalCss = await readFile(resolve(outputDir, "css/global.css"), "utf-8");

    // We use @font-face here because lightningcss's transform pass dedupes identical
    // simple rules but does NOT dedupe @font-face declarations, so a stale bug would
    // produce two @font-face blocks in the merged output.
    assert.equal(
      countOccurrences(globalCss, "shared-marker-font"),
      1,
      `Expected shared.css's @font-face declaration to appear exactly once in global.css, but found ${countOccurrences(globalCss, "shared-marker-font")} occurrences.\n\nglobal.css contents:\n${globalCss}`,
    );
  });

  test("three pages with mixed sharing produce a bundle containing each shared module exactly once", async () => {
    const outputDir = await buildFixture("threePageMixedSharing");

    const globalJs = await readFile(resolve(outputDir, "js/global.js"), "utf-8");

    assert.equal(
      countOccurrences(globalJs, "value-from-x-module"),
      1,
      `Expected x.js content to appear exactly once. global.js:\n${globalJs}`,
    );
    assert.equal(
      countOccurrences(globalJs, "value-from-y-module"),
      1,
      `Expected y.js content to appear exactly once. global.js:\n${globalJs}`,
    );
  });

  test("shared imports dedupe while per-page raw template content is preserved", async () => {
    const outputDir = await buildFixture("sharedImportWithPerPageRawContent");

    const globalJs = await readFile(resolve(outputDir, "js/global.js"), "utf-8");

    assert.equal(
      countOccurrences(globalJs, "hello-from-shared-js"),
      1,
      `Expected shared.js content to appear exactly once. global.js:\n${globalJs}`,
    );
    assert.equal(
      countOccurrences(globalJs, "PageA-only-marker"),
      1,
      `Expected PageA's raw content to be preserved exactly once. global.js:\n${globalJs}`,
    );
    assert.equal(
      countOccurrences(globalJs, "PageB-only-marker"),
      1,
      `Expected PageB's raw content to be preserved exactly once. global.js:\n${globalJs}`,
    );
  });

  test("a single page importing two entry points that share a transitive dep dedupes that dep", async () => {
    const outputDir = await buildFixture("intraPageSharedTransitiveDep");

    const globalJs = await readFile(resolve(outputDir, "js/global.js"), "utf-8");

    // The helper module's body should appear exactly once even though both a.js and b.js import it.
    assert.equal(
      countOccurrences(globalJs, "intra-page-shared-helper-called-by"),
      1,
      `Expected helper.js to be deduped within a single page bundle. global.js:\n${globalJs}`,
    );
  });
});
