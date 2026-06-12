import type { CustomAtRules, TransformOptions as LightningCSSTransformOptions } from 'lightningcss';
import type { TransformOptions as EsbuildTransformOptions } from 'esbuild';
import { join, relative, resolve, sep } from 'node:path';

import type { YetiNode, YetiRootNode } from './html/types.ts';
import type { DeepPartial } from './utils/utilityTypes.ts';
import type { PageContext } from './plugin/types.ts';
import { YetiConfigError } from './error.ts';
import { logWarning } from './log.ts';

/**
 * Compute the default per-page bundle file path. Resolves the page's `inputPath` against the
 * current working directory (Eleventy passes it as a cwd-relative string), then computes its
 * path relative to the configured `inputDir`. Any registered page template extension is
 * stripped, and the result is prepended with the asset's `_pages` directory.
 *
 * For example, with input dir `src` and template extension `page.ts`:
 *   `./src/blog/post.page.ts` → `/{assetType}/_pages/blog/post.{assetType}`
 */
const defaultDerivePageBundleFilePath = (page: PageContext, assetType: "css" | "js" | "html"): string => {
  // Get the input path relative to our config input dir
  // config.inputDir is absolute but page.inputPath is relative to the cwd,
  // so we'll resolve inputPath to an absolute path first
  let relativePath = relative(config.inputDir, resolve(page.inputPath));

  // Bundle paths are URL paths and always use forward slashes, so normalize away any
  // platform-specific separators that `path.relative` might have returned.
  if (sep !== "/") {
    relativePath = relativePath.replaceAll(sep, "/");
  }

  const extensions = Array.isArray(config.pageTemplateFileExtension)
    ? config.pageTemplateFileExtension
    : [config.pageTemplateFileExtension];

  // Strip the page template extension from the end of the path
  for (const ext of extensions) {
    const suffix = `.${ext}`;
    if (relativePath.endsWith(suffix)) {
      relativePath = relativePath.slice(0, -suffix.length);
      break;
    }
  }

  return `/${assetType}/_pages/${relativePath}.${assetType}`;
};

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
     * Function to derive the file path where a page-scoped JS bundle (`@page`) should be written.
     * Called once per page (or template — pagination variants of the same template share a bundle file).
     * Must produce a unique path per template input path; otherwise pages with the same derived path
     * will overwrite each other's bundle files.
     *
     * Derive the path only from *template-constant* fields (`inputPath`, `fileSlug`, `filePathStem`).
     * Pagination variants of one template share a single `@page` bundle file, so a deriver that keys
     * off a *per-page* field (`url`, `outputPath`, `date`) would make each variant reference a
     * different path while only one file is written — the other variants would then 404. Yeti logs a
     * warning if it detects this, but the safest choice is to never key off per-page fields here.
     *
     * If not provided, the default derives the path from the template's `inputPath`, stripping the
     * input dir prefix and the page template extension, then prepending `/js/_pages/` and appending
     * `.js`. For example, `src/blog/post.page.ts` becomes `/js/_pages/blog/post.js`.
     *
     * @param {PageContext} pageData - Data from 11ty describing the page being built,
     *                                  including the page's input path, output path, URL, file slug, and more.
     */
    derivePageBundleFilePath: (pageData: PageContext) => string;
    /**
     * Default esbuild transform config to use when processing JavaScript bundles, which can be overridden on a per-bundle basis with `deriveBundleTransformConfig`.
     * This allows you to specify custom esbuild transform options like minification, target environments, and more.
     * If not provided, bundles will be minified by default.
     */
    defaultBundleTransformConfig: JSBundleTransformConfig;
    deriveBundleTransformConfig: (bundleName: string, defaultConfig: JSBundleTransformConfig) => JSBundleTransformConfig;
    /**
     * Configure dependencies that should be bundled separately from your application code.
     * Instead of duplicating dependency code in every bundle that uses it, each external dependency
     * is bundled once into its own file, and imports are rewritten to reference that file.
     *
     * Keys are glob patterns matched against import specifiers using `path.matchesGlob()`.
     * A plain string like `"alpinejs"` matches exactly that specifier.
     *
     * Values determine where the bundled output is written:
     * - **File path** (no trailing `/`): The dependency is bundled into a single file at that path.
     *   If the pattern matches more than one specifier, an error is thrown.
     * - **Directory path** (trailing `/`): All matched specifiers are built together with esbuild
     *   code splitting. Each specifier gets its own entry file in the directory, with shared code
     *   extracted into chunk files.
     *
     * @example
     * ```ts
     * eleventyConfig.addPlugin(yetiPlugin, {
     *   js: {
     *     externalDependencies: {
     *       // Single specifier → single file
     *       "alpinejs": "/js/ext/alpine.js",
     *       // Multiple specifiers → code-split output directory
     *       "{lit,lit/**}": "/js/ext/",
     *     }
     *   }
     * });
     * ```
     */
    externalDependencies?: Record<string, string>;
  };
  css: {
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
    /**
     * Function to derive the file path where a page-scoped CSS bundle (`@page`) should be written.
     * Called once per page (or template — pagination variants of the same template share a bundle file).
     * Must produce a unique path per template input path; otherwise pages with the same derived path
     * will overwrite each other's bundle files.
     *
     * Derive the path only from *template-constant* fields (`inputPath`, `fileSlug`, `filePathStem`).
     * Pagination variants of one template share a single `@page` bundle file, so a deriver that keys
     * off a *per-page* field (`url`, `outputPath`, `date`) would make each variant reference a
     * different path while only one file is written — the other variants would then 404. Yeti logs a
     * warning if it detects this, but the safest choice is to never key off per-page fields here.
     *
     * If not provided, the default derives the path from the template's `inputPath`, stripping the
     * input dir prefix and the page template extension, then prepending `/css/_pages/` and appending
     * `.css`. For example, `src/blog/post.page.ts` becomes `/css/_pages/blog/post.css`.
     *
     * @param {PageContext} pageData - Data from 11ty describing the page being built,
     *                                  including the page's input path, output path, URL, file slug, and more.
     */
    derivePageBundleFilePath: (pageData: PageContext) => string;
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
    /**
     * Function to derive the file path where a page-scoped HTML bundle (`@page`) should be written.
     * Called once per page (or template — pagination variants of the same template share a bundle file).
     * Must produce a unique path per template input path; otherwise pages with the same derived path
     * will overwrite each other's bundle files.
     *
     * Derive the path only from *template-constant* fields (`inputPath`, `fileSlug`, `filePathStem`).
     * Pagination variants of one template share a single `@page` bundle file, so a deriver that keys
     * off a *per-page* field (`url`, `outputPath`, `date`) would make each variant reference a
     * different path while only one file is written — the other variants would then 404. Yeti logs a
     * warning if it detects this, but the safest choice is to never key off per-page fields here.
     *
     * If not provided, the default derives the path from the template's `inputPath`, stripping the
     * input dir prefix and the page template extension, then prepending `/html/_pages/` and appending
     * `.html`. For example, `src/blog/post.page.ts` becomes `/html/_pages/blog/post.html`.
     *
     * @param {PageContext} pageData - Data from 11ty describing the page being built,
     *                                  including the page's input path, output path, URL, file slug, and more.
     */
    derivePageBundleFilePath: (pageData: PageContext) => string;
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
   * A [browserslist](https://github.com/browserslist/browserslist) query describing the browsers
   * your site should support. Yeti translates it once into **both** esbuild's `target` (for JS) and
   * lightningcss's `targets` (for CSS), so browser support is expressed a single way and applied
   * consistently across assets.
   *
   * If omitted, yeti auto-detects a project browserslist config (`.browserslistrc`,
   * `package.json#browserslist`, etc.). If there's neither an explicit query nor a project config,
   * no targets are injected and the bundlers keep their defaults.
   *
   * An explicit `target`/`targets` in `js`/`css.defaultBundleTransformConfig` overrides the value
   * computed from this query.
   *
   * @example '> 0.5%, last 2 versions, not dead'
   */
  browserslist: string | string[] | null;
  /**
   * The file extension used for Yeti page template files.
   * Values must not include a leading dot — Eleventy's `addTemplateFormats`/`addExtension`
   * APIs will silently fail to register extensions that start with `.`.
   * @default ["page.js", "page.ts"]
   */
  pageTemplateFileExtension: string | string[];
  /**
   * Directory where yeti-js stores its build cache for incremental builds.
   * The cache persists per-page bundle contributions across process boundaries
   * so that incremental CLI builds (`--incremental`) can produce correct output
   * without rebuilding every page.
   *
   * @default "node_modules/.cache/yeti-js" (relative to cwd)
   */
  cacheDir: string;
}

export type PartialYetiConfig = DeepPartial<YetiConfig>;

const config: YetiConfig = {
  // Default inputDir is the current working directory, but we will override this with the actual Eleventy input dir when we initialize the plugin.
  inputDir: process.cwd(),
  // Default outputDir is a "_site" directory in the current working directory, but we will override this with the actual Eleventy output dir when we initialize the plugin.
  outputDir: join(process.cwd(), "_site"),
  js: {
    defaultBundleTransformConfig: {
      minify: true,
    },
    deriveBundleTransformConfig: (bundleName, defaultConfig) => defaultConfig,
    deriveBundleFilePath: (bundleName) => `/js/${bundleName}.js`,
    derivePageBundleFilePath: (pageData) => defaultDerivePageBundleFilePath(pageData, "js"),
  },
  css: {
    defaultBundleTransformConfig: {
      minify: true,
    },
    deriveBundleTransformConfig: (bundleName, defaultConfig) => defaultConfig,
    deriveBundleFilePath: (bundleName) => `/css/${bundleName}.css`,
    derivePageBundleFilePath: (pageData) => defaultDerivePageBundleFilePath(pageData, "css"),
  },
  html: {
    minify: true,
    defaultBundleTransformConfig: {
      minify: true,
    },
    deriveBundleTransformConfig: (bundleName, defaultConfig) => defaultConfig,
    deriveBundleFilePath: (bundleName) => `/html/${bundleName}.html`,
    derivePageBundleFilePath: (pageData) => defaultDerivePageBundleFilePath(pageData, "html"),
  },
  pageTemplateFileExtension: ["page.js", "page.ts"],
  browserslist: null,
  cacheDir: join(process.cwd(), "node_modules/.cache/yeti-js"),
  quietMode: false,
};

const isObject = (value: unknown): value is Record<string, any> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns a human-readable type label for a value, suitable for error messages.
 * Distinguishes `null` and arrays from plain objects, which `typeof` conflates as `"object"`.
 */
const describeType = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

const validateJSConfig = (jsConfig: PartialYetiConfig["js"]): {
  errors: string[] | null;
  warnings: string[] | null;
} => {
  let errors: string[] | null = null;
  let warnings: string[] | null = null;

  if (jsConfig) {
    for (const key of Object.keys(jsConfig) as (keyof YetiConfig["js"])[]) {
      switch (key) {
        case "defaultBundleTransformConfig": {
          const value = jsConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (!isObject(value)) {
            // Must be an object if defined
            (errors ??= []).push(`"js.defaultBundleTransformConfig" must be an object, got ${describeType(value)}`);
          }
          // Not validating the object shape here; we can leave that to esbuild
          break;
        }
        case "deriveBundleFilePath": {
          const value = jsConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"js.deriveBundleFilePath" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "derivePageBundleFilePath": {
          const value = jsConfig[key];
          if (value === undefined) {
            break;
          } else if (typeof value !== "function") {
            (errors ??= []).push(`"js.derivePageBundleFilePath" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "deriveBundleTransformConfig": {
          const value = jsConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"js.deriveBundleTransformConfig" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "externalDependencies": {
          const value = jsConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (!isObject(value)) {
            // Must be an object if defined
            (errors ??= []).push(`"js.externalDependencies" must be an object, got ${describeType(value)}`);
          } else {
            for (const [depKey, depValue] of Object.entries(value)) {
              if (typeof depKey !== "string") {
                (errors ??= []).push(`"js.externalDependencies" keys must be strings, got ${describeType(depKey)}`);
              }
              if (typeof depValue !== "string") {
                (errors ??= []).push(`"js.externalDependencies.${depKey}" must be a string, got ${describeType(depValue)}`);
              }
            }
          }
          break;
        }
        default: {
          (warnings ??= []).push(
            `Unrecognized config key "js.${key}" will be ignored.`
          );
          break;
        }
      }
    }
  }

  return { errors, warnings };
}
const validateCSSConfig = (cssConfig: PartialYetiConfig["css"] | undefined): {
  errors: string[] | null;
  warnings: string[] | null;
} => {
  let errors: string[] | null = null;
  let warnings: string[] | null = null;

  if (cssConfig) {
    for (const key of Object.keys(cssConfig) as (keyof YetiConfig["css"])[]) {
      switch (key) {
        case "defaultBundleTransformConfig": {
          const value = cssConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (!isObject(value)) {
            // Must be an object if defined
            (errors ??= []).push(`"css.defaultBundleTransformConfig" must be an object, got ${describeType(value)}`);
          }
          // Not validating the object shape here; we can leave that to lightningcss
          break;
        }
        case "deriveBundleFilePath": {
          const value = cssConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"css.deriveBundleFilePath" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "derivePageBundleFilePath": {
          const value = cssConfig[key];
          if (value === undefined) {
            break;
          } else if (typeof value !== "function") {
            (errors ??= []).push(`"css.derivePageBundleFilePath" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "deriveBundleTransformConfig": {
          const value = cssConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"css.deriveBundleTransformConfig" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        default: {
          (warnings ??= []).push(
            `Unrecognized config key "css.${key}" will be ignored.`
          );
          break;
        }
      }
    }
  }

  return { errors, warnings };
};
const validateHTMLConfig = (htmlConfig: PartialYetiConfig["html"] | undefined): {
  errors: string[] | null;
  warnings: string[] | null;
} => {
  let errors: string[] | null = null;
  let warnings: string[] | null = null;

  if (htmlConfig) {
    for (const key of Object.keys(htmlConfig) as (keyof YetiConfig["html"])[]) {
      switch (key) {
        case "minify": {
          const value = htmlConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "boolean") {
            (errors ??= []).push(
              `"html.minify" must be a boolean, got ${describeType(value)}`
            );
          }
          break;
        }
        case "defaultBundleTransformConfig": {
          const value = htmlConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (!isObject(value)) {
            // Must be an object if defined
            (errors ??= []).push(`"html.defaultBundleTransformConfig" must be an object, got ${describeType(value)}`);
          }
          break;
        }
        case "deriveBundleFilePath": {
          const value = htmlConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"html.deriveBundleFilePath" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "derivePageBundleFilePath": {
          const value = htmlConfig[key];
          if (value === undefined) {
            break;
          } else if (typeof value !== "function") {
            (errors ??= []).push(`"html.derivePageBundleFilePath" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "deriveBundleTransformConfig": {
          const value = htmlConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"html.deriveBundleTransformConfig" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        case "processImport": {
          const value = htmlConfig[key];
          if (value === undefined) {
            // undefined is permitted
            break;
          } else if (typeof value !== "function") {
            // Must be a function
            (errors ??= []).push(`"html.processImport" must be a function, got ${describeType(value)}`);
          }
          break;
        }
        default: {
          (warnings ??= []).push(
            `Unrecognized config key "html.${key}" will be ignored.`
          );
          break;
        }
      }
    }
  }

  return { errors, warnings };
};

export const validateConfig = (newConfig: PartialYetiConfig) => {
  let errors: string[] | null = null;
  let warnings: string[] | null = null;

  for (const key of Object.keys(newConfig) as (keyof PartialYetiConfig)[]) {
    switch (key) {
      case "inputDir": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (typeof value === "string") {
          // Must be a non-empty string
          if (value.length === 0) {
            (errors ??= []).push(
              `"inputDir" must be a non-empty string, got ""`
            );
          }
        } else {
          (errors ??= []).push(
            `"inputDir" must be a string, got ${describeType(value)}`
          );
        }
        break;
      }
      case "outputDir": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (typeof value === "string") {
          // Must be a non-empty string
          if (value.length === 0) {
            (errors ??= []).push(
              `"outputDir" must be a non-empty string, got ""`
            );
          }
        } else {
          (errors ??= []).push(
            `"outputDir" must be a string, got ${describeType(value)}`
          );
        }
        break;
      }
      case "quietMode": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (typeof value !== "boolean") {
          (errors ??= []).push(
            `"quietMode" must be a boolean, got ${describeType(value)}`
          );
        }
        break;
      }
      case "cacheDir": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (typeof value === "string") {
          if (value.length === 0) {
            (errors ??= []).push(
              `"cacheDir" must be a non-empty string, got ""`
            );
          }
        } else {
          (errors ??= []).push(
            `"cacheDir" must be a string, got ${describeType(value)}`
          );
        }
        break;
      }
      case "browserslist": {
        const value = newConfig[key];
        if (value === null) {
          // null is permitted
          break;
        } else if (typeof value === "string") {
          if (value.length === 0) {
            (errors ??= []).push(
              `"browserslist" must be a non-empty string, got ""`
            );
          }
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== "string") {
              (errors ??= []).push(
                `"browserslist[${i}]" must be a string, got ${describeType(value[i])}`
              );
            } else if (value[i].length === 0) {
              (errors ??= []).push(
                `"browserslist[${i}]" must be a non-empty string, got ""`
              );
            }
          }
        } else {
          (errors ??= []).push(
            `"browserslist" must be a string or array of strings, got ${describeType(value)}`
          );
        }
        break;
      }
      case "pageTemplateFileExtension": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (typeof value === "string") {
          // Must be a non-empty string without a leading dot
          if (value.length === 0) {
            (errors ??= []).push(
              `"pageTemplateFileExtension" must be a non-empty string, got ""`
            );
          } else if (value.startsWith(".")) {
            (errors ??= []).push(
              `"pageTemplateFileExtension" must not start with a leading dot, got "${value}"`
            );
          }
        } else if (Array.isArray(value)) {
          // Must be an array of non-empty strings without leading dots
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== "string") {
              (errors ??= []).push(
                `"pageTemplateFileExtension[${i}]" must be a string, got ${describeType(value[i])}`
              );
            } else if (value[i].length === 0) {
              (errors ??= []).push(
                `"pageTemplateFileExtension[${i}]" must be a non-empty string, got ""`
              );
            } else if (value[i].startsWith(".")) {
              (errors ??= []).push(
                `"pageTemplateFileExtension[${i}]" must not start with a leading dot, got "${value[i]}"`
              );
            }
          }
        } else {
          (errors ??= []).push(
            `"pageTemplateFileExtension" must be a string or array of strings, got ${describeType(value)}`
          );
        }
        break;
      }
      case "css": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (!isObject(value)) {
          (errors ??= []).push(
            `"css" config must be an object, got ${describeType(value)}`
          );
          break;
        }

        const { errors: cssErrors, warnings: cssWarnings } = validateCSSConfig(value);
        if (cssErrors) {
          (errors ??= []).push(...cssErrors);
        }
        if (cssWarnings) {
          (warnings ??= []).push(...cssWarnings);
        }
        break;
      }
      case "html": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (!isObject(value)) {
          (errors ??= []).push(
            `"html" config must be an object, got ${describeType(value)}`
          );
          break;
        }

        const { errors: htmlErrors, warnings: htmlWarnings } = validateHTMLConfig(value);
        if (htmlErrors) {
          (errors ??= []).push(...htmlErrors);
        }
        if (htmlWarnings) {
          (warnings ??= []).push(...htmlWarnings);
        }
        break;
      }
      case "js": {
        const value = newConfig[key];
        if (value === undefined) {
          // undefined is permitted
          break;
        } else if (!isObject(value)) {
          (errors ??= []).push(
            `"js" config must be an object, got ${describeType(value)}`
          );
          break;
        }

        const { errors: jsErrors, warnings: jsWarnings } = validateJSConfig(value);
        if (jsErrors) {
          (errors ??= []).push(...jsErrors);
        }
        if (jsWarnings) {
          (warnings ??= []).push(...jsWarnings);
        }
        break;
      }
      default: {
        (warnings ??= []).push(
          `Unrecognized config key "${key}" will be ignored.`
        );
      }
    }
  }

  if (warnings && warnings.length > 0) {
    for (const warning of warnings) {
      logWarning(warning);
    }
  }
  if (errors && errors.length > 0) {
    throw new YetiConfigError(
      `Invalid Yeti config:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
};

/**
 * Deeply merges two config objects, with values from the new config taking precedence over the base config.
 */
export const mergeConfigs = <T extends Record<string, any>>(baseConfig: T, newConfig: DeepPartial<T>): T => {
  const mergedConfig: Record<string, any> = { ...baseConfig };
  const newConfigRecord = newConfig as Record<string, any>;
  for (const key in newConfigRecord) {
    const newValue = newConfigRecord[key];
    // Treat explicit undefined the same as an omitted key: retain the existing value.
    if (newValue === undefined) {
      continue;
    }
    const baseValue = mergedConfig[key];
    if (isObject(newValue) && isObject(baseValue)) {
      mergedConfig[key] = mergeConfigs(baseValue, newValue);
    } else {
      mergedConfig[key] = newValue;
    }
  }
  return mergedConfig as T;
};

/**
 * Merges new config settings into the base Yeti config.
 */
export const updateConfig = (newConfig: PartialYetiConfig): YetiConfig => {
  validateConfig(newConfig);
  const merged = mergeConfigs(config, newConfig);
  return Object.assign(config, merged);
};

export const getConfig = () => config;