import { transform as transformCSS, type TransformOptions as LightningCSSTransformOptions, type CustomAtRules } from "lightningcss";
import { transform as transformJS, type TransformOptions as ESBuildTransformOptions } from 'esbuild';
import { open, type FileHandle } from "node:fs/promises";

import { getExternalBundleFilePath, isBundleSrcObject, isInlinedBundleElementNode, WILDCARD_BUNDLE_NAME } from "../bundle/bundle.ts";
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
import { textDecoder } from "../utils/textDecoder.ts";

/**
 * Takes a page component and its props, renders the component to a Yeti node tree, processes any CSS/JS/HTML asset bundles used by the component,
 * and returns the final rendered HTML string for the page, along with any external CSS/JS/HTML bundle contents which should be written to a shared external file.
 *
 * Steps:
 * 1. Extract any CSS/JS attached to the page component on its pageComponent.css and pageComponent.js properties
 * 2. Render the page component to a Yeti node tree
 * 3. Merge the CSS/JS bundles and dependencies from the rendered node tree with the CSS/JS from step 1
 * 4. Perform a transformation pass over the Yeti node tree...
 *    - For each BundleInlineElementNode, get the page's combined raw bundle content for the specified bundle name and asset type
 *      and perform any desired transformations on it. JS bundles should be transformed with esbuild, CSS bundles should be transformed with lightningcss,
 *      HTML bundles should be parsed with parseHTML.
 *      The transformed bundle content should be cached so that if multiple BundleInlineElementNodes reference the same bundle, the bundle content is only transformed once.
 *      Insert the transformed bundle content into the node tree in place of the BundleInlineElementNode.
 *    - For each node attribute which is a BundleSrcObject, get the bundle file path for the specified bundle name and asset type and set that as the new attribute value.
 *      Track the set of getters for the referenced bundle as an externally refrenced bundle so we can return them and write the combined bundle contents to external files in the "eleventy.after" hook.
 * 5. Render the final processed node tree to an HTML string and return it, along with the map of external bundle getters which can be used to get the final transformed bundle contents for any externally
 *    referenced bundles so that we can determine the final external bundle contents and file paths
 *      and write the transformed bundle content to an external file. The file path should be determined by config.css.deriveBundleFilePath or config.js.deriveBundleFilePath, depending on the asset type.
 */
export const processPageComponent = async (pageComponent: YetiPageComponent, pageProps: EleventyPageData): Promise<{
  pageRootNode: YetiRootNode;
  externalBundles: {
    css: Map<string, Set<Uint8Array>>;
    js: Map<string, Set<Uint8Array>>;
    htmlImportPaths: Map<string, Set<string>>;
  };
  dependencies: {
    css: Set<string>;
    js: Set<string>;
    html: Set<string>;
  };
}> => {
  const pageCssBundleCode = new Map<string, Set<Uint8Array>>();
  const pageCssDependencies = new Set<string>();

  if (isCSSTemplateResult(pageComponent.css)) {
    for (const [bundleName, bundleGetter] of pageComponent.css.bundles) {
      const result = await bundleGetter();
      pageCssBundleCode.set(bundleName, new Set([result.code]));
      for (const dependency of result.dependencies) {
        pageCssDependencies.add(dependency);
      }
    }
  }
  const pageJsBundleCode = new Map<string, Set<Uint8Array>>();
  const pageJsDependencies = new Set<string>();

  if (isJSTemplateResult(pageComponent.js)) {
    for (const [bundleName, bundleGetter] of pageComponent.js.bundles) {
      const result = await bundleGetter();
      pageJsBundleCode.set(bundleName, new Set([result.code]));
      for (const dependency of result.dependencies) {
        pageJsDependencies.add(dependency);
      }
    }
  }

  const pageRootNode = await pageComponent(pageProps);
  if (pageRootNode.assets) {
    if (pageRootNode.assets.css) {
      for (const [bundleName, bundleGetterSet] of pageRootNode.assets.css) {
        let bundleGetters = pageCssBundleCode.get(bundleName);
        if (!bundleGetters) {
          bundleGetters = new Set();
          pageCssBundleCode.set(bundleName, bundleGetters);
        }
        for (const bundleGetter of bundleGetterSet) {
          const result = await bundleGetter();
          bundleGetters.add(result.code);
          for (const dependency of result.dependencies) {
            pageCssDependencies.add(dependency);
          }
        }
      }
    }
    if (pageRootNode.assets.js) {
      for (const [bundleName, bundleGetterSet] of pageRootNode.assets.js) {
        let bundleGetters = pageJsBundleCode.get(bundleName);
        if (!bundleGetters) {
          bundleGetters = new Set();
          pageJsBundleCode.set(bundleName, bundleGetters);
        }
        for (const bundleGetter of bundleGetterSet) {
          const result = await bundleGetter();
          bundleGetters.add(result.code);
          for (const dependency of result.dependencies) {
            pageJsDependencies.add(dependency);
          }
        }
      }
    }
  }

  const config = getConfig();

  const transformedInlineCSSBundleCache = new Map<string, string>();
  const getInlinedCSSBundleContent = async (bundleName: string): Promise<string | null> => {
    const cachedBundleContent = transformedInlineCSSBundleCache.get(bundleName);
    if (cachedBundleContent) {
      return cachedBundleContent;
    }

    const bundleContentSet = pageCssBundleCode.get(bundleName);
    if (!bundleContentSet) {
      return null;
    }

    let combinedCodeLength = 0;
    for (const chunk of bundleContentSet) {
      combinedCodeLength += chunk.length;
    }
    const combinedRawCode = new Uint8Array(combinedCodeLength);
    let offset = 0;
    for (const chunk of bundleContentSet) {
      combinedRawCode.set(chunk, offset);
      offset += chunk.length;
    }

    const transformResult = transformCSS(Object.assign({
      code: combinedRawCode,
      filename: `${config.css.deriveBundleFilePath(bundleName)}?inlined=true`,
      minify: true,
    } satisfies LightningCSSTransformOptions<CustomAtRules>, config.css.deriveBundleTransformConfig?.(bundleName)));

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

    const bundleContentSet = pageJsBundleCode.get(bundleName);
    if (!bundleContentSet) {
      return null;
    }

    let combinedCodeLength = 0;
    for (const chunk of bundleContentSet) {
      combinedCodeLength += chunk.length;
    }
    const combinedRawCode = new Uint8Array(combinedCodeLength);
    let offset = 0;
    for (const chunk of bundleContentSet) {
      combinedRawCode.set(chunk, offset);
      offset += chunk.length;
    }

    const transformResult = await transformJS(combinedRawCode, Object.assign({
      minify: true,
    } satisfies ESBuildTransformOptions, config.js.deriveBundleTransformConfig?.(bundleName)));

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

    const fileHandles = new Array<FileHandle>(bundleImportPathsSet.size);
    let handleIndex = 0;

    let bundleByteLength = 0;
    for (const importPath of bundleImportPathsSet) {
      const fileHandle = await open(importPath, "r");
      const stats = await fileHandle.stat();
      bundleByteLength += stats.size;
      fileHandles[handleIndex++] = fileHandle;
    }

    const bundleContentBuffer = new Uint8Array(bundleByteLength);
    let offset = 0;
    for (const fileHandle of fileHandles) {
      const { bytesRead } = await fileHandle.read(bundleContentBuffer, offset);
      offset += bytesRead;
      await fileHandle.close();
    }

    let parsedBundleRootNode = await parseHTML(bundleContentBuffer, []);

    if (config.html.processBundle && (config.html.processBundle[bundleName] || config.html.processBundle[WILDCARD_BUNDLE_NAME])) {
      // If a processBundle function is provided for this bundle name, we need to parse the combined
      // HTML into a Yeti node tree so that we can pass it to the processBundle function, and then
      // render the processed tree back into HTML to get the final bundle content.
      if (config.html.processBundle[bundleName]) {
        parsedBundleRootNode = await config.html.processBundle[bundleName](parsedBundleRootNode, bundleName);
        if (!isYetiNode(parsedBundleRootNode) || parsedBundleRootNode.type !== YETI_NODE_TYPE.ROOT) {
          throw new Error(`Expected config.html.processBundle["${bundleName}"] function to return a YetiRootNode. Received: ${JSON.stringify(parsedBundleRootNode)}`);
        }
      }
      if (config.html.processBundle[WILDCARD_BUNDLE_NAME]) {
        // If we have a wildcard processBundle function, perform an additional pass after the specific bundle name pass
        // to allow the wildcard function to apply generic transformations to the bundle's HTML tree, or to process bundles without specific functions.
        parsedBundleRootNode = await config.html.processBundle[WILDCARD_BUNDLE_NAME](parsedBundleRootNode, bundleName);
        if (!isYetiNode(parsedBundleRootNode) || parsedBundleRootNode.type !== YETI_NODE_TYPE.ROOT) {
          throw new Error(`Expected config.html.processBundle["${WILDCARD_BUNDLE_NAME}"] function to return a YetiRootNode. Received: ${JSON.stringify(parsedBundleRootNode)}`);
        }
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
              logWarning(`Bundle "${bundleName}" is referenced in an inline CSS bundle element but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected.`);
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
              logWarning(`Bundle "${bundleName}" is referenced in an inline JS bundle element but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected.`);
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
              logWarning(`Bundle "${bundleName}" is referenced in an inline HTML bundle element but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected.`);
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
            switch (assetType) {
              case "css": {
                if (pageCssBundleCode.has(bundleName)) {
                  const bundleFilePath = getExternalBundleFilePath(bundleName, assetType);
                  node.attributes[attrName] = bundleFilePath;
                  usedCSSBundleNames.add(bundleName);
                } else {
                  delete node.attributes[attrName];
                  logWarning(`Bundle "${bundleName}" is referenced in ${aOrAn(attrName)} ${attrName} attribute for CSS asset type but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected. The attribute "${attrName}" will be removed from the element with tag name "${node.tagName}".`);
                }
                break;
              }
              case "js": {
                if (pageJsBundleCode.has(bundleName)) {
                  const bundleFilePath = getExternalBundleFilePath(bundleName, assetType);
                  node.attributes[attrName] = bundleFilePath;
                  usedJSBundleNames.add(bundleName);
                } else {
                  delete node.attributes[attrName];
                  logWarning(`Bundle "${bundleName}" is referenced in ${aOrAn(attrName)} ${attrName} attribute for JS asset type but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected. The attribute "${attrName}" will be removed from the element with tag name "${node.tagName}".`);
                }
                break;
              }
              case "html": {
                if (htmlBundleImportPaths.has(bundleName)) {
                  const bundleFilePath = getExternalBundleFilePath(bundleName, assetType);
                  node.attributes[attrName] = bundleFilePath;
                  usedHTMLBundleNames.add(bundleName);
                } else {
                  delete node.attributes[attrName];
                  logWarning(`Bundle "${bundleName}" is referenced in ${aOrAn(attrName)} ${attrName} attribute for HTML asset type but no content was found for that bundle. This may mean that the bundle is empty or not being included in the output as expected. The attribute "${attrName}" will be removed from the element with tag name "${node.tagName}".`);
                }
                break;
              }
            }
            usedExternalBundleNames[assetType].add(bundleName);
          }
        }
      }
    }

    if ((node.type === YETI_NODE_TYPE.ROOT || node.type === YETI_NODE_TYPE.ELEMENT) && node.children) {
      // Recursively process child nodes
      for (let i = 0; i < node.children.length; i++) {
        const childNode = node.children[i];
        const result = await processTreeNode(childNode, node);
        if (Array.isArray(result)) {
          node.children.splice(i, 1, ...result);
          i += result.length - 1;
        } else {
          node.children[i] = result;
        }
      }
    }

    return node;
  };

  await processTreeNode(pageRootNode, null);

  if (wildcardNodes.size > 0) {
    const unusedBundleNames = {
      css: new Set(pageCssBundleCode.keys()).difference(usedCSSBundleNames),
      js: new Set(pageJsBundleCode.keys()).difference(usedJSBundleNames),
      html: new Set(htmlBundleImportPaths.keys()).difference(usedHTMLBundleNames),
    }

    let wildCardAssetTypeCounts: Record<"css" | "js" | "html", number> = {
      css: 0,
      js: 0,
      html: 0,
    };

    for (const [node, wildCardNode] of wildcardNodes.entries()) {
      const { parent, assetType, type } = wildCardNode;

      wildCardAssetTypeCounts[assetType]++;
      if (wildCardAssetTypeCounts[assetType] > 1) {
        logWarning(`Duplicate wildcard bundle reference found for asset type "${assetType}" in element with tag name "${node.tagName}". This wildcard reference will never produce any output.`);
      }

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
            newNode.attributes[attrName] = getExternalBundleFilePath(bundleName, assetType);
          }
          replacementNodes.push(newNode);
          usedExternalBundleNames[assetType].add(bundleName);
        }
      }

      parent.children.splice(parentChildIndex, 1, ...replacementNodes);
      // We've consumed all the bundles for this wildcard node, so we can clear
      // the set to prevent any future wildcard nodes from using the same bundles
      bundleNamesToUse.clear();
    }
  }

  // Assemble final map of externally referenced bundle contents which
  // we'll need to write to external files in the "eleventy.after" hook
  const externalBundles = {
    css: new Map<string, Set<Uint8Array>>(),
    js: new Map<string, Set<Uint8Array>>(),
    htmlImportPaths: new Map<string, Set<string>>(),
  };

  for (const bundleName of usedExternalBundleNames.css) {
    const bundleCode = pageCssBundleCode.get(bundleName);
    if (!bundleCode) {
      throw new Error(`Expected to find bundle code for externally referenced CSS bundle "${bundleName}".`);
    }
    externalBundles.css.set(bundleName, bundleCode);
  }
  for (const bundleName of usedExternalBundleNames.js) {
    const bundleCode = pageJsBundleCode.get(bundleName);
    if (!bundleCode) {
      throw new Error(`Expected to find bundle code for externally referenced JS bundle "${bundleName}".`);
    }
    externalBundles.js.set(bundleName, bundleCode);
  }
  for (const bundleName of usedExternalBundleNames.html) {
    const bundleImportPaths = htmlBundleImportPaths.get(bundleName);
    if (!bundleImportPaths) {
      throw new Error(`Expected to find bundle import paths for externally referenced HTML bundle "${bundleName}".`);
    }
    externalBundles.htmlImportPaths.set(bundleName, bundleImportPaths);
  }

  const dependencies = {
    css: pageCssDependencies,
    js: pageJsDependencies,
    html: new Set<string>(pageRootNode.assets?.html?.dependencies),
  };

  // Delete assets object from root node since we don't need it now that we've processed it
  delete pageRootNode.assets;

  return {
    pageRootNode,
    externalBundles,
    dependencies,
  };
};