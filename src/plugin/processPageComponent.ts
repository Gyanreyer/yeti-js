import { transform as transformCSS } from "lightningcss";
import { transform as transformJS } from 'esbuild';

import { getExternalBundleFilePath, isBundleSrcObject, isInlinedBundleElementNode, PAGE_BUNDLE_NAME, WILDCARD_BUNDLE_NAME, type BundleContribution } from "../bundle/bundle.ts";
import { YETI_NODE_TYPE } from "../html/types.ts";
import type { YetiRootNode, YetiElementNode, YetiChildNode, YetiNode } from "../html/types.ts";
import type { EleventyPageData, YetiPageComponent } from "./types.ts";
import { isCSSTemplateResult } from "../css/css.ts";
import { isJSTemplateResult } from "../js/js.ts";
import { parseHTML } from "../html/parseHTML.ts";
import { isYetiNode } from '../html/utils.ts';
import { getConfig } from "../config.ts";
import { logWarning } from "../log.ts";
import { aOrAn } from "../utils/aOrAn.ts";
import { concatUint8Arrays } from "../utils/concatUint8Arrays.ts";
import { readAndConcatFiles } from "../utils/readAndConcatFiles.ts";
import { textDecoder } from "../utils/textDecoder.ts";
import { mergeHeadContent } from "../html/mergeHeadContent.ts";
import { makeBundleVersionPlaceholder, makePageBundleVersionPlaceholder } from "./bundleVersionPlaceholder.ts";
import { getCSSImportBundle, getJSImportBundle } from "../bundle/bundleImportCache.ts";

/**
 * Warn that a referenced bundle has no content for the page, unless it's the page-scoped
 * `@page` bundle.
 *
 * Referencing `@page` (e.g. `css.src("@page")` in a shared layout) on a page that happens to
 * contribute no content of that asset type is an expected, benign case: not every page has
 * component CSS/JS/HTML. Warning there would be noise on potentially every page, so we stay
 * silent. Named bundles still warn, since an empty named bundle the author explicitly referenced
 * usually signals a mistake (typo, forgotten contribution, wrong asset type).
 */
const warnEmptyBundleReference = (bundleName: string, message: string): void => {
  if (bundleName === PAGE_BUNDLE_NAME) {
    return;
  }
  logWarning(message);
};

/**
 * A page-level aggregate of bundle contributions for a single bundle name. We collect every
 * `BundleContribution` whose name matches across the page component and its rendered tree
 * into one of these structures, then use it to:
 *
 * 1. Render inline bundle content for `${js.inline()}` / `${css.inline()}` references on
 *    this page (the imports are bundled-once via the bundle import cache, the per-component
 *    raw content is concatenated).
 * 2. Hand the same shape up to `eleventy.after` so cross-page merging can union import
 *    paths and concat raw contents one more time before the final transform-and-write step.
 */
export interface PageBundleAggregate {
  importPaths: Set<string>;
  rawContents: Uint8Array[];
}

/**
 * Takes a page component and its props, renders the component to a Yeti node tree, processes any CSS/JS/HTML asset bundles used by the component,
 * and returns the final rendered HTML string for the page, along with any external CSS/JS/HTML bundle contents which should be written to a shared external file.
 *
 * Steps:
 * 1. Extract any CSS/JS attached to the page component on its pageComponent.css and pageComponent.js properties
 * 2. Render the page component to a Yeti node tree
 * 3. Merge the CSS/JS bundle contributions and dependencies from the rendered node tree with the CSS/JS from step 1
 * 4. Perform a transformation pass over the Yeti node tree...
 *    - For each BundleInlineElementNode, get the page's combined raw bundle content for the specified bundle name and asset type
 *      and perform any desired transformations on it. JS bundles should be transformed with esbuild, CSS bundles should be transformed with lightningcss,
 *      HTML bundles should be parsed with parseHTML.
 *      The transformed bundle content should be cached so that if multiple BundleInlineElementNodes reference the same bundle, the bundle content is only transformed once.
 *      Insert the transformed bundle content into the node tree in place of the BundleInlineElementNode.
 *    - For each node attribute which is a BundleSrcObject, get the bundle file path for the specified bundle name and asset type and set that as the new attribute value.
 *      Track the page bundle aggregates for any externally referenced bundle so we can return them and write the combined bundle contents to external files in the "eleventy.after" hook.
 * 5. Render the final processed node tree to an HTML string and return it, along with the page bundle aggregates which can be used by the cross-page merge step
 *      to determine the final external bundle contents and file paths and write the transformed bundle content to external files. The file path should be determined by config.css.deriveBundleFilePath or config.js.deriveBundleFilePath, depending on the asset type.
 */
/**
 * Page-scoped bundle contributions returned alongside cross-page external bundles.
 * Pages whose `inputPath` matches (e.g. pagination variants of the same template) get
 * merged into a single page-bundle file by `eleventy.after`.
 *
 * The `inputPath` field is the page's source template path, used as the merge key. Each
 * asset-type field is `null` if the page contributed nothing to its `@page` bundle for
 * that asset type.
 *
 * Note the shape asymmetry: `css` and `js` are full `PageBundleAggregate`s (importPaths +
 * raw template contents), while `html` is a flat `Set<string>` of import paths. This
 * mirrors the broader HTML-bundling model in this codebase — HTML bundles only support
 * imported files, not raw inline contributions from a tagged template — and is intentional
 * rather than an in-progress simplification.
 */
export interface PageScopedBundles {
  inputPath: string;
  css: PageBundleAggregate | null;
  js: PageBundleAggregate | null;
  html: Set<string> | null;
}

export const processPageComponent = async (pageComponent: YetiPageComponent, pageProps: EleventyPageData): Promise<{
  pageRootNode: YetiRootNode;
  externalBundles: {
    css: Map<string, PageBundleAggregate>;
    js: Map<string, PageBundleAggregate>;
    htmlImportPaths: Map<string, Set<string>>;
  };
  pageBundles: PageScopedBundles;
  dependencies: Set<string>;
}> => {
  const pageDependencies = new Set<string>();

  // Page-level aggregates per bundle name. Populated from both the page component's own
  // js/css template results and from the rendered tree's collected component assets.
  const pageCssBundleAggregates = new Map<string, PageBundleAggregate>();
  const pageJsBundleAggregates = new Map<string, PageBundleAggregate>();

  const addBundleContribution = (
    aggregates: Map<string, PageBundleAggregate>,
    bundleName: string,
    contribution: BundleContribution,
  ) => {
    let agg = aggregates.get(bundleName);
    if (!agg) {
      agg = { importPaths: new Set(), rawContents: [] };
      aggregates.set(bundleName, agg);
    }
    for (const importPath of contribution.importPaths) {
      agg.importPaths.add(importPath);
    }
    if (contribution.rawContent.byteLength > 0) {
      agg.rawContents.push(contribution.rawContent);
    }
    if (contribution.callerFilePath) {
      pageDependencies.add(contribution.callerFilePath);
    }
  };

  // 1. Page component's own CSS/JS contributions
  if (isCSSTemplateResult(pageComponent.css)) {
    for (const [bundleName, contribution] of pageComponent.css.bundles) {
      addBundleContribution(pageCssBundleAggregates, bundleName, contribution);
    }
  }
  if (isJSTemplateResult(pageComponent.js)) {
    for (const [bundleName, contribution] of pageComponent.js.bundles) {
      addBundleContribution(pageJsBundleAggregates, bundleName, contribution);
    }
  }

  // 2. Render the page component
  const pageRootNode = await pageComponent(pageProps);

  // Merge any collected Head component content into the document's <head> element
  mergeHeadContent(pageRootNode);

  // 3. Component-tree CSS/JS contributions, in document order (parseHTML's Set preserves insertion order)
  if (pageRootNode.assets) {
    if (pageRootNode.assets.css) {
      for (const [bundleName, contributionSet] of pageRootNode.assets.css) {
        for (const contribution of contributionSet) {
          addBundleContribution(pageCssBundleAggregates, bundleName, contribution);
        }
      }
    }
    if (pageRootNode.assets.js) {
      for (const [bundleName, contributionSet] of pageRootNode.assets.js) {
        for (const contribution of contributionSet) {
          addBundleContribution(pageJsBundleAggregates, bundleName, contribution);
        }
      }
    }
    if (pageRootNode.assets.html?.dependencies) {
      for (const dependency of pageRootNode.assets.html.dependencies) {
        pageDependencies.add(dependency);
      }
    }
  }

  const config = getConfig();

  /**
   * Resolve a page bundle aggregate into a single Uint8Array of source code by combining
   * the bundled imports (via the process-level cache) with the per-component raw content.
   * Also adds any tracked dependencies from the cache to the page dependency set.
   *
   * Returns null if the aggregate is empty (no imports and no raw content).
   */
  const resolveJSBundleSource = async (aggregate: PageBundleAggregate): Promise<Uint8Array | null> => {
    const codeChunks: Uint8Array[] = [];
    if (aggregate.importPaths.size > 0) {
      const result = await getJSImportBundle(aggregate.importPaths);
      codeChunks.push(result.code);
      for (const dep of result.dependencyFilePaths) {
        pageDependencies.add(dep);
      }
    }
    codeChunks.push(...aggregate.rawContents);
    if (codeChunks.length === 0) {
      return null;
    }
    return concatUint8Arrays(codeChunks);
  };

  const resolveCSSBundleSource = async (aggregate: PageBundleAggregate): Promise<Uint8Array | null> => {
    const codeChunks: Uint8Array[] = [];
    if (aggregate.importPaths.size > 0) {
      const result = await getCSSImportBundle(aggregate.importPaths);
      codeChunks.push(result.code);
      for (const dep of result.dependencyFilePaths) {
        pageDependencies.add(dep);
      }
    }
    codeChunks.push(...aggregate.rawContents);
    if (codeChunks.length === 0) {
      return null;
    }
    return concatUint8Arrays(codeChunks);
  };

  const transformedInlineCSSBundleCache = new Map<string, string>();
  const getInlinedCSSBundleContent = async (bundleName: string): Promise<string | null> => {
    const cachedBundleContent = transformedInlineCSSBundleCache.get(bundleName);
    if (cachedBundleContent) {
      return cachedBundleContent;
    }

    const aggregate = pageCssBundleAggregates.get(bundleName);
    if (!aggregate) {
      return null;
    }

    const combinedRawCode = await resolveCSSBundleSource(aggregate);
    if (!combinedRawCode) {
      return null;
    }

    const transformConfig = config.css.deriveBundleTransformConfig(bundleName, config.css.defaultBundleTransformConfig);
    const transformResult = transformCSS({
      ...transformConfig,
      code: combinedRawCode,
      filename: `${config.css.deriveBundleFilePath(bundleName)}?inlined=true`,
    });

    const transformedCode = textDecoder.decode(transformResult.code);
    transformedInlineCSSBundleCache.set(bundleName, transformedCode);
    return transformedCode;
  };

  const transformedInlineJSBundleCache = new Map<string, string>();
  const getInlinedJSBundleContent = async (bundleName: string): Promise<string | null> => {
    const cachedBundleContent = transformedInlineJSBundleCache.get(bundleName);
    if (cachedBundleContent) {
      return cachedBundleContent;
    }

    const aggregate = pageJsBundleAggregates.get(bundleName);
    if (!aggregate) {
      return null;
    }

    const combinedRawCode = await resolveJSBundleSource(aggregate);
    if (!combinedRawCode) {
      return null;
    }

    const transformConfig = config.js.deriveBundleTransformConfig(bundleName, config.js.defaultBundleTransformConfig);
    const transformResult = await transformJS(combinedRawCode, transformConfig);

    transformedInlineJSBundleCache.set(bundleName, transformResult.code);
    return transformResult.code;
  };

  const htmlBundleImportPaths = new Map(pageRootNode.assets?.html?.bundleImportPaths);
  const transformedInlineHTMLBundleCache = new Map<string, YetiRootNode>();
  const getInlinedHTMLBundleContent = async (bundleName: string): Promise<YetiRootNode | null> => {
    const cachedBundleContent = transformedInlineHTMLBundleCache.get(bundleName);
    if (cachedBundleContent) {
      return cachedBundleContent;
    }

    const bundleImportPathsSet = htmlBundleImportPaths.get(bundleName);
    if (!bundleImportPathsSet || bundleImportPathsSet.size === 0) {
      return null;
    }

    const bundleContentBuffer = await readAndConcatFiles(bundleImportPathsSet);

    let parsedBundleRootNode = await parseHTML(bundleContentBuffer);

    const transformConfig = config.html.deriveBundleTransformConfig(bundleName, config.html.defaultBundleTransformConfig);

    if (transformConfig.processNodeTree) {
      parsedBundleRootNode = await transformConfig.processNodeTree(parsedBundleRootNode);
      if (!isYetiNode(parsedBundleRootNode) || parsedBundleRootNode.type !== YETI_NODE_TYPE.ROOT) {
        throw new Error(`Expected processNodeTree function to return a YetiRootNode for bundle ${bundleName}. Received: ${JSON.stringify(parsedBundleRootNode)}`);
      }
    }

    transformedInlineHTMLBundleCache.set(bundleName, parsedBundleRootNode);
    return parsedBundleRootNode;
  };

  // Track nodes which reference wildcard bundles so that we can perform an additional pass to update their
  // content after processing the page component tree, since we won't know which bundles are used until we've done a first pass.
  const wildcardNodes = new Map<YetiElementNode, {
    parent: YetiRootNode | YetiElementNode;
    assetType: "css" | "js" | "html";
  } & ({
    type: "inline";
  } | {
    type: "src";
    attrNames: Set<string>;
  })>();

  const usedCSSBundleNames = new Set<string>();
  const usedJSBundleNames = new Set<string>();
  const usedHTMLBundleNames = new Set<string>();

  const usedExternalBundleNames = {
    css: new Set<string>(),
    js: new Set<string>(),
    html: new Set<string>(),
  };

  /**
   * Recursively processes a Yeti node tree, transforming any nodes or attributes which reference an asset bundle.
   *
   * Returns null if the node should be left untouched, DELETE_NODE if the node should be removed, or a new Yeti node if the node
   * should be replaced with new content.
   */
  const processTreeNode = async <TNode extends YetiNode>(node: TNode, parent: TNode extends YetiRootNode ? null : YetiElementNode | YetiRootNode): Promise<TNode | TNode[]> => {
    if (node.type === YETI_NODE_TYPE.ELEMENT) {
      if (!parent) {
        throw new Error(`Expected parent node to be defined for element node with tag name "${node.tagName}"`);
      }
      if (isInlinedBundleElementNode(node)) {
        const bundleName = node.attributes.bundleName;
        const assetType = node.attributes.assetType;

        if (bundleName === WILDCARD_BUNDLE_NAME) {
          // If this is a wildcard, we need to process it later after we've processed the entire tree
          // and know which bundles of the appropriate asset type are not referenced by any other
          // inline or src objects in the tree. For now, we'll just add it to the list of wildcard nodes
          // to be processed later and return null to remove it from the tree.
          wildcardNodes.set(node, {
            parent,
            assetType,
            type: "inline",
          });
          return node;
        }

        switch (assetType) {
          case "css": {
            const bundleContent = await getInlinedCSSBundleContent(bundleName);
            if (!bundleContent) {
              warnEmptyBundleReference(bundleName, `Bundle "${bundleName}" is referenced in an inline CSS bundle element but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected.`);
            } else {
              usedCSSBundleNames.add(bundleName);
            }
            return {
              type: YETI_NODE_TYPE.TEXT,
              content: bundleContent ?? "",
            } as TNode;
          }
          case "js": {
            const bundleContent = await getInlinedJSBundleContent(bundleName);
            if (!bundleContent) {
              warnEmptyBundleReference(bundleName, `Bundle "${bundleName}" is referenced in an inline JS bundle element but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected.`);
            } else {
              usedJSBundleNames.add(bundleName);
            }
            return {
              type: YETI_NODE_TYPE.TEXT,
              content: bundleContent ?? "",
            } as TNode;
          }
          case "html": {
            const bundleContentRootNode = await getInlinedHTMLBundleContent(bundleName);
            if (!bundleContentRootNode) {
              warnEmptyBundleReference(bundleName, `Bundle "${bundleName}" is referenced in an inline HTML bundle element but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected.`);
              return {
                type: YETI_NODE_TYPE.TEXT,
                content: "",
              } as TNode;
            }
            usedHTMLBundleNames.add(bundleName);
            return bundleContentRootNode.children as TNode[];
          }
        }
      }

      for (const attrName in node.attributes) {
        const attrValue = node.attributes[attrName];
        if (isBundleSrcObject(attrValue)) {
          const bundleName = attrValue.bundleName;
          const assetType = attrValue.assetType;

          if (bundleName === WILDCARD_BUNDLE_NAME) {
            // If this is a wildcard, we need to process it later after we've processed the entire tree
            // and know which bundles of the appropriate asset type are not referenced by any other
            // inline or src objects in the tree. For now, we'll just add it to the list of wildcard nodes
            // to be processed later and return null to remove it from the tree.
            const existingWildcardEntry = wildcardNodes.get(node);
            if (existingWildcardEntry) {
              if (existingWildcardEntry.type !== "src") {
                throw new Error(`Expected existing wildcard node entry to be of type "src" for element node with tag name "${node.tagName}"`);
              }
              existingWildcardEntry.attrNames.add(attrName);
            } else {
              wildcardNodes.set(node, {
                parent: parent!,
                assetType,
                type: "src",
                attrNames: new Set([attrName]),
              });
            }
          } else {
            const getSrcValueForBundle = () => {
              const bundleFilePath = bundleName === PAGE_BUNDLE_NAME
                ? config[assetType].derivePageBundleFilePath(pageProps.page)
                : getExternalBundleFilePath(bundleName, assetType);
              const placeholder = bundleName === PAGE_BUNDLE_NAME
                ? makePageBundleVersionPlaceholder(assetType, pageProps.page.inputPath)
                : makeBundleVersionPlaceholder(assetType, bundleName);
              // Use URL to parse any user-provided trailing content into query/hash components,
              // merge in the version placeholder, and reconstruct the full value
              const url = new URL(`${bundleFilePath}${attrValue.afterContent ?? ""}`, "http://y");
              url.searchParams.set("v", placeholder);
              return `${attrValue.beforeContent ?? ""}${url.pathname}${url.search}${url.hash}`;
            };

            // Only track a referenced bundle as "used" (which the assembly step below expects to
            // resolve to an aggregate) when it actually has content. An empty referenced bundle has
            // its attribute dropped and is otherwise skipped — see `warnEmptyBundleReference`.
            switch (assetType) {
              case "css": {
                if (pageCssBundleAggregates.has(bundleName)) {
                  node.attributes[attrName] = getSrcValueForBundle();
                  usedCSSBundleNames.add(bundleName);
                  usedExternalBundleNames.css.add(bundleName);
                } else {
                  delete node.attributes[attrName];
                  warnEmptyBundleReference(bundleName, `Bundle "${bundleName}" is referenced in ${aOrAn(attrName)} ${attrName} attribute for CSS asset type but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected. The attribute "${attrName}" will be removed from the element with tag name "${node.tagName}".`);
                }
                break;
              }
              case "js": {
                if (pageJsBundleAggregates.has(bundleName)) {
                  node.attributes[attrName] = getSrcValueForBundle();
                  usedJSBundleNames.add(bundleName);
                  usedExternalBundleNames.js.add(bundleName);
                } else {
                  delete node.attributes[attrName];
                  warnEmptyBundleReference(bundleName, `Bundle "${bundleName}" is referenced in ${aOrAn(attrName)} ${attrName} attribute for JS asset type but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected. The attribute "${attrName}" will be removed from the element with tag name "${node.tagName}".`);
                }
                break;
              }
              case "html": {
                if (htmlBundleImportPaths.has(bundleName)) {
                  node.attributes[attrName] = getSrcValueForBundle();
                  usedHTMLBundleNames.add(bundleName);
                  usedExternalBundleNames.html.add(bundleName);
                } else {
                  delete node.attributes[attrName];
                  warnEmptyBundleReference(bundleName, `Bundle "${bundleName}" is referenced in ${aOrAn(attrName)} ${attrName} attribute for HTML asset type but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected. The attribute "${attrName}" will be removed from the element with tag name "${node.tagName}".`);
                }
                break;
              }
            }
          }
        }
      }
    }

    if ((node.type === YETI_NODE_TYPE.ROOT || node.type === YETI_NODE_TYPE.ELEMENT) && node.children) {
      // Recursively process child nodes in parallel — children are independent of each other
      const childResults = await Promise.all(node.children.map(child => processTreeNode(child, node)));
      const newChildren: YetiChildNode[] = [];
      for (const result of childResults) {
        if (Array.isArray(result)) {
          newChildren.push(...result);
        } else {
          newChildren.push(result);
        }
      }
      node.children = newChildren;
    }

    return node;
  };

  await processTreeNode(pageRootNode, null);

  if (wildcardNodes.size > 0) {
    const unusedBundleNames = {
      css: new Set(pageCssBundleAggregates.keys()).difference(usedCSSBundleNames),
      js: new Set(pageJsBundleAggregates.keys()).difference(usedJSBundleNames),
      html: new Set(htmlBundleImportPaths.keys()).difference(usedHTMLBundleNames),
    }

    for (const [node, wildCardNode] of wildcardNodes.entries()) {
      const { parent, assetType, type } = wildCardNode;

      if (!parent.children) {
        throw new Error(`Expected parent node to have children for wildcard node with tag name "${node.tagName}"`);
      }

      const parentChildIndex = parent.children.findIndex((child) => child === node);
      if (parentChildIndex === -1) {
        throw new Error(`Expected to find wildcard node with tag name "${node.tagName}" in children of its parent node.`);
      }

      const bundleNamesToUse = unusedBundleNames[assetType];

      if (bundleNamesToUse.size === 0) {
        // Remove the wildcard node from the tree since there are no bundles of the appropriate asset type
        parent.children.splice(parentChildIndex, 1);
        continue;
      }

      const replacementNodes: YetiChildNode[] = [];

      for (const bundleName of bundleNamesToUse) {
        if (type === "inline") {
          switch (assetType) {
            case "css": {
              const bundleContent = await getInlinedCSSBundleContent(bundleName);
              if (bundleContent === null) {
                throw new Error(`Expected to find content for bundle "${bundleName}" of asset type "css" when processing wildcard bundle reference in element with tag name "${node.tagName}".`);
              }

              usedCSSBundleNames.add(bundleName);
              replacementNodes.push({
                type: YETI_NODE_TYPE.TEXT,
                content: bundleContent,
              });
              break;
            }
            case "js": {
              const bundleContent = await getInlinedJSBundleContent(bundleName);
              if (bundleContent === null) {
                throw new Error(`Expected to find content for bundle "${bundleName}" of asset type "js" when processing wildcard bundle reference in element with tag name "${node.tagName}".`);
              }

              usedJSBundleNames.add(bundleName);
              replacementNodes.push({
                type: YETI_NODE_TYPE.TEXT,
                content: bundleContent,
              });
              break;
            }
            case "html": {
              const bundleContentRootNode = await getInlinedHTMLBundleContent(bundleName);
              if (bundleContentRootNode === null) {
                throw new Error(`Expected to find content for bundle "${bundleName}" of asset type "html" when processing wildcard bundle reference in element with tag name "${node.tagName}".`);
              }

              usedHTMLBundleNames.add(bundleName);
              replacementNodes.push(...bundleContentRootNode.children);
              break;
            }
          }
        } else {
          const newNode = { ...node, attributes: { ...node.attributes } };
          for (const attrName of wildCardNode.attrNames) {
            const bundleFilePath = bundleName === PAGE_BUNDLE_NAME
              ? config[assetType].derivePageBundleFilePath(pageProps.page)
              : getExternalBundleFilePath(bundleName, assetType);
            const placeholder = bundleName === PAGE_BUNDLE_NAME
              ? makePageBundleVersionPlaceholder(assetType, pageProps.page.inputPath)
              : makeBundleVersionPlaceholder(assetType, bundleName);
            const url = new URL(bundleFilePath, "http://y");
            url.searchParams.set("v", placeholder);
            newNode.attributes[attrName] = `${url.pathname}${url.search}${url.hash}`;
          }
          replacementNodes.push(newNode);
          usedExternalBundleNames[assetType].add(bundleName);
        }
      }

      if (replacementNodes.length === 1) {
        parent.children[parentChildIndex] = replacementNodes[0];
      } else {
        parent.children.splice(parentChildIndex, 1, ...replacementNodes);
      }
    }
  }

  // Assemble final map of externally referenced bundle aggregates which we'll need to merge
  // across pages and write to external files in the "eleventy.after" hook.
  // Page-scoped (`@page`) bundles are segregated into `pageBundles` so the plugin layer can
  // route them through `derivePageBundleFilePath` and merge them by inputPath across
  // pagination variants of the same template.
  const externalBundles = {
    css: new Map<string, PageBundleAggregate>(),
    js: new Map<string, PageBundleAggregate>(),
    htmlImportPaths: new Map<string, Set<string>>(),
  };
  const pageBundles: PageScopedBundles = {
    inputPath: pageProps.page.inputPath,
    css: null,
    js: null,
    html: null,
  };

  // For external bundles, we also need to make sure their import deps are tracked as page
  // dependencies even if they were never inlined (which would have populated deps as a
  // side effect of the inline rendering pass). Cache hits make this cheap when the bundle
  // was already resolved for inline content earlier.
  const externalDepTrackingTasks: Promise<void>[] = [];

  for (const bundleName of usedExternalBundleNames.css) {
    const aggregate = pageCssBundleAggregates.get(bundleName);
    if (!aggregate) {
      throw new Error(`Expected to find aggregate for externally referenced CSS bundle "${bundleName}".`);
    }
    if (bundleName === PAGE_BUNDLE_NAME) {
      pageBundles.css = aggregate;
    } else {
      externalBundles.css.set(bundleName, aggregate);
    }
    if (aggregate.importPaths.size > 0) {
      externalDepTrackingTasks.push((async () => {
        const result = await getCSSImportBundle(aggregate.importPaths);
        for (const dep of result.dependencyFilePaths) {
          pageDependencies.add(dep);
        }
      })());
    }
  }
  for (const bundleName of usedExternalBundleNames.js) {
    const aggregate = pageJsBundleAggregates.get(bundleName);
    if (!aggregate) {
      throw new Error(`Expected to find aggregate for externally referenced JS bundle "${bundleName}".`);
    }
    if (bundleName === PAGE_BUNDLE_NAME) {
      pageBundles.js = aggregate;
    } else {
      externalBundles.js.set(bundleName, aggregate);
    }
    if (aggregate.importPaths.size > 0) {
      externalDepTrackingTasks.push((async () => {
        const result = await getJSImportBundle(aggregate.importPaths);
        for (const dep of result.dependencyFilePaths) {
          pageDependencies.add(dep);
        }
      })());
    }
  }
  for (const bundleName of usedExternalBundleNames.html) {
    const bundleImportPaths = htmlBundleImportPaths.get(bundleName);
    if (!bundleImportPaths) {
      throw new Error(`Expected to find bundle import paths for externally referenced HTML bundle "${bundleName}".`);
    }
    if (bundleName === PAGE_BUNDLE_NAME) {
      pageBundles.html = bundleImportPaths;
    } else {
      externalBundles.htmlImportPaths.set(bundleName, bundleImportPaths);
    }
  }

  await Promise.all(externalDepTrackingTasks);

  // Delete assets object from root node since we don't need it now that we've processed it
  delete pageRootNode.assets;

  return {
    pageRootNode,
    externalBundles,
    pageBundles,
    dependencies: pageDependencies,
  };
};
