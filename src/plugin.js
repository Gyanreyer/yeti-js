import { parse as parseHTML, serialize as serializeHTML, html as parse5HTML, defaultTreeAdapter } from 'parse5';
import { Features, transform as transformCSS, } from 'lightningcss';
import { transform as transformJS } from 'esbuild';
import {
  writeFile,
  access,
  mkdir,
} from 'node:fs/promises';
import {
  join,
  resolve,
} from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { styleText } from 'node:util';

import { updateConfig } from './config.js';

import { bundleSrcPrefix, bundleSrcPrefixLength, inlinedBundleRegex, inlinedWildcardBundle as inlinedWildCardBundle, WILDCARD_BUNDLE_NAME } from './bundle.js';
import { renderPageComponent } from './renderComponent.js';
import { queryElement, transformDocumentNodes, TRANSFORM_ACTIONS } from './utils/document.js';
import { ensureHTMLHasDoctype } from './utils/ensureHTMLHasDoctype.js';

/**
 * @import EleventyUserConfig from '@11ty/eleventy/src/UserConfig.js';
 * @import { DefaultTreeAdapterTypes as Parse5Types } from 'parse5';
 * @import { TransformResult } from './utils/document.js';
 * @import { YetiConfig, EleventyPageData, YetiPageComponent } from './types';
 */


/**
 * @param {string} bundleName
 */
const getCSSBundleHref = (bundleName) => `/css/${bundleName}.css`;
/**
 * @param {string} bundleName
 */
const getJSBundleSrc = (bundleName) => `/js/${bundleName}.js`;

const lazyPreloadOnloadRegex = /\bthis\.rel\s*=\s*['"`]stylesheet['"`]/;

/**
 * @param {EleventyUserConfig} eleventyConfig
 * @param {Omit<Partial<YetiConfig>, "inputDir" | "outputDir">} userConfig
 */
export default function yetiPlugin(eleventyConfig, userConfig = {}) {
  const {
    pageTemplateFileExtension,
    css: {
      minify: shouldMinifyCSS,
      sourceMaps: shouldGenerateCSSSourceMaps,
      outputDir: cssOutputDir,
    },
    js: {
      minify: shouldMinifyJS,
      sourceMaps: shouldGenerateJSSourceMaps,
      outputDir: jsOutputDir,
    },
  } = updateConfig(userConfig)

  eleventyConfig.on("eleventy.before",
    /**
     * @param {{
     *  directories: {
     *   input: string;
     *  };
     * }} params
     */
    async ({
      directories: {
        input
      },
    }) => {
      updateConfig({
        inputDir: resolve(input),
        ...userConfig,
      })
    });

  eleventyConfig.addTemplateFormats(pageTemplateFileExtension);

  /**
   * @type {{
   *  [pageInputPath: string]: {
   *    [bundleName: string]: Set<string>;
   *  }
   * }}
   */
  let globalCssBundles = {};
  /**
   * @type {{
   *  [pageInputPath: string]: {
   *    [bundleName: string]: Set<string>;
   *  }
   * }}
   */
  let globalJsBundles = {};

  /**
   * @type {{
   *  [filePath: string]: string;
   * }}
   */
  const bundleHashes = {};

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  eleventyConfig.addExtension([pageTemplateFileExtension], {
    key: pageTemplateFileExtension,
    useJavaScriptImport: true,
    /**
     * @param {string} inputPath
     */
    async getInstanceFromInputPath(inputPath) {
      const mod = await import(
        // 11ty makes input paths relative to the cwd, so we need to resolve from there
        resolve(process.cwd(), inputPath)
      );
      return {
        pageComponent: mod.default,
        config: mod.config || {},
      };
    },
    getData: ["config"],
    compileOptions: {
      spiderJavaScriptDependencies: true,
    },
    /**
     * @param {Object} compileContext
     * @param {YetiPageComponent} compileContext.pageComponent
     * @param {string} inputPath
     *
     * @returns {(data: any) => Promise<string>}
     */
    compile({ pageComponent }, inputPath) {
      globalCssBundles[inputPath] = {};
      globalJsBundles[inputPath] = {};

      /**
       * Object to cache results from processing inline bundles so we don't re-process the same
       * content multiple times. Doing this on the page template level because that tends to be where
       * inlined content duplication happens the most.
       *
       * @type {Record<string, string>}
       */
      const processedInlineBundleCache = {};

      /**
       * @param {EleventyPageData & {
       *  [key: string]: any;
       * }} data
       */
      return async (data) => {
        const {
          html,
          cssBundles: renderedCSSBundles,
          jsBundles: renderedJSBundles,
          cssDependencies: renderedCSSDeps,
          jsDependencies: renderedJSDeps,
          htmlDependencies: renderedHTMLDeps,
        } = await renderPageComponent(pageComponent, data);

        /** @type {any} */(this).addDependencies(inputPath, [...renderedCSSDeps, ...renderedJSDeps, ...renderedHTMLDeps]);

        // Set of JS bundles which were used on this page but haven't been inserted into script tags yet
        const unimportedJSBundleNameSet = new Set(Object.keys(renderedJSBundles));
        const unimportedCSSBundleNameSet = new Set(Object.keys(renderedCSSBundles));

        const parsedDocument = parseHTML(
          // Parse5 will fail to parse documents without a doctype, so ensure we have one
          ensureHTMLHasDoctype(html),
          {
            onParseError: (err) => {
              console.error(`Error parsing HTML on page ${data.page.url}:`, err);
            },
            sourceCodeLocationInfo: false,
          },
        );

        /**
         * @type {Record<string, Parse5Types.ChildNode>}>}
         */
        let deduplicatedHeadNodes = {};

        // Gather all <head> tag children and de-dupe them
        await transformDocumentNodes(parsedDocument, (node) => {
          if (!defaultTreeAdapter.isElementNode(node) || (node.tagName !== "head" && node.tagName !== "head--")) {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          for (const childNode of node.childNodes) {
            childNode.parentNode = null;

            if (!defaultTreeAdapter.isElementNode(childNode)) {
              deduplicatedHeadNodes[randomUUID()] = childNode;
              continue;
            }

            // De-dupe title, meta, link, script, and style tags
            switch (childNode.tagName) {
              case "title": {
                // Use the last title tag we encounter
                deduplicatedHeadNodes["title"] = childNode;
                break;
              }
              case "meta": {
                const nameAttr = childNode.attrs.find((attr) => attr.name === "name");
                if (nameAttr) {
                  deduplicatedHeadNodes[`meta[name="${nameAttr.value}"]`] = childNode;
                }
                const charsetAttr = childNode.attrs.find((attr) => attr.name === "charset");
                if (charsetAttr) {
                  deduplicatedHeadNodes[`meta[charset="${charsetAttr.value}"]`] = childNode;
                }
                const propertyAttr = childNode.attrs.find((attr) => attr.name === "property");
                if (propertyAttr) {
                  deduplicatedHeadNodes[`meta[property="${propertyAttr.value}"]`] = childNode;
                }
                const httpEquivAttr = childNode.attrs.find((attr) => attr.name === "http-equiv");
                if (httpEquivAttr) {
                  deduplicatedHeadNodes[`meta[http-equiv="${httpEquivAttr.value}"]`] = childNode;
                }
                if (!nameAttr && !charsetAttr && !propertyAttr && !httpEquivAttr) {
                  deduplicatedHeadNodes[randomUUID()] = childNode;
                }
                break;
              };
              case "link": {
                const relAttr = childNode.attrs.find((attr) => attr.name === "rel") ?? null;
                const hrefAttr = childNode.attrs.find((attr) => attr.name === "href") ?? null;
                deduplicatedHeadNodes[`link[rel="${relAttr?.value ?? ""}"][href="${hrefAttr?.value ?? ""}"]`] = childNode;
                break;
              };
              case "script": {
                const srcAttr = childNode.attrs.find((attr) => attr.name === "src") ?? null;
                if (srcAttr) {
                  deduplicatedHeadNodes[`script[src="${srcAttr.value}"]`] = childNode;
                } else {
                  let scriptContent = "";
                  for (const scriptChildNode of childNode.childNodes) {
                    if (defaultTreeAdapter.isTextNode(scriptChildNode)) {
                      scriptContent += scriptChildNode.value;
                    }
                  }
                  const scriptContentHash = createHash("md5").update(scriptContent).digest("hex");
                  deduplicatedHeadNodes[`script/${scriptContentHash}`] = childNode;
                }
                break;
              }
              case "style": {
                let styleContent = "";
                for (const styleChildNode of childNode.childNodes) {
                  if (defaultTreeAdapter.isTextNode(styleChildNode)) {
                    styleContent += styleChildNode.value;
                  }
                }
                const styleContentHash = createHash("md5").update(styleContent).digest("hex");
                deduplicatedHeadNodes[`style/${styleContentHash}`] = childNode;
                break;
              }
              default: {
                deduplicatedHeadNodes[randomUUID()] = childNode;
                break;
              }
            }
          }

          return TRANSFORM_ACTIONS.REMOVE;
        });

        const rootHTMLTag = queryElement(parsedDocument,
          (node) => node.tagName === "html"
        );

        if (rootHTMLTag) {
          /**
           * @type {Parse5Types.ParentNode}
           */
          const newHeadTag = defaultTreeAdapter.createElement("head", parse5HTML.NS.HTML, []);
          for (const headNode of Object.values(deduplicatedHeadNodes)) {
            defaultTreeAdapter.appendChild(newHeadTag, headNode);
          }
          rootHTMLTag.childNodes.unshift(newHeadTag);
          newHeadTag.parentNode = rootHTMLTag;
        }

        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardCSSLinkNodes = new Set();

        /**
         * @param {Parse5Types.Element} node
         * @returns {TransformResult}
         */
        const handleLinkNode = (node) => {
          const relAttr = node.attrs.find((attr) => attr.name === "rel") ?? null;

          if (relAttr === null) {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          let isPreloadLink = false;
          let isLazyImportPreloadLink = false;

          if (relAttr.value === "preload") {
            isPreloadLink = true;
            // Stylesheets maybe be imported via preload links, but only if they have `as="style"`
            const asAttr = node.attrs.find((attr) => attr.name === "as") ?? null;
            if (asAttr && asAttr.value !== "style") {
              return TRANSFORM_ACTIONS.CONTINUE;
            }
            const onloadAttr = node.attrs.find((attr) => attr.name === "onload") ?? null;
            isLazyImportPreloadLink = onloadAttr ? lazyPreloadOnloadRegex.test(onloadAttr.value) : false;
          } else if (relAttr.value !== "stylesheet") {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          const hrefAttr = node.attrs.find((attr) => attr.name === "href") ?? null;

          if (!hrefAttr || !hrefAttr.value.startsWith(bundleSrcPrefix)) {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          const globalImportBundleName = hrefAttr.value.slice(bundleSrcPrefixLength);

          if (globalImportBundleName === WILDCARD_BUNDLE_NAME) {
            // If this is a wildcard import, we need to handle it later after we've processed all other nodes
            wildCardCSSLinkNodes.add(node);
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          if (!isPreloadLink || isLazyImportPreloadLink) {
            // Don't consider the bundle as "used" yet if we're dealing with a `preload` link
            // which doesn't actually lazily import the stylesheet with an `onload` handler.
            unimportedCSSBundleNameSet.delete(globalImportBundleName);
          }
          const cssContent = renderedCSSBundles[globalImportBundleName] ? Array.from(renderedCSSBundles[globalImportBundleName]).join("") : null;
          if (!cssContent) {
            console.error(`CSS bundle "${globalImportBundleName}" is unused on page ${data.page.url}. Removing link tag.`);
            // Remove the link if the bundle is not used on this page
            return TRANSFORM_ACTIONS.REMOVE;
          }

          globalCssBundles[inputPath][globalImportBundleName] ??= new Set();
          globalCssBundles[inputPath][globalImportBundleName].add(cssContent);

          hrefAttr.value = getCSSBundleHref(globalImportBundleName);

          return TRANSFORM_ACTIONS.CONTINUE;
        };

        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardInlinedCSSStyleNodes = new Set();

        /**
         * <style> tags which we need to return to to process their contents once
         * all bundles are resolved
         *
         * @type {Set<Parse5Types.Element>}
         */
        const styleNodesToProcess = new Set();

        /**
         * @param {Parse5Types.Element} node
         * @returns {TransformResult}
         */
        const handleStyleNode = (node) => {
          let shouldSkipProcessingContents = false;
          node.attrs = node.attrs.filter((attr) => {
            if (attr.name === "data-skip-inline-processing") {
              shouldSkipProcessingContents = (attr.value ?? "false") !== "false";
              // Remove this attribute after processing it
              return false;
            }
            return true;
          });

          let styleTagText = "";
          for (const childNode of node.childNodes) {
            if (defaultTreeAdapter.isTextNode(childNode)) {
              styleTagText += childNode.value;
            }
          }

          styleTagText = styleTagText.trim();
          if (styleTagText.length === 0) {
            console.warn(`Empty <style> tag found on page ${data.page.url}. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          styleTagText = styleTagText.replaceAll(
            inlinedBundleRegex,
            (match, bundleName) => {
              if (bundleName === WILDCARD_BUNDLE_NAME) {
                // If this is a wildcard import, we need to handle it later after we've processed all other nodes
                wildCardInlinedCSSStyleNodes.add(node);
                return match;
              }
              unimportedCSSBundleNameSet.delete(bundleName);
              const cssContent = renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("") : null;
              if (cssContent === null) {
                console.error(`No CSS bundle found with name "${bundleName}" to inline on page ${data.page.url}`);
                return "";
              }

              return cssContent;
            }
          ).trim();

          if (styleTagText.length === 0) {
            console.warn(`Empty <style> tag found on page ${data.page.url} after resolving bundles. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          node.childNodes = [];
          defaultTreeAdapter.insertText(node, styleTagText);

          if (!shouldSkipProcessingContents) {
            styleNodesToProcess.add(node);
          }

          return TRANSFORM_ACTIONS.CONTINUE;
        };

        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardJSScriptImportNodes = new Set();
        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardInlinedJSScriptNodes = new Set();

        /**
         * <script> tags which we need to return to to process their contents once
         * all bundles are resolved
         *
         * @type {Set<Parse5Types.Element>}
         */
        const inlineScriptNodesToProcess = new Set();

        /**
         * @param {Parse5Types.Element} node
         * @returns {TransformResult}
         */
        const handleScriptNode = (node) => {
          const srcAttr = node.attrs.find((attr) => attr.name === "src") ?? null;
          if (srcAttr) {
            // Skip wild card imports here; they are handled in a second pass below
            if (srcAttr.value.startsWith(bundleSrcPrefix)) {
              const globalImportBundleName = srcAttr.value.slice(bundleSrcPrefixLength);
              if (globalImportBundleName === WILDCARD_BUNDLE_NAME) {
                // If this is a wildcard import, we need to handle it later after we've processed all other nodes
                wildCardJSScriptImportNodes.add(node);
              } else {
                unimportedJSBundleNameSet.delete(globalImportBundleName);
                const jsContent = renderedJSBundles && renderedJSBundles[globalImportBundleName] ? Array.from(renderedJSBundles[globalImportBundleName]).join("") : null;
                if (!jsContent) {
                  console.error(`JS bundle "${globalImportBundleName}" is unused on page ${data.page.url}. Removing script tag.`);
                  // Remove the script if the bundle is not used on this page
                  return TRANSFORM_ACTIONS.REMOVE;
                }

                globalJsBundles[inputPath][globalImportBundleName] ??= new Set();
                globalJsBundles[inputPath][globalImportBundleName].add(jsContent);

                srcAttr.value = getJSBundleSrc(globalImportBundleName);
              }
            }
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          let shouldSkipProcessingContents = false;
          node.attrs = node.attrs.filter((attr) => {
            if (attr.name === "data-skip-inline-processing") {
              shouldSkipProcessingContents = (attr.value ?? "false") !== "false";
              // Remove this attribute after processing it
              return false;
            }
            return true;
          });

          let scriptTagText = "";
          for (const childNode of node.childNodes) {
            if (defaultTreeAdapter.isTextNode(childNode)) {
              scriptTagText += childNode.value;
            }
          }
          scriptTagText = scriptTagText.trim();

          if (scriptTagText.length === 0) {
            console.warn(`Empty <script> tag found on page ${data.page.url}. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          scriptTagText = scriptTagText.replaceAll(
            inlinedBundleRegex,
            (match, bundleName) => {
              if (bundleName === WILDCARD_BUNDLE_NAME) {
                // If this is a wildcard import, we need to handle it later after we've processed all other nodes
                wildCardInlinedJSScriptNodes.add(node);
                return match;
              }

              unimportedJSBundleNameSet.delete(bundleName);
              const jsContent = renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("") : null;
              if (jsContent === null) {
                console.error(`No JS bundle found with name "${bundleName}" to inline on page ${data.page.url}`);
                return "";
              }

              return jsContent;
            }
          ).trim();

          if (scriptTagText.length === 0) {
            console.warn(`Empty <script> tag found on page ${data.page.url} after resolving bundles. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          node.childNodes = [];
          defaultTreeAdapter.insertText(node, scriptTagText);

          if (!shouldSkipProcessingContents) {
            inlineScriptNodesToProcess.add(node);
          }

          return TRANSFORM_ACTIONS.CONTINUE;
        };

        // Transform and process all <link> tags which import CSS bundles
        await transformDocumentNodes(parsedDocument,
          async (node) => {
            if (!defaultTreeAdapter.isElementNode(node)) {
              return TRANSFORM_ACTIONS.CONTINUE;
            }

            switch (node.tagName) {
              case "link": {
                return handleLinkNode(node);
              }
              case "style": {
                return handleStyleNode(node);
              }
              case "script": {
                return handleScriptNode(node);
              }
              default: {
                return TRANSFORM_ACTIONS.CONTINUE;
              }
            }
          },
        );

        const wildCardCSSBundleNames = Array.from(unimportedCSSBundleNameSet);

        for (const wildCardLinkNode of wildCardCSSLinkNodes) {
          if (!wildCardLinkNode.parentNode) {
            continue;
          }

          const nodeIndex = wildCardLinkNode.parentNode.childNodes.indexOf(wildCardLinkNode);
          const newNodes = [];
          for (const bundleName of wildCardCSSBundleNames) {
            const cssContent = renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("") : null;
            if (!cssContent) {
              continue;
            }

            globalCssBundles[inputPath][bundleName] ??= new Set();
            globalCssBundles[inputPath][bundleName].add(cssContent);

            // Deeply clone so we don't modify the original node
            const newNode = structuredClone(wildCardLinkNode);

            const hrefAttr = newNode.attrs.find((attr) => attr.name === "href");
            if (hrefAttr) {
              hrefAttr.value = getCSSBundleHref(bundleName);
            } else {
              newNode.attrs.push({
                name: "href",
                value: getCSSBundleHref(bundleName),
              });
            }

            newNodes.push(newNode);
          }

          wildCardLinkNode.parentNode.childNodes.splice(nodeIndex, 1, ...newNodes);
        }

        for (const styleNode of wildCardInlinedCSSStyleNodes) {
          const combinedWildCardBundleContent = wildCardCSSBundleNames.map((bundleName) => {
            return renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("\n") : null;
          }).join("\n").trim();

          const currentStyleTagText = styleNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();
          const newStyleTagText = currentStyleTagText.replaceAll(
            inlinedWildCardBundle,
            combinedWildCardBundleContent
          );

          styleNode.childNodes = [];
          defaultTreeAdapter.insertText(styleNode, newStyleTagText);
        }

        const wildCardJSBundleNames = Array.from(unimportedJSBundleNameSet);

        for (const scriptNode of wildCardJSScriptImportNodes) {
          if (!scriptNode.parentNode) {
            continue;
          }

          const nodeIndex = scriptNode.parentNode.childNodes.indexOf(scriptNode);
          const newNodes = [];
          for (const bundleName of wildCardJSBundleNames) {
            const jsContent = renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("") : null;
            if (!jsContent) {
              continue;
            }

            globalJsBundles[inputPath][bundleName] ??= new Set();
            globalJsBundles[inputPath][bundleName].add(jsContent);

            // Deeply clone so we don't modify the original node
            const newNode = structuredClone(scriptNode);
            const srcAttr = newNode.attrs.find((attr) => attr.name === "src");
            if (srcAttr) {
              srcAttr.value = getJSBundleSrc(bundleName);
            } else {
              newNode.attrs.push({
                name: "src",
                value: getJSBundleSrc(bundleName),
              });
            }

            newNodes.push(newNode);
          }

          scriptNode.parentNode.childNodes.splice(nodeIndex, 1, ...newNodes);
        }

        for (const scriptNode of wildCardInlinedJSScriptNodes) {
          const combinedWildCardBundleContent = wildCardJSBundleNames.map((bundleName) => {
            return renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("\n") : null;
          }).join("\n").trim();

          const currentScriptTagText = scriptNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();
          const newScriptTagText = currentScriptTagText.replaceAll(
            inlinedWildCardBundle,
            combinedWildCardBundleContent
          );

          scriptNode.childNodes = [];
          defaultTreeAdapter.insertText(scriptNode, newScriptTagText);
        }

        let styleTagIndex = -1;
        for (const styleNode of styleNodesToProcess) {
          styleTagIndex += 1;

          let styleTagText = styleNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();

          const styleTagContentHash = createHash("md5").update(styleTagText).digest("hex");

          try {
            if (processedInlineBundleCache[styleTagContentHash] !== undefined) {
              styleTagText = processedInlineBundleCache[styleTagContentHash];
            } else {
              const { code } = transformCSS({
                filename: `${encodeURIComponent(data.page.url)}__<style>(${styleTagIndex}).css`,
                code: encoder.encode(styleTagText),
                minify: shouldMinifyCSS,
                include: Features.Nesting,
              });
              styleTagText = processedInlineBundleCache[styleTagContentHash] = decoder.decode(code);
            }
          } catch (err) {
            console.error(`Error processing inlined CSS on page ${data.page.url}: ${err}`);
          }

          if (styleTagText.length === 0) {
            console.warn(`Empty <style> tag found on page ${data.page.url} after processing. Removing.`);
            defaultTreeAdapter.detachNode(styleNode);
          } else {
            styleNode.childNodes = [];
            defaultTreeAdapter.insertText(styleNode, styleTagText);
          }
        }


        let scriptTagIndex = -1;

        for (const scriptNode of inlineScriptNodesToProcess) {
          scriptTagIndex += 1;

          let scriptTagText = scriptNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();

          const scriptTagContentHash = createHash("md5").update(scriptTagText).digest("hex");

          try {
            if (processedInlineBundleCache[scriptTagContentHash] !== undefined) {
              scriptTagText = processedInlineBundleCache[scriptTagContentHash];
            } else {
              const { code: transformedCode } = await transformJS(scriptTagText, {
                minify: shouldMinifyJS,
                target: ["es2020"],
                format: "esm",
                sourcefile: `${encodeURIComponent(data.page.url)}__<script>(${scriptTagIndex}).js`,
              });
              scriptTagText = processedInlineBundleCache[scriptTagContentHash] = transformedCode.trimEnd();
            }
          } catch (err) {
            console.error(`Error processing inlined JS on page ${data.page.url}: ${err}`);
          }

          if (scriptTagText.length === 0) {
            console.warn(`Empty <script> tag found on page ${data.page.url} after processing. Removing.`);
            defaultTreeAdapter.detachNode(scriptNode);
          } else {
            scriptNode.childNodes = [];
            defaultTreeAdapter.insertText(scriptNode, scriptTagText);
          }
        }

        return serializeHTML(parsedDocument);
      };
    },
  });


  eleventyConfig.on("eleventy.after",
    /**
     * @param {{
     *  directories: {
     *    output: string;
     *  };
     * }} params
     */
    async (
      {
        directories: { output },
      }
    ) => {
      /**
       * @type {Record<string, Set<string>>}
       */
      const combinedCssBundles = {};
      for (const inputPath in globalCssBundles) {
        for (const [bundleName, cssChunkSet] of Object.entries(globalCssBundles[inputPath])) {
          combinedCssBundles[bundleName] ??= new Set();
          for (const cssChunk of cssChunkSet) {
            combinedCssBundles[bundleName].add(cssChunk);
          }
        }
      }

      const resolvedCSSOutputDir = resolve(join(output, cssOutputDir));
      /**
       * @type {Promise<unknown>}
       */
      let processCSSBundlesPromise = Promise.resolve();

      const combinedBundleKeyValuePairs = Object.entries(combinedCssBundles);
      if (combinedBundleKeyValuePairs.length > 0) {
        try {
          await access(resolvedCSSOutputDir);
        } catch (err) {
          await mkdir(resolvedCSSOutputDir, { recursive: true });
        }

        processCSSBundlesPromise = Promise.allSettled(
          combinedBundleKeyValuePairs.map(async ([bundleName, cssChunkSet]) => {
            const cssContent = Array.from(cssChunkSet.values()).join("");
            if (cssContent.length === 0) {
              return;
            }

            const outputFileName = `${bundleName}.css`;
            const outputFilePath = join(resolvedCSSOutputDir, outputFileName);
            const outputMapFileName = `${outputFileName}.map`;
            const outputMapFilePath = join(resolvedCSSOutputDir, outputMapFileName);

            const hash = createHash("md5").update(cssContent).digest("hex");
            if (bundleHashes[outputFilePath] === hash) {
              // Skip re-bundling if the content hash matches the cached hash
              return;
            }
            bundleHashes[outputFilePath] = hash;

            /**
             * @type {Uint8Array}
             */
            let codeBytes;
            /**
             * @type {Uint8Array | null}
             */
            let sourceMapBytes = null;

            try {
              const result = await transformCSS({
                filename: `${bundleName}.css`,
                code: encoder.encode(cssContent),
                minify: shouldMinifyCSS,
                sourceMap: shouldGenerateCSSSourceMaps,
                include: Features.Nesting,
              });
              codeBytes = result.code;
              if (shouldGenerateCSSSourceMaps && result.map) {
                sourceMapBytes = result.map;
                const sourceMapCommentBytes = encoder.encode(`/*# sourceMappingURL=./${outputMapFileName} */`);
                const combinedCode = new Uint8Array(codeBytes.length + sourceMapCommentBytes.length);
                combinedCode.set(codeBytes, 0);
                combinedCode.set(sourceMapCommentBytes, codeBytes.length);
                codeBytes = combinedCode;
              }
            } catch (err) {
              console.error(`Error processing CSS bundle ${bundleName}:`, err);
              throw new Error(`Error processing CSS bundle ${bundleName}`, {
                cause: err,
              });
            }

            console.log("Writing CSS bundle", bundleName, "to", outputFilePath);

            await writeFile(outputFilePath, codeBytes, "utf8");
            if (shouldGenerateCSSSourceMaps && sourceMapBytes !== null) {
              await writeFile(outputMapFilePath, sourceMapBytes, "utf8");
            }
          })
        );
      }

      /**
       * @type {Record<string, Set<string>>}
       */
      const combinedJsBundles = {};
      for (const inputPath in globalJsBundles) {
        for (const [bundleName, jsChunkSet] of Object.entries(globalJsBundles[inputPath])) {
          combinedJsBundles[bundleName] ??= new Set();
          for (const jsChunk of jsChunkSet) {
            combinedJsBundles[bundleName].add(jsChunk);
          }
        }
      }

      const jsOutputDir = resolve(join(output, "js"));
      /**
       * @type {Promise<unknown>}
       */
      let processJSBundlesPromise = Promise.resolve();

      const combinedJSBundleKeyValuePairs = Object.entries(combinedJsBundles);
      if (combinedJSBundleKeyValuePairs.length > 0) {
        try {
          await access(jsOutputDir);
        } catch (err) {
          await mkdir(jsOutputDir, { recursive: true });
        }

        processJSBundlesPromise = Promise.allSettled(
          Object.entries(combinedJsBundles).map(async ([bundleName, jsChunkSet]) => {
            const jsContent = Array.from(jsChunkSet.values()).join("");
            if (jsContent.length === 0) {
              return;
            }

            const outputFileName = `${bundleName}.js`;
            const outputFilePath = join(jsOutputDir, `${bundleName}.js`);
            const outputMapFileName = `${outputFileName}.map`;
            const outputMapFilePath = join(jsOutputDir, outputMapFileName);

            const hash = createHash("md5").update(jsContent).digest("hex");
            if (bundleHashes[outputFilePath] === hash) {
              // Skip re-bundling if the content hash matches the cached hash
              return;
            }
            bundleHashes[outputFilePath] = hash;

            /**
             * @type {string}
             */
            let code;
            /**
             * @type {string | null}
             */
            let sourceMap = null;

            try {
              const result = await transformJS(jsContent, {
                minify: shouldMinifyJS,
                target: ["es2020"],
                format: "esm",
                sourcemap: shouldGenerateJSSourceMaps ? "external" : undefined,
                sourcefile: `${bundleName}.js`,
              });
              code = result.code;
              if (shouldGenerateCSSSourceMaps && result.map) {
                code = `${result.code}//# sourceMappingURL=${bundleName}.js.map`;
                sourceMap = result.map;
              }
            } catch (err) {
              if (err instanceof Error && err.stack) {
                console.error(`${styleText("red", `Error processing JS bundle "${bundleName}"`)}:\n${styleText("yellow", err.message.replace(/^/gm, "  "))}`);
                // Parse line number and column from esbuild error stack and log lines above and below for context,
                // highlighting the specified column.
                const stackLines = err.stack.split("\n").slice(0, 2);
                const lineColMatch = stackLines[1].match(/:(\d+):(\d+)/);
                if (lineColMatch) {
                  const lineNum = parseInt(lineColMatch[1], 10);
                  const colNum = parseInt(lineColMatch[2], 10);
                  const jsContentLines = jsContent.split("\n");
                  const contextRadius = 2;
                  const startLine = Math.max(0, lineNum - contextRadius - 1);
                  const endLine = Math.min(jsContentLines.length, lineNum + contextRadius);
                  for (let i = startLine; i < endLine; ++i) {
                    const isErrorLine = (i + 1 === lineNum);
                    const lineIndicator = isErrorLine ? ">" : " ";
                    const lineContent = jsContentLines[i];
                    console.error(styleText(isErrorLine ? "white" : "dim", `${lineIndicator} ${i + 1} | ${lineContent}`));
                    if (i + 1 === lineNum) {
                      console.error(styleText("white", " ".repeat(colNum + (`${i + 1} | `).length + 1) + "^"));
                    }
                  }
                  // Log an extra line after the code frame for spacing
                  console.log("");
                }
              } else {
                console.error(`Unknown error processing JS bundle ${bundleName}:`, err);
              }
              throw new Error(`Error processing JS bundle ${bundleName}`, {
                cause: err,
              });
            }

            console.log("Writing JS bundle", bundleName, "to", outputFilePath);

            await writeFile(outputFilePath, code, "utf8");
            if (shouldGenerateJSSourceMaps && sourceMap !== null) {
              await writeFile(outputMapFilePath, sourceMap, "utf8");
            }
          })
        );
      }

      await Promise.allSettled([processCSSBundlesPromise, processJSBundlesPromise]);
    });

  return {
    dir: {
      input: "site",
      layouts: "_layouts",
      output: "_site_dist",
    },
  };
}
