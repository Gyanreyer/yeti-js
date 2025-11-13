import type EleventyUserConfig from '@11ty/eleventy/src/UserConfig';
import type { bundleNameSymbol, bundleTypeSymbol, assetTypeSymbol, importFilePathSymbol, shouldEscapeHTMLSymbol, bundleSrcPrefix, inlinedHTMLBundleTagName, inlinedBundleContentTypeSymbol } from './bundle';

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
   * Config for JavaScript bundling and output.
   */
  js: {
    /**
     * Whether to minify processed JavaScript bundles.
     * @default true
     */
    minify: boolean;
    /**
     * Whether to generate source maps for processed JavaScript bundles.
     * @default false
     */
    sourceMaps: boolean;
    /**
     * The directory relative to the site's outputDir where JavaScript bundles will be written.
     * For example, if the site's outputDir is "dist" and `js.outputDir` is "assets/js", JavaScript bundles will be written to "dist/assets/js".
     * @default "js"
     */
    outputDir: string;
    /**
     * The default globa JS bundle name to use when no bundle name is specified.
     * @default "global"
     */
    defaultBundleName: string;
  };
  css: {
    /**
     * Whether to minify processed CSS bundles.
     * @default true
     */
    minify: boolean;
    /**
     * Whether to generate source maps for processed CSS bundles.
     * @default false
     */
    sourceMaps: boolean;
    /**
     * The directory relative to the site's outputDir where CSS bundles will be written.
     * For example, if the site's outputDir is "dist" and `css.outputDir` is "assets/css", CSS bundles will be written to "dist/assets/css".
     * @default "css"
     */
    outputDir: string;
    /**
     * The default global CSS bundle name to use when no bundle name is specified.
     * @default "global"
     */
    defaultBundleName: string;
  }
  /**
   * The file extension used for Yeti page template files.
   * @default ".page.js"
   */
  pageTemplateFileExtension: string;
}

export type RenderResult = {
  html: string;
  cssBundles: {
    [bundleName: string]: Set<string>;
  };
  cssDependencies: Set<string>;
  jsBundles: {
    [bundleName: string]: Set<string>;
  };
  jsDependencies: Set<string>;
  htmlBundles: {
    [bundleName: string]: Set<string>;
  };
  htmlDependencies: Set<string>;
};

export type CSSResult = {
  cssBundles: {
    [bundleName: string]: string;
  };
  cssDependencies: Set<string>;
};

export type JSResult = {
  jsBundles: {
    [bundleName: string]: string;
  };
  jsDependencies: Set<string>;
};

export type Children = unknown[];

type YetiComponentMetadata = {
  css?: () => CSSResult;
  js?: () => JSResult;
}

export type YetiComponentProps = {
  [key: string]: typeof key extends "children" ? never : unknown;
}

type YetiComponentFunction<TProps extends YetiComponentMetadata> = (data: TProps & {
  children: Children | undefined;
}) => RenderResult | RenderResult[];

export type YetiComponent<TProps extends YetiComponentProps = {}> = YetiComponentFunction<TProps> & YetiComponentMetadata;

export type EleventyPageData = {
  eleventy: {
    version: string;
    generator: string;
    env: {
      source: string;
      runMode: string;
      config: string;
      root: string;
    };
    directories: {
      input: string;
      data: string;
      includes: string;
      layouts: string;
      output: string;
    }
  };
  page: {
    inputPath: string;
    fileSlug: string;
    filePathStem: string;
    templateSyntax: string;
    date: Date;
    url: string;
    outputPath: string;
  };
  collections: Record<string, any>;
};

type YetiPageComponentFunction<TData extends Record<string, any>> = (data: TData & EleventyPageData) => RenderResult | RenderResult[];

export type YetiPageComponent<TData extends Record<string, any> = {}> = YetiPageComponentFunction<TData & EleventyPageData> & YetiComponentMetadata;

export type HTMLImportObject = {
  /**
   * The resolved absolute path to the imported file.
   */
  [importFilePathSymbol]: string;
  /**
   * Whether the imported HTML content should be escaped.
   */
  [shouldEscapeHTMLSymbol]: boolean;
  /**
   * The type of asset this import represents. Used internally to distinguish between HTML, JS, and CSS imports.
   */
  [assetTypeSymbol]: 'html';
  /**
   * The type of this bundle object, indicating that it is importing an external HTML file.
   */
  [bundleTypeSymbol]: "import";
  /**
   * The name of the bundle that this imported file's contents will be appended to.
   * If not specified, the imported file contents will inlined in the spot where `html.import()` was called.
   */
  [bundleNameSymbol]?: string;
};

export type InlinedHTMLBundleContentObject<TBundleName extends string> = {
  [inlinedBundleContentTypeSymbol]: "html";
  [bundleNameSymbol]: TBundleName;
};

/**
 * A template literal tag function for defining HTML content within Yeti components.
 * @example
 * ```ts
 * import { html } from 'yeti-js';
 * const myComponent = () => html`<div>Hello, world!</div>`;
 * ```
 */
export declare const html: ((strings: TemplateStringsArray, ...values: any[]) => RenderResult | RenderResult[]) & {
  /**
   * Imports an external file as an HTML fragment.
   *
   * @param {string} importPath
   * @param {Object} [options]
   * @param {boolean} [options.escape=false] Whether the imported content should be escaped.
   *                                          This will convert characters like `<` and `>` to their HTML entity equivalents,
   *                                          so only use this for text/attribute content, not HTML fragments.
   * @param {string} [options.bundleName] The name of the HTML content bundle that this imported file's contents will be appended to.
   *                                          Bundled HTML content can be inlined into the final HTML output using the `html.inline(bundleName)` method.
   *                                          This is mainly useful for things like SVG sprites that you want to include in the final HTML output.
   *                                          If not specified, the imported file contents will inlined in the spot where `html.import()` was called.
   * @returns {HTMLImportObject}
   *
   * @example Importing an HTML fragment directly
   * ```ts
   * import { html } from 'yeti-js';
   * const MyComponent = () => html`
   *   <div>
   *     ${html.import('./path/to/fragment.html')}
   *   </div>
   * `;
   * ```
   * 
   * @example Importing and escaping text content
   * ```ts
   * import { html } from 'yeti-js';
   * const MyComponent = () => html`
   *  <div>
   *   ${html.import('./path/to/text-content.txt', { escape: true })}
   *  </div>
   * `;
   *
   * @example Importing an HTML fragment into a named bundle
   * ```ts
   * import { html } from 'yeti-js';
   * const MyComponent = () => html`
   *   ${html.import('./path/to/icon.svg', { bundleName: 'svg-sprites' })}
   *   <div>
   *    <svg>
   *      <use href="#icon-id"></use>
   *    </svg>
   *   </div>
   * `;
   *
   * const MyLayout = ({ children }) => html`
   *  <html>
   *   <body>
   *    <svg xmlns="http://www.w3.org/2000/svg">
   *      <defs>
   *        ${html.inline('svg-sprites')}
   *      </defs>
   *     </svg>
   *     <header>My Site Header</header>
   *     ${children}
   *     <footer>My Site Footer</footer>
   *   </body>
   *  </html>
   * `;
   * ```
   */
  import: (importPath: string, options?: {
    /**
     * Whether the imported content should be escaped.
     * This will convert characters like `<` and `>` to their HTML entity equivalents,
     * so only use this for text/attribute content, not HTML fragments.
     * @default false
     */
    escape?: boolean;
    /**
     * The name of the HTML content bundle that this imported file's contents will be appended to.
     * Bundled HTML content can be inlined into the final HTML output using the `html.inline(bundleName)` method.
     * This is mainly useful for things like making an inlined SVG spritesheet which only includes SVGs that were used on the page.
     * If not specified, the imported file contents will inlined in the spot where `html.import()` was called.
     */
    bundleName?: string;
  }) => HTMLImportObject;
  /**
   * Generates a placeholder HTML tag in your HTML which will be replaced with the contents of the specified HTML bundle during processing.
   *
   * @param {string} bundleName The name of the HTML bundle to inline. Passing "*" will inline all HTML bundles used on the page which are not
   *                            explicitly referenced elsewhere.
   *
   * @example Named bundle inline
   * ```ts
   * import { html } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *    <svg xmlns="http://www.w3.org/2000/svg">
   *      <defs>
   *        ${html.inline('svg-sprites')}
   *      </defs>
   *   </svg>`;
   * }
   * // Expected output:
   * // <svg xmlns="http://www.w3.org/2000/svg">
   * //   <defs>
   * //     <symbol id="icon-1-id" viewBox="0 0 24 24">...</symbol>
   * //     <symbol id="icon-2-id" viewBox="0 0 24 24">...</symbol>
   * //   </defs>
   * // </svg>
   * ```
   */
  inline: <TBundleName extends string>(bundleName: TBundleName) => InlinedHTMLBundleContentObject<TBundleName>;
};

type CSSOrJSBundleStartObject<TAssetType extends 'css' | 'js' = "css" | "js"> = {
  /**
   * The name of the bundle that all following JavaScript or CSS content will be appended to.
   */
  [bundleNameSymbol]: string;
  /**
   * The type of asset for this bundle. Used internally to distinguish between HTML, JS, and CSS assets.
   */
  [assetTypeSymbol]: TAssetType;
  /**
   * The type of this bundle object, indicating that it represents the start of a new bundle.
   */
  [bundleTypeSymbol]: "start";
};

/**
 * Object representing the start of a new CSS or JS bundle within a `css`/`js` template string.
 * This object will act as a marker that all following CSS content will be appended to the specified bundle,
 * until another bundle start object is encountered or the template string ends.
 */
export type CSSBundleStartObject = CSSOrJSBundleStartObject<"css">;

/**
 * Object representing the start of a new CSS or JS bundle within a `css`/`js` template string.
 * This object will act as a marker that all following JS content will be appended to the specified bundle,
 * until another bundle start object is encountered or the template string ends.
 */
export type JSBundleStartObject = CSSOrJSBundleStartObject<"js">;

type CSSOrJSBundleImportObject<TAssetType extends 'css' | 'js' = "css" | "js"> = {
  /**
   * The resolved absolute path to the imported file.
   */
  [importFilePathSymbol]: string;
  /**
   * The name of the bundle that this imported file's contents will be appended to.
   * If not specified, the contents will be added to the default bundle.
   */
  [bundleNameSymbol]?: string;
  /**
   * The type of asset this import represents. Used internally to distinguish between CSS and JS imports.
   */
  [assetTypeSymbol]: TAssetType;
  /**
   * The type of this bundle object, indicating that it is importing an external file into the bundle.
   */
  [bundleTypeSymbol]: "import";
}

/**
 * Object representing an imported CSS file within a `css` template string.
 * This object contains metadata about the import, including the resolved file path and the target bundle name.
 * The contents of the imported file will be appended to the specified bundle during processing.
 */
export type CSSBundleImportObject = CSSOrJSBundleImportObject<"css">;
/**
 * Object representing an imported JS file within a `js` template string.
 * This object contains metadata about the import, including the resolved file path and the target bundle name.
 * The contents of the imported file will be appended to the specified bundle during processing.
 */
export type JSBundleImportObject = CSSOrJSBundleImportObject<"js">;

/**
 * A template literal tag function for attaching CSS content to Yeti components.
 *
 * @example
 * ```ts
 * import { html, css } from 'yeti-js';
 *
 * export const MyComponent = () => {
 *  return html`
 *    <h1>Hello, world!</h1>
 *  `;
 * }
 * myComponent.css = css`
 *  h1 {
 *    color: red;
 *  }
 * `;
 * ```
 */
export declare const css: ((strings: TemplateStringsArray, ...values: any[]) => () => CSSResult) & {
  /**
   * Marks the start of a new bundle for CSS content within a `css` template string.
   *
   * @param {string} bundleName The name of the CSS bundle that all following CSS content will be appended to.
   *
   * @example
   * ```ts
   * import { css } from 'yeti-js';
   * const MyComponent = () => html`<div>Hello, world!</div>`;
   *
   * MyComponent.css = css`
   *   ${css.bundle('main')} // All following CSS content will be added to the "main" CSS bundle
   *   body {
   *     background-color: lightblue;
   *   }
   *
   *   ${css.bundle('other')} // All following CSS content will now be added to the "other" CSS bundle
   *   h1 {
   *     color: red;
   *   }
   * `;
   * ```
   */
  bundle: (bundleName: string) => CSSOrJSBundleStartObject<"css">;
  /**
   * Imports an external CSS file into a CSS bundle within a `css` template string.
   *
   * @param {string} importPath The path to the CSS file to import.
   * @param {string} [bundleName] The name of the CSS bundle that the imported file's contents will be appended to.
   *                              If not specified, the contents will be added to the default bundle.
   *
   * @example
   * ```ts
   * import { css } from 'yeti-js';
   * const MyComponent = () => html`<div>Hello, world!</div>`;
   *
   * MyComponent.css = css`
   *   ${css.import('./path/to/external-file.css', 'main')} // Imports external-file.css into the "main" CSS bundle
   * `;
   * ```
   */
  import: (importPath: string, bundleName?: string) => CSSOrJSBundleImportObject<"css">;
  /**
   * Generates a string to pass to a `<link rel="stylesheet">` tag's `href` attribute
   * to load a specified CSS bundle.
   * This string will be replaced with the actual URL to the CSS bundle during processing.
   *
   * @param {string} bundleName The name of the CSS bundle to load. Passing "*" will make this a wildcard bundle reference
   *                            which will duplicate the tag that uses it for all CSS bundles used on the page which are not
   *                            explicitly referenced elsewhere.
   *
   * @example Named bundle reference
   * ```ts
   * import { html, css } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *     <head>
   *       <link rel="stylesheet" href="${css.src('main')}" />
   *     </head>
   *  `;
   * // Expected output:
   * // <head>
   * //   <link rel="stylesheet" href="/css/main.css" />
   * // </head>
   * ```
   *
   * @example Wildcard bundle reference
   * ```ts
   * import { html, css } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *     <head>
   *       <link rel="stylesheet" href="${css.src('*')}" />
   *     </head>
   *  `;
   * // Expected output if the page uses "index" and "reset" CSS bundles:
   * // <head>
   * //   <link rel="stylesheet" href="/css/index.css" />
   * //   <link rel="stylesheet" href="/css/reset.css" />
   * // </head>
   * ```
   */
  src: <TBundleName extends string>(bundleName: TBundleName) => `${typeof bundleSrcPrefix}${TBundleName}`;
  /**
   * Generates a placeholder comment string to inline a specified CSS bundle's contents directly into an HTML `<style>` tag.
   * This placeholder will be replaced with the actual CSS content of the specified bundle during processing.
   *
   * @param {string} bundleName The name of the CSS bundle to inline. Passing "*" will inline all CSS bundles used on the page which are not
   *                            explicitly referenced elsewhere.
   *
   * @example Named bundle inline
   * ```ts
   * import { html, css } from 'yeti-js';
   * const myComponent = () => {
   *   return html`
   *     <style>
   *       ${css.inline('main')}
   *     </style>
   *   `;
   * // Expected output:
   * // <style>
   * //   /* Contents of the "main" CSS bundle *\/
   * // </style>
   * ```
   *
   * @example Wildcard bundle inline
   * ```ts
   * import { html, css } from 'yeti-js';
   * const myComponent = () => {
   *   return html`
   *     <style>
   *       ${css.inline('*')}
   *     </style>
   *   `;
   * // Expected output if the page uses "index" and "reset" CSS bundles:
   * // <style>
   * //   /* Contents of the "index" CSS bundle *\/
   * //   /* Contents of the "reset" CSS bundle *\/
   * // </style>
   * ```
   */
  inline: <TBundleName extends string>(bundleName: TBundleName) => `/*@--BUNDLE--${TBundleName}--@*/`;
  /**
   * The default global CSS bundle name that is used when no bundle name is specified.
   *
   * @example
   * ```ts
   * import { css } from 'yeti-js';
   *
   * MyComponent.css = css`
   *  ${css.bundle("critical")}
   *  body { margin: 0; }
   *
   *  ${css.bundle(css.defaultBundleName)} // Reset back to the default global CSS bundle
   *  h1 { color: red; }
   * `;
   * ```
   */
  get defaultBundleName(): string;
};

/**
 * A template literal tag function for attaching JavaScript content to Yeti components.
 *
 * @example
 * ```ts
 * import { html, js } from 'yeti-js';
 *
 * export const MyComponent = () => {
 *  return html`
 *    <h1>Hello, world!</h1>
 *  `;
 * }
 * MyComponent.js = js`
 *  console.log('Hello from MyComponent!');
 * `;
 * ```
 */
export declare const js: ((strings: TemplateStringsArray, ...values: any[]) => () => JSResult) & {
  /**
   * Marks the start of a new bundle for JavaScript content within a `js` template string.
   *
   * @param {string} bundleName The name of the JavaScript bundle that all following JS content will be appended to.
   *
   * @example
   * ```ts
   * import { js } from 'yeti-js';
   * const MyComponent = () => html`<div>Hello, world!</div>`;
   *
   * MyComponent.js = js`
   *   ${js.bundle('main')} // All following JS content will be added to the "main" JS bundle
   *   console.log('This will be part of the "main" bundle');
   *
   *   ${js.bundle('other')} // All following JS content will now be added to the "other" JS bundle
   *   console.log('This will be part of the "other" bundle, not "main"');
   * `;
   * ```
   */
  bundle: (bundleName: string) => CSSOrJSBundleStartObject<"js">;
  /**
   * Imports an external JavaScript file into a JavaScript bundle within a `js` template string.
   *
   * @param {string} importPath The path to the JavaScript file to import.
   * @param {string} [bundleName] The name of the JavaScript bundle that the imported file's contents will be appended to.
   *                              If not specified, the contents will be added to the default bundle.
   *
   * @example
   * ```ts
   * import { js } from 'yeti-js';
   * const MyComponent = () => html`<div>Hello, world!</div>`;
   *
   * MyComponent.js = js`
   *   ${js.import('./path/to/external-file.js', 'main')} // Imports external-file.js into the "main" JS bundle
   * `;
   * ```
   */
  import: (importPath: string, bundleName?: string) => CSSOrJSBundleImportObject<"js">;
  /**
   * Generates a string to pass to a `<script>` tag's `src` attribute to load a specified JavaScript bundle.
   * This string will be replaced with the actual URL to the JavaScript bundle during processing.
   *
   * @param {string} bundleName The name of the JavaScript bundle to load. Passing "*" will make this a wildcard bundle reference
   *                            which will duplicate the tag that uses it for all JS bundles used on the page which are not
   *                            explicitly referenced elsewhere.
   *
   * @example Named bundle reference
   * ```ts
   * import { html, js } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *     <script src="${js.src('main')}"></script>
   *   `;
   * // Expected output:
   * // <script src="/js/main.js"></script>
   * ```
   *
   * @example Wildcard bundle reference
   * ```ts
   * import { html, js } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *     <script src="${js.src('*')}"></script>
   *   `;
   * // Expected output if the page uses "index" and "vendor" JS bundles:
   * // <script src="/js/index.js"></script>
   * // <script src="/js/vendor.js"></script>
   * ```
   */
  src: <TBundleName extends string>(bundleName: TBundleName) => `${typeof bundleSrcPrefix}${TBundleName}`;
  /**
   * Generates a placeholder comment string to inline a specified JavaScript bundle's contents directly into an HTML `<script>` tag.
   * This placeholder will be replaced with the actual JavaScript content of the specified bundle during processing.
   *
   * @param {string} bundleName The name of the JavaScript bundle to inline. Passing "*" will inline all JS bundles used on the page which are not
   *                            explicitly referenced elsewhere.
   *
   * @example Named bundle inline
   * ```ts
   * import { html, js } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *     <script>
   *       ${js.inline('main')}
   *     </script>
   *   `;
   * // Expected output:
   * // <script>
   * //   /* Contents of the "main" JS bundle *\/
   * // </script>
   * ```
   *
   * @example Wildcard bundle inline
   * ```ts
   * import { html, js } from 'yeti-js';
   * const MyComponent = () => {
   *   return html`
   *     <script>
   *       ${js.inline('*')}
   *     </script>
   *   `;
   * // Expected output if the page uses "index" and "vendor" JS bundles:
   * // <script>
   * //   /* Contents of the "index" JS bundle *\/
   * //   /* Contents of the "vendor" JS bundle *\/
   * // </script>
   * ```
   */
  inline: <TBundleName extends string>(bundleName: TBundleName) => `/*@--BUNDLE--${TBundleName}--@*/`;
  /**
   * The default global CSS bundle name that is used when no bundle name is specified.
   *
   * @example
   * ```ts
   * import { js } from 'yeti-js';
   *
   * MyComponent.js = js`
   *  ${js.bundle("other-bundle")}
   *  console.log('This is part of the "other-bundle"');
   *
   *  ${js.bundle(js.defaultBundleName)} // Reset back to the default global JS bundle
   *  console.log('This is part of the default global JS bundle');
   * `;
   * ```
   */
  get defaultBundleName(): string;
};

/**
 * Eleventy plugin function to integrate Yeti into an Eleventy project.
 *
 * @example
 * ```ts
 * // 11ty.config.js
 * import { yetiPlugin } from 'yeti-js';
 *
 * export default function(eleventyConfig) {
 *   eleventyConfig.addPlugin(yetiPlugin);
 * }
 * ```
 */
export declare function yetiPlugin(eleventyConfig: EleventyUserConfig, userConfig: Omit<Partial<YetiConfig>, "inputDir" | "outputDir">): void;

/**
 * Component to inject content into the HTML document's `<head>` section.
 * Any tags included within the `Head` component will be merged into the page's `<head>` and override any
 * conflicting tags defined there (e.g., `<title>`, `<meta>` tags).
 *
 * @example
 * ```ts
 * import { html, Head } from 'yeti-js';
 *
 * export const MyComponent = () => {
 *   return html`
 *     <${Head}>
 *       <title>My Page Title<//>
 *     </>
 *     <div>Hello, world!</div>
 *   `;
 * }
 * ```
 */
export declare const Head: YetiComponent;