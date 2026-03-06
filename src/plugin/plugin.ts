import type EleventyUserConfig from '@11ty/eleventy/src/UserConfig.js';
import { transform as transformCSS } from 'lightningcss';
import { transform as transformJS } from 'esbuild';

import { resolve, join } from 'node:path';
import { open } from 'node:fs/promises';

import { updateConfig, type YetiConfig } from '../config.ts';
import { logError } from '../log.ts';
import type { EleventyPageData, YetiPageComponent } from './types.ts';
import { YETI_NODE_TYPE } from '../html/types.ts';
import { isYetiNode } from '../html/utils.ts';
import { renderHTML } from '../html/renderHTML.ts';
import { processPageComponent } from './processPageComponent.ts';
import { parseHTML } from '../html/parseHTML.ts';
import { safeWriteFile } from '../utils/safeWriteFile.ts';

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

    await Promise.all([
      ...Object.entries(combinedCSSBundleContents).map(async ([bundleName, bundleContents]) => {
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

        const outputFilePath = config.css.deriveBundleFilePath(bundleName);

        const transformConfig = config.css.deriveBundleTransformConfig(bundleName, config.css.defaultBundleTransformConfig);
        const { code } = transformCSS({
          ...transformConfig,
          code: combinedCodeBytes,
          filename: outputFilePath,
        });

        await safeWriteFile(join(output, outputFilePath), code);
      }),
      ...Object.entries(combinedJSBundleContents).map(async ([bundleName, bundleContents]) => {
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

        const outputFilePath = config.js.deriveBundleFilePath(bundleName);

        const transformConfig = config.js.deriveBundleTransformConfig(bundleName, config.js.defaultBundleTransformConfig);
        const transformResult = await transformJS(combinedCodeBytes, transformConfig);

        await safeWriteFile(join(output, outputFilePath), transformResult.code);
      }),
      ...Object.entries(combinedHTMLImportPaths).map(async ([bundleName, importPaths]) => {
        const outputFilePath = config.html.deriveBundleFilePath(bundleName);

        // Open all file handles and stat them in parallel, then read sequentially into a pre-allocated buffer
        const fileEntries = await Promise.all(
          Array.from(importPaths).map(async (importPath) => {
            const fh = await open(importPath, "r");
            const { size } = await fh.stat();
            return { fh, size };
          })
        );
        const bundleByteLength = fileEntries.reduce((sum, { size }) => sum + size, 0);
        const combinedBundleBytes = new Uint8Array(bundleByteLength);
        try {
          let offset = 0;
          for (const { fh, size } of fileEntries) {
            await fh.read(combinedBundleBytes, offset, size);
            offset += size;
          }
        } finally {
          await Promise.all(fileEntries.map(({ fh }) => fh.close()));
        }

        const transformConfig = config.html.deriveBundleTransformConfig(bundleName, config.html.defaultBundleTransformConfig);
        let parsedBundleRootNode = await parseHTML(combinedBundleBytes);
        if (transformConfig.processNodeTree) {
          parsedBundleRootNode = await transformConfig.processNodeTree(parsedBundleRootNode);
          if (!isYetiNode(parsedBundleRootNode) || parsedBundleRootNode.type !== YETI_NODE_TYPE.ROOT) {
            throw new Error(`Expected processNodeTree function to return a YetiRootNode for bundle ${bundleName}. Received: ${JSON.stringify(parsedBundleRootNode)}`);
          }
        }

        const renderedHTML = renderHTML(parsedBundleRootNode, {
          indentation: transformConfig.minify ? null : "  ",
        });

        await safeWriteFile(join(output, outputFilePath), renderedHTML);
      }),
    ]);
  });
}