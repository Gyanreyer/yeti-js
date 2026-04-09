import type EleventyUserConfig from '@11ty/eleventy/UserConfig';

import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { updateConfig, type YetiConfig } from '../config.ts';
import { logError } from '../log.ts';
import type { EleventyPageData, YetiPageComponent } from './types.ts';
import { YETI_NODE_TYPE } from '../html/types.ts';
import { isYetiNode } from '../html/utils.ts';
import { renderHTML } from '../html/renderHTML.ts';
import { processPageComponent } from './processPageComponent.ts';
import {
  resetUsedExternalSpecifiers,
  buildAndWriteExternalDependencies,
} from '../js/externalDependencies.ts';
import { mergeBundleSetMaps } from '../bundle/mergeBundleContents.ts';
import {
  processAndWriteExternalCSSBundle,
  processAndWriteExternalJSBundle,
  processAndWriteExternalHTMLBundle,
} from './processExternalBundles.ts';

export const yetiPlugin = (eleventyConfig: EleventyUserConfig, userConfig: Partial<YetiConfig> = {}) => {
  // Update the Yeti config with any user-provided values
  const config = updateConfig(userConfig);

  eleventyConfig.on("eleventy.before", async ({
    inputDir,
    directories: {
      // These directory paths are relative to `inputDir`
      input: relativeInputDir,
      output: relativeOutputDir,
    },
  }: {
    inputDir: string;
    directories: {
      input: string;
      output: string;
    };
  }) => {
    updateConfig({
      inputDir: resolve(inputDir, relativeInputDir),
      outputDir: resolve(inputDir, relativeOutputDir),
      quietMode: eleventyConfig.quietMode,
      ...userConfig,
    });

    resetUsedExternalSpecifiers();
  });

  eleventyConfig.addTemplateFormats(config.pageTemplateFileExtension);

  // Maps input paths to the external CSS/JS/HTML content which we should gather into bundles in the "eleventy.after" hook
  // and write to files.
  const globalExternalBundleContents: {
    [inputPath: string]: {
      css: Map<string, Set<Uint8Array<ArrayBufferLike>>>;
      js: Map<string, Set<Uint8Array>>;
      htmlImportPaths: Map<string, Set<string>>;
    };
  } = {};

  eleventyConfig.addExtension(config.pageTemplateFileExtension, {
    useJavaScriptImport: true,
    async getInstanceFromInputPath(inputPath: string) {
      const mod = await import(
        // 11ty makes input paths relative to cwd
        resolve(process.cwd(), inputPath)
      );
      return {
        pageComponent: mod.default,
        config: mod.config,
      }
    },
    getData: ["config"],
    compile(this: {
      addDependencies: (input: string, dependencies: string[]) => void;
    }, { pageComponent }: { pageComponent: YetiPageComponent }, inputPath: string) {
      return async (data: EleventyPageData) => {
        const {
          pageRootNode,
          dependencies,
          externalBundles,
        } = await processPageComponent(pageComponent, data);
        if (!isYetiNode(pageRootNode) || pageRootNode.type !== YETI_NODE_TYPE.ROOT) {
          logError(`Error rendering page component for "${inputPath}": Expected component to return a YetiNode of type "ROOT". Page components must return an html template literal.`);
          return String(pageRootNode);
        }

        this.addDependencies(inputPath, Array.from(dependencies));
        globalExternalBundleContents[inputPath] = externalBundles;

        return renderHTML(pageRootNode, {
          indentation: config.html.minify ? null : "  ",
        });
      };
    },
  });

  eleventyConfig.on("eleventy.after", async ({
    directories: { output },
    results,
  }: {
    directories: {
      output: string;
    };
    results: Array<{ outputPath: string }>;
  }) => {
    // Combine the contents of the bundles with the same name across different pages so we can transform
    // and write them out as single bundles in the output directory
    const combinedCSSBundleContents = new Map<string, Set<Uint8Array>>();
    const combinedJSBundleContents = new Map<string, Set<Uint8Array>>();
    const combinedHTMLImportPaths = new Map<string, Set<string>>();

    for (const { css, js, htmlImportPaths } of Object.values(globalExternalBundleContents)) {
      mergeBundleSetMaps(combinedCSSBundleContents, css);
      mergeBundleSetMaps(combinedJSBundleContents, js);
      mergeBundleSetMaps(combinedHTMLImportPaths, htmlImportPaths);
    }

    // Map of placeholder token → content hash, populated as bundles are transformed and written
    const bundleContentHashes = new Map<string, string>();

    await Promise.all([
      ...Array.from(combinedCSSBundleContents, ([bundleName, bundleContents]) =>
        processAndWriteExternalCSSBundle(bundleName, bundleContents, output, config, bundleContentHashes)
      ),
      ...Array.from(combinedJSBundleContents, ([bundleName, bundleContents]) =>
        processAndWriteExternalJSBundle(bundleName, bundleContents, output, config, bundleContentHashes)
      ),
      ...Array.from(combinedHTMLImportPaths, ([bundleName, importPaths]) =>
        processAndWriteExternalHTMLBundle(bundleName, importPaths, output, config, bundleContentHashes)
      ),
    ]);

    // Rewrite page HTML files to replace bundle version placeholder tokens with actual content hashes.
    if (bundleContentHashes.size > 0) {
      await Promise.all(
        results.map(async ({ outputPath }) => {
          let htmlContent = await readFile(outputPath, "utf-8");
          const originalLength = htmlContent.length;
          for (const [placeholder, hash] of bundleContentHashes) {
            htmlContent = htmlContent.replaceAll(placeholder, hash);
          }
          if (htmlContent.length !== originalLength) {
            // Any replacements will change the length of the content
            // (hashes are 8 characters, the static contents of placeholder strings alone are at least 12 characters)
            // So we can use that as a faster heuristic for whether we have changes that need to be written
            await writeFile(outputPath, htmlContent);
          }
        })
      );
    }

    // Build and write external dependency bundles
    if (config.js.externalDependencies) {
      await buildAndWriteExternalDependencies(config.js.externalDependencies, output);
    }
  });
}