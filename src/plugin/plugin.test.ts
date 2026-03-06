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
import type UserConfig from '@11ty/eleventy/src/UserConfig.js';

import type { HTMLBundleTransformConfig, YetiConfig } from '../config.ts';
import type { DeepPartial } from '../utils/utilityTypes.ts';
import { YETI_NODE_TYPE, type YetiRootNode, type YetiElementNode } from "../html/types.ts";

import { yetiPlugin } from "./plugin.ts";

/**
 * @param {string} inputDir
 * @param {string} outputDir
 * @param {DeepPartial<YetiConfig>} [config]
 */
const getEleventyInstance = (inputDir: string, outputDir: string, config: DeepPartial<YetiConfig> = {}) => {
  const eleventy = new Eleventy(inputDir, outputDir, {
    /**
     * @param {UserConfig} eleventyConfig
     */
    config(eleventyConfig: UserConfig) {
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
const testInputDir = async (inputDirPath: string, config: DeepPartial<YetiConfig> = {}) => {
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

  const eleventy = getEleventyInstance(resolvedInputDir, siteOutputDir, {
    js: {
      defaultBundleTransformConfig: {
        minify: false,
      },
    },
    css: {
      defaultBundleTransformConfig: {
        minify: false,
      },
    },
    html: {
      minify: false,
      defaultBundleTransformConfig: {
        minify: false,
      },
    },
    ...config,
  });
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
    await testInputDir("../../test_data/simplePage");
  });

  test("Page with Bundle Imports", async () => {
    await testInputDir("../../test_data/pageWithBundleImports");
  });

  test("Pages with Components", async () => {
    await testInputDir("../../test_data/pagesWithComponents");
  });

  test("Page with HTML Bundle Inline", async () => {
    await testInputDir("../../test_data/pageWithHTMLBundleInline");
  });

  test("SVG sprite sheets with HTML bundle transform", async () => {
    await testInputDir("../../test_data/svgSpriteSheet", {
      html: {
        minify: false,
        deriveBundleFilePath: (bundleName: string) => {
          if (bundleName === "icons") {
            return "/assets/icons.svg";
          }
        },
        defaultBundleTransformConfig: {
          minify: false,
        },
        deriveBundleTransformConfig: (bundleName: string, defaultConfig: HTMLBundleTransformConfig) => {
          if (bundleName === "icons") {
            return {
              ...defaultConfig,
              processNodeTree: (rawRootNode: YetiRootNode) => {
                const defsElement: YetiElementNode = {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "defs",
                  attributes: {},
                  children: [],
                };

                for (const childNode of rawRootNode.children) {
                  if (childNode.type === YETI_NODE_TYPE.ELEMENT && childNode.tagName === "svg") {
                    defsElement.children!.push({
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: "symbol",
                      attributes: {
                        viewBox: childNode.attributes?.viewBox,
                        id: childNode.attributes?.id,
                      },
                      children: childNode.children,
                    });
                  }
                }

                return {
                  type: YETI_NODE_TYPE.ROOT,
                  children: [{
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "svg",
                    attributes: {
                      xmlns: "http://www.w3.org/2000/svg",
                    },
                    children: [defsElement],
                  }],
                };
              },
            };
          }
        },
      },
    });
  });
});