import {
  beforeEach,
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";

import {
  Eleventy
} from "@11ty/eleventy";
import yetiPlugin from "../../src/plugin.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";


/**
 * @import UserConfig from '@11ty/eleventy/src/UserConfig.js';
 * @import { YetiConfig } from '../../src/config.js';
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
      eleventyConfig.addPlugin(yetiPlugin, config);
    },
  });
  return eleventy;
}

/**
 * @param {string} inputDir
 */
const testInputDir = async (inputDir) => {
  const siteOutputDir = resolve(inputDir, "_site");
  // Clean up the output directory from any previous test runs
  await rm(siteOutputDir, {
    recursive: true,
    force: true,
  }).catch(() => {
    // Ignore errors
  });

  const expectedOutputDir = resolve(inputDir, "_expected");

  const eleventy = getEleventyInstance(inputDir, siteOutputDir);
  await eleventy.write();
  const actualSiteFiles = await readdir(siteOutputDir, {
    recursive: true,
  });
  const expectedSiteFiles = await readdir(expectedOutputDir, {
    recursive: true,
  });

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
    await testInputDir(fileURLToPath(import.meta.resolve("./simplePage")));
  });
});