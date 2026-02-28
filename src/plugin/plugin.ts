import { resolve } from 'node:path';
import type EleventyUserConfig from '@11ty/eleventy/src/UserConfig.js';

import { updateConfig, type YetiConfig } from '../config.ts';
import { YETI_NODE_TYPE } from '../types.ts';
import { logError } from '../log.ts';
import { isYetiNode } from '../html/utils.ts';
import { processBundledAssets } from '../bundle/processBundledAssets.ts';
import type { EleventyPageData, YetiPageComponent } from './types.ts';
import { renderHTML } from 'src/html/renderHTML.ts';
import { mergeBundleCodeMaps } from 'src/bundle/mergeBundleContents.ts';

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
    },
    js: {
      minify: shouldMinifyJS,
      sourceMaps: shouldGenerateJSSourceMapsIfMinified,
      deriveBundleFilePath: deriveJSBundleFilePath,
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
  const globalExternalBundleContents = new Map<string, {
    css: Map<string, string>;
    js: Map<string, string>;
    html: Map<string, string>;
  }>();

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
        const rawRootNode = await pageComponent(data);
        if (!isYetiNode(rawRootNode) || rawRootNode.type !== YETI_NODE_TYPE.ROOT) {
          logError(`Error rendering page component for "${inputPath}": Expected component to return a YetiNode of type "ROOT". Page components must return an html template literal.`);
          return String(rawRootNode);
        }

        const {
          rootNode: processedRootNode,
          dependencies,
          externalBundleContents,
        } = await processBundledAssets(rawRootNode);

        globalExternalBundleContents.set(inputPath, externalBundleContents);

        this.addDependencies(inputPath, Array.from(dependencies.css).concat(Array.from(dependencies.js).concat(Array.from(dependencies.html))));

        return renderHTML(processedRootNode, {
          minify: shouldMinifyHTML,
        });
      };
    },
  });

  eleventyConfig.on("eleventy.after", async ({
    directories: { output }
  }: {
    directories: {
      output: string;
    }
  }) => {
    const mergedCSSBundleContentMap = new Map<string, string[]>();
    const mergedJSBundleContentMap = new Map<string, string[]>();
    const mergedHTMLBundleContentMap = new Map<string, string[]>();

    for (const [inputPath, bundleContentsMap] of globalExternalBundleContents) {
      mergeBundleCodeMaps(mergedCSSBundleContentMap, bundleContentsMap.css);
      mergeBundleCodeMaps(mergedJSBundleContentMap, bundleContentsMap.js);
      mergeBundleCodeMaps(mergedHTMLBundleContentMap, bundleContentsMap.html);
    }
  });
}