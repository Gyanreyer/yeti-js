import {
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { glob, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Eleventy
} from "@11ty/eleventy";

import { yetiPlugin } from "../../src/index.js";

/**
 * @import UserConfig from '@11ty/eleventy/src/UserConfig.js';
 * @import { YetiConfig } from '../../src/types.js';
 */

/**
 * @param {string} inputDir
 * @param {string} outputDir
 * @param {Partial<YetiConfig>} [config]
 */
const getEleventyInstance = (inputDir, outputDir, config = {}) => {
  const eleventy = new Eleventy(inputDir, outputDir, {
    /**
     * @param {UserConfig} eleventyConfig
     */
    config(eleventyConfig) {
      eleventyConfig.ignores.add("**/_expected/**");
      eleventyConfig.ignores.add("**/*.html");
      eleventyConfig.addPlugin(yetiPlugin, config);
      eleventyConfig.setQuietMode(true);
    },
  });
  return eleventy;
}

/**
 * @param {string} inputDirPath
 */
const testInputDir = async (inputDirPath) => {
  const resolvedInputDir = fileURLToPath(import.meta.resolve(inputDirPath));
  const siteOutputDir = resolve(
    resolvedInputDir,
    "_site",
  );
  // Clean up the output directory from any previous test runs
  await rm(siteOutputDir, {
    recursive: true,
    force: true,
  }).catch(() => {
    // Ignore errors
  });

  const expectedOutputDir = resolve(resolvedInputDir, "_expected");

  const eleventy = getEleventyInstance(resolvedInputDir, siteOutputDir);
  await eleventy.write();
  const actualSiteFiles = (await Array.fromAsync(glob(`${siteOutputDir}/**/*.*`))).map((filePath) =>
    filePath.slice(siteOutputDir.length + 1),
  );
  const expectedSiteFiles = await (await Array.fromAsync(glob(`${expectedOutputDir}/**/*.*`))).map((filePath) =>
    filePath.slice(expectedOutputDir.length + 1),
  );

  assert.deepStrictEqual(actualSiteFiles.sort(), expectedSiteFiles.sort());

  for (const fileName of actualSiteFiles) {
    const fileContents = await readFile(
      resolve(siteOutputDir, fileName),
      "utf-8",
    );
    const expectedFileContents = await readFile(
      resolve(expectedOutputDir, fileName),
      "utf-8",
    );
    assert.deepStrictEqual(fileContents, expectedFileContents, `File ${fileName} should match expected output`);
  }
};

describe("Yeti Plugin", () => {
  test("Simple Page", async () => {
    await testInputDir("./simplePage");
  });

  test("Page with Bundle Imports", async () => {
    await testInputDir("./pageWithBundleImports");
  });

  test("Pages with Components", async () => {
    await testInputDir("./pagesWithComponents");
  });

  test("Page with HTML Bundle Inline", async () => {
    await testInputDir("./pageWithHTMLBundleInline");
  });
});