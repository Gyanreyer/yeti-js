import type { CustomAtRules, TransformOptions as LightningCSSTransformOptions } from 'lightningcss';
import type { TransformOptions as EsbuildTransformOptions } from 'esbuild';

import type { YetiNode, YetiRootNode } from './html/types.ts';
import type { DeepPartial } from './utils/utilityTypes.ts';

export type JSBundleTransformConfig = Omit<EsbuildTransformOptions, "sourcefile" | "sourcesContent" | "sourceRoot">;
export type CSSBundleTransformConfig = Omit<LightningCSSTransformOptions<CustomAtRules>, "code" | "filename" | "inputSourceMap" | "analyzeDependencies">;
export type HTMLBundleTransformConfig = {
  minify: boolean;
  /**
   * Object to map bundle names to functions to process and transform parsed HTML bundle nodes before final rendering.
   * These functions will be called for each HTML bundle matching the key name before it's inserted into the final output,
   * allowing you to modify the HTML tree structure.
   * You may also use a special wildcard "*" key to specify a function that will be called for all bundles,
   * which can be useful for applying generic transformations to all bundles or for processing bundles
   * without explicitly referencing them by name.
   *
   * This is useful for transformations like:
   * - Converting `<svg>` elements into `<symbol>` elements for SVG sprite generation
   * - Adding vendor prefixes to inline styles
   * - Transforming or filtering specific elements
   * - Adding wrapper elements or attributes
   *
   * @example Converting SVG elements to symbols for sprite generation
   * ```ts
   * import { YETI_NODE_TYPE } from 'yeti-js';
   *
   * eleventyConfig.addPlugin(yetiPlugin, {
   *   html: {
   *     deriveBundleTransformConfig: (bundleName, defaultConfig) => {
   *       if(bundleName === "svg-sprites") {
   *         return {
   *          ...defaultConfig,
   *          processNodeTree: (rootNode) => {
   *            // Transform each <svg> element into a <symbol> for sprite usage
   *            for (const child of rootNode.children) {
   *              if (child.type === YETI_NODE_TYPE.ELEMENT && child.tagName === 'svg') {
   *                child.tagName = 'symbol';
   *                // Remove xmlns as it's not needed on symbol
   *                if (child.attributes?.xmlns) {
   *                  delete child.attributes.xmlns;
   *                }
   *              }
   *            }
   *            return rootNode;
   *           }
   *         };
   *       }
   *
   *       return defaultConfig;
   *     },
   *   },
   * });
   * ```
   */
  processNodeTree?: (rootNode: YetiRootNode) => YetiRootNode | Promise<YetiRootNode>;
};

export type YetiConfig = {
  /**
   * The directory where the site's source files are located.
   * You should not need to set this directly as we will infer it from your 11ty project.
   */
  inputDir: string;
  /**
   * The directory where the built site will be output.
   * You should not need to set this directly as we will infer it from your 11ty project.
   */
  outputDir: string;
  /**
   * Whether to suppress non-error logging output from the Yeti plugin.
   * You should not need to set this directly as we will infer it from your 11ty project;
   * set quiet mode with `eleventyConfig.setQuietMode(true)` instead.
   */
  quietMode: boolean;
  /**
   * Config for JavaScript bundling and output.
   */
  js: {
    /**
     * The default global JS bundle name to use when no bundle name is specified.
     * @default "global"
     */
    defaultBundleName: string;
    /**
     * Function to derive custom file paths for where external JavaScript bundle files should be written.
     * This function will be called for each bundle with a JavaScript bundle name,
     * and should return a string representing the path relative to the site's `outputDir`
     * where the bundle should be written.
     * If not provided, bundle file names will default to `/js/${bundleName}.js`.
     * Leading slashes are optional.
     *
     * @param {string} bundleName - The name of the bundle
     *
     * @example
     * ```ts
     * eleventyConfig.addPlugin(yetiPlugin, {
     *   js: {
     *     // Bundle files should go in the "assets/js" directory and have a `.bundle.js` suffix
     *     deriveBundleFilePath: (bundleName) => `assets/js/${bundleName}.bundle.js`,
     *   },
     * });
     * ```
     */
    deriveBundleFilePath: (bundleName: string) => string;
    /**
     * Default esbuild transform config to use when processing JavaScript bundles, which can be overridden on a per-bundle basis with `deriveBundleTransformConfig`.
     * This allows you to specify custom esbuild transform options like minification, target environments, and more.
     * If not provided, bundles will be minified by default.
     */
    defaultBundleTransformConfig: JSBundleTransformConfig;
    deriveBundleTransformConfig: (bundleName: string, defaultConfig: JSBundleTransformConfig) => JSBundleTransformConfig;
  };
  css: {
    /**
     * The default global CSS bundle name to use when no bundle name is specified.
     * @default "global"
     */
    defaultBundleName: string;
    /**
     * Function to derive custom file paths for where external CSS bundle files should be written.
     * This function will be called for each bundle with a CSS bundle name,
     * and should return a string representing the path relative to the site's `outputDir`
     * where the bundle should be written.
     * If not provided, bundle file names will default to `/css/${bundleName}.css`.
     * Leading slashes are optional.
     *
     * @param {string} bundleName - The name of the bundle
     *
     * @example
     * ```ts
     * eleventyConfig.addPlugin(yetiPlugin, {
     *   css: {
     *     // Bundle files should go in the "assets/css" directory and have a `.bundle.css` suffix
     *     deriveBundleFilePath: (bundleName) => `assets/css/${bundleName}.bundle.css`,
     *   },
     * });
     * ```
     */
    deriveBundleFilePath: (bundleName: string) => string;
    defaultBundleTransformConfig: CSSBundleTransformConfig;
    deriveBundleTransformConfig: (bundleName: string, defaultConfig: CSSBundleTransformConfig) => CSSBundleTransformConfig;
  };
  html: {
    /**
     * Whether the page HTML output should be minified.
     * 
     * @default true
     */
    minify: boolean;
    /**
     * Function to derive custom file paths for where external HTML bundle files should be written.
     * This function will be called for each bundle with a HTML bundle name,
     * and should return a string representing the path relative to the site's `outputDir`
     * where the bundle should be written.
     * If not provided, bundle file names will default to `/html/${bundleName}.html`.
     * Leading slashes are optional.
     *
     * @param {string} bundleName - The name of the bundle
     *
     * @example
     * ```ts
     * eleventyConfig.addPlugin(yetiPlugin, {
     *   html: {
     *     // "spritesheet" bundle should get a `.svg` extension instead of the default `.html`
     *     deriveBundleFilePath: (bundleName) => bundleName === "spritesheet" ? `/icons/spritesheet.svg` : `/html/${bundleName}.html`,
     *   },
     * });
     * ```
     */
    deriveBundleFilePath: (bundleName: string) => string;
    defaultBundleTransformConfig: HTMLBundleTransformConfig;
    deriveBundleTransformConfig: (bundleName: string, defaultConfig: HTMLBundleTransformConfig) => HTMLBundleTransformConfig;
    /**
     * Hook to apply custom processing to the raw content of directly imported files (i.e. `html.import()` calls without a `bundleName`).
     * Called with the resolved file path and raw file content string before the content is parsed as HTML.
     * Return a transformed string which will be used in place of the raw file content.
     *
     * This is useful for pre-processing files in formats other than HTML, such as Markdown.
     *
     * @param {string} importPath - The absolute resolved path of the imported file
     * @param {string} content - The raw content of the imported file
     * @returns {string | Promise<string>} The transformed content to use instead
     *
     * @example Parsing Markdown imports as HTML
     * ```ts
     * import { marked } from 'marked';
     *
     * eleventyConfig.addPlugin(yetiPlugin, {
     *   html: {
     *     processImport: (importPath, content) => {
     *       if (importPath.endsWith('.md')) {
     *         return marked.parse(content);
     *       }
     *       return content;
     *     },
     *   },
     * });
     * ```
     */
    processImport?: (importPath: string, content: string) => string | YetiRootNode | Promise<string | YetiNode>;
  };
  /**
   * The file extension used for Yeti page template files.
   * @default [".page.js", ".page.ts"]
   */
  pageTemplateFileExtension: string | string[];
}

export type PartialYetiConfig = DeepPartial<YetiConfig>;

const config: YetiConfig = {
  inputDir: "",
  outputDir: "",
  js: {
    defaultBundleName: "global",
    defaultBundleTransformConfig: {
      minify: true,
    },
    deriveBundleTransformConfig: (bundleName, defaultConfig) => defaultConfig,
    deriveBundleFilePath: (bundleName) => `/js/${bundleName}.js`,
  },
  css: {
    defaultBundleName: "global",
    defaultBundleTransformConfig: {
      minify: true,
    },
    deriveBundleTransformConfig: (bundleName, defaultConfig) => defaultConfig,
    deriveBundleFilePath: (bundleName) => `/css/${bundleName}.css`,
  },
  html: {
    minify: true,
    defaultBundleTransformConfig: {
      minify: true,
    },
    deriveBundleTransformConfig: (bundleName, defaultConfig) => defaultConfig,
    deriveBundleFilePath: (bundleName) => `/html/${bundleName}.html`,
  },
  pageTemplateFileExtension: ["page.js", "page.ts"],
  quietMode: false,
};

const isObject = (value: unknown): value is Record<string, any> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deeply merges two config objects, with values from the new config taking precedence over the base config.
 */
const mergeConfigs = <T extends Record<string, any>>(baseConfig: T, newConfig: DeepPartial<T>): T => {
  const mergedConfig = { ...baseConfig };
  for (const key in newConfig) {
    const newValue = newConfig[key] as any;
    const baseValue = baseConfig[key];
    if (isObject(newValue) && isObject(baseValue)) {
      mergedConfig[key] = mergeConfigs(baseValue, newValue);
    } else {
      mergedConfig[key] = newValue;
    }
  }
  return mergedConfig;
};

/**
 * Merges new config settings into the base Yeti config.
 */
export const updateConfig = (newConfig: PartialYetiConfig) => {
  const merged = mergeConfigs(config, newConfig);
  return Object.assign(config, merged);
};

export const getConfig = () => config;