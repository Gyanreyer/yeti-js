import { resolve } from 'node:path';
import type EleventyUserConfig from '@11ty/eleventy/src/UserConfig.js';
import { transform as transformCSS, type TransformOptions as LightningCSSTransformOptions, type CustomAtRules } from 'lightningcss';

import { updateConfig, type YetiConfig } from '../config.ts';
import { logError } from '../log.ts';
import type { EleventyPageData, YetiPageComponent } from './types.ts';
import { YETI_NODE_TYPE } from '../html/types.ts';
import { isYetiNode } from '../html/utils.ts';
import { renderHTML } from '../html/renderHTML.ts';
import { processPageComponent } from './processPageComponent.ts';
import { writeFile } from 'node:fs/promises';

export const yetiPlugin = (eleventyConfig: EleventyUserConfig, userConfig: Partial<YetiConfig> = {}) => {
  // Update the Yeti config with any user-provided values
  const {
    pageTemplateFileExtension,
    html: {
      minify: shouldMinifyHTML,
      deriveBundleFilePath: deriveHTMLBundleFilePath,
    },
    css: {
      minify: shouldMinifyCSS,
      sourceMaps: shouldGenerateCSSSourceMapsIfMinified,
      deriveBundleFilePath: deriveCSSBundleFilePath,
      deriveBundleTransformConfig: deriveCSSBundleTransformConfig,
    },
    js: {
      minify: shouldMinifyJS,
      sourceMaps: shouldGenerateJSSourceMapsIfMinified,
      deriveBundleFilePath: deriveJSBundleFilePath,
      deriveBundleTransformConfig: deriveJSBundleTransformConfig,
    },
  } = updateConfig(userConfig);

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
  });

  eleventyConfig.addTemplateFormats(pageTemplateFileExtension);

  // Maps input paths to the external CSS/JS/HTML content which we should gather into bundles in the "eleventy.after" hook
  // and write to files.
  const globalExternalBundleContents: {
    [inputPath: string]: {
      css: Map<string, Set<Uint8Array<ArrayBufferLike>>>;
      js: Map<string, Set<Uint8Array>>;
      htmlImportPaths: Map<string, Set<string>>;
    };
  } = {};

  eleventyConfig.addExtension([pageTemplateFileExtension], {
    key: pageTemplateFileExtension,
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
          minify: shouldMinifyHTML,
        });
      };
    },
  });

  const bundleFileHashes: {
    [bundleFilePath: string]: string;
  } = {};

  eleventyConfig.on("eleventy.after", async ({
    directories: { output }
  }: {
    directories: {
      output: string;
    }
  }) => {
    const combinedCSSBundleContents: {
      [bundleName: string]: Set<Uint8Array>;
    } = {};
    const combinedJSBundleContents: {
      [bundleName: string]: Set<Uint8Array>;
    } = {};
    const combinedHTMLImportPaths: {
      [bundleName: string]: Set<string>;
    } = {};

    for (const { css, js, htmlImportPaths } of Object.values(globalExternalBundleContents)) {
      // Combine the contents of the bundles with the same name across different pages so we can transform
      // and write them out as single bundles in the output directory
      for (const [bundleName, bundleContents] of css) {
        combinedCSSBundleContents[bundleName] ??= new Set();
        for (const bundleContent of bundleContents) {
          combinedCSSBundleContents[bundleName].add(bundleContent);
        }
      }
      for (const [bundleName, bundleContents] of js) {
        combinedJSBundleContents[bundleName] ??= new Set();
        for (const bundleContent of bundleContents) {
          combinedJSBundleContents[bundleName].add(bundleContent);
        }
      }
      for (const [bundleName, importPaths] of htmlImportPaths) {
        combinedHTMLImportPaths[bundleName] ??= new Set();
        for (const importPath of importPaths) {
          combinedHTMLImportPaths[bundleName].add(importPath);
        }
      }
    }

    for (const [bundleName, bundleContents] of Object.entries(combinedCSSBundleContents)) {
      let combinedContentsByteSize = 0;
      for (const content of bundleContents) {
        combinedContentsByteSize += content.byteLength;
      }

      const combinedCodeBytes = new Uint8Array(combinedContentsByteSize);
      let offset = 0;
      for (const content of bundleContents) {
        combinedCodeBytes.set(content, offset);
        offset += content.byteLength;
      }

      const outputFilePath = deriveCSSBundleFilePath(bundleName);

      const { code } = transformCSS(Object.assign({
        code: combinedCodeBytes,
        filename: outputFilePath,
        minify: shouldMinifyCSS,
      } satisfies LightningCSSTransformOptions<CustomAtRules>, deriveCSSBundleTransformConfig?.(bundleName)));

      await writeFile(resolve(output, outputFilePath), code);
    }
  });
}