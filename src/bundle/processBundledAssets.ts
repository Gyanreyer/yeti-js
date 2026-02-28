import { transform as transformCSS, type TransformOptions as LightningCSSTransformOptions, type CustomAtRules } from "lightningcss";
import { transform as transformJS, TransformOptions as ESBuildTransformOptions } from 'esbuild';

import { getExternalBundleFilePath, isBundleSrcObject, isInlinedBundleElementNode, WILDCARD_BUNDLE_NAME } from "../bundle/bundle.ts";
import { YETI_NODE_TYPE } from "../html/types.ts";
import type { YetiRootNode, YetiElementNode, YetiChildNode } from "../html/types.ts";
import { getConfig } from "../config.ts";
import { parseHTML } from "../html/parseHTML.ts";
import { textEncoder } from "../utils/textEncoder.ts";
import { textDecoder } from "../utils/textDecoder.ts";
import { renderHTML } from "../html/renderHTML.ts";
import { BundleError } from "../error.ts";
import { CSSBundleGetterMap } from "../css/css.ts";
import { JSBundleGetterMap } from "../js/js.ts";

const DELETE_NODE = Symbol("DELETE_NODE");

// Recursively traverse the root node's children and insert the appropriate bundle contents at the locations of any bundle inline or src objects.
// - HTML bundles can only be inlined. Their contents should be parsed into Yeti nodes and inserted directly into the tree at the location of the inline object.
// - CSS and JS bundles can either be inlined or placed at an external src, depending on the type of bundle object.
//   - Inlined bundles can be found as child element nodes with a special tagname and attributes. The inline node should be replaced by a Yeti text node containing the bundle's text content.
//     - If the referenced bundle is empty or does not exist, the inline node should just be removed from the tree.
//     - If this is a wildcard with the special wildcard bundle name, then we should insert the contents of all bundles of the appropriate asset type which are not referenced by any other inline or src objects in the tree.
//   - Src bundles can be found on attributes of element nodes. We only need to look at <script> tags' "src" attributes and <link> tags' "href" attributes.
//     We should write the bundle's contents to an external file with the bundle's name. The attribute value should be replaced by a string containing the path to the external bundle file.
//     - If the referenced bundle is empty or does not exist, the element should just be removed from the tree.
//     - If this is a wildcard with the special wildcard bundle name, then we should duplicate the tag with a different attribute value for each bundle of the appropriate asset type which
//       is not referenced by any other inline or src objects in the tree.
export const processBundledAssets = async (rootNode: YetiRootNode): Promise<{
  rootNode: YetiRootNode,
  externalBundleContents: {
    css: Map<string, string[]>;
    js: Map<string, string[]>;
    html: Map<string, string[]>;
  };
  dependencies: {
    css: Set<string>;
    js: Set<string>;
    html: Set<string>;
  };
}> => {
  const config = getConfig();

  const dependencies = {
    css: new Set<string>(),
    js: new Set<string>(),
    html: new Set(rootNode.assets?.html?.dependencies),
  };

  const inlinedCSSBundleContentCache = new Map<string, string>();
  const getInlinedCSSBundleContent = async (bundleName: string): Promise<string | null> => {
    const cachedBundleContents = inlinedCSSBundleContentCache.get(bundleName);
    if (cachedBundleContents) {
      return cachedBundleContents;
    }

    const getterSet = rootNode.assets?.css?.get(bundleName);
    if (!getterSet) {
      return null;
    }

    const rawCodeChunks: Uint8Array[] = [];

    for (const getter of getterSet) {
      const rawBundleResult = await getter();
      rawCodeChunks.push(rawBundleResult.code);
      for (const dep of rawBundleResult.dependencies) {
        dependencies.css.add(dep);
      }
    }

    let combinedCodeLength = 0;
    for (const chunk of rawCodeChunks) {
      combinedCodeLength += chunk.length;
    }
    const combinedRawCode = new Uint8Array(combinedCodeLength);
    let offset = 0;
    for (const chunk of rawCodeChunks) {
      combinedRawCode.set(chunk, offset);
      offset += chunk.length;
    }

    const transformResult = transformCSS(Object.assign({
      code: combinedRawCode,
      filename: `${config.css.deriveBundleFilePath(bundleName)}?inlined=true`,
      minify: true,
    } satisfies LightningCSSTransformOptions<CustomAtRules>, config.css.deriveBundleTransformConfig?.(bundleName)));

    const transformedCode = textDecoder.decode(transformResult.code);
    inlinedCSSBundleContentCache.set(bundleName, transformedCode);
    return transformedCode;
  };

  const inlinedJSBundleContentCache = new Map<string, string>();
  const getInlinedJSBundleContent = async (bundleName: string): Promise<string | null> => {
    const cachedBundleContents = inlinedJSBundleContentCache.get(bundleName);
    if (cachedBundleContents) {
      return cachedBundleContents;
    }

    const getterSet = rootNode.assets?.js?.get(bundleName);
    if (!getterSet) {
      return null;
    }

    const rawCodeChunks: Uint8Array[] = [];

    for (const getter of getterSet) {
      const rawBundleResult = await getter();
      rawCodeChunks.push(rawBundleResult.code);
      for (const dep of rawBundleResult.dependencies) {
        dependencies.js.add(dep);
      }
    }

    let combinedCodeLength = 0;
    for (const chunk of rawCodeChunks) {
      combinedCodeLength += chunk.length;
    }
    const combinedRawCode = new Uint8Array(combinedCodeLength);
    let offset = 0;
    for (const chunk of rawCodeChunks) {
      combinedRawCode.set(chunk, offset);
      offset += chunk.length;
    }

    const transformResult = await transformJS(combinedRawCode, Object.assign({
      minify: true,
    } satisfies ESBuildTransformOptions, config.js.deriveBundleTransformConfig?.(bundleName)));

    inlinedJSBundleContentCache.set(bundleName, transformResult.code);
    return transformResult.code;
  };

  const inlinedHTMLBundleContentCache = new Map<string, string>();
  const getHTMLBundleContent = async (bundleName: string): Promise<string | null> => {
    const cachedBundleContents = inlinedHTMLBundleContentCache.get(bundleName);
    if (cachedBundleContents) {
      return cachedBundleContents;
    }

    const bundleChunks = rootNode.assets?.html?.bundles?.get(bundleName);
    if (!bundleChunks) {
      return null;
    }

    let htmlContent = bundleChunks.join("");

    if (config.html.processBundle && (config.html.processBundle[bundleName] || config.html.processBundle[WILDCARD_BUNDLE_NAME])) {
      // If a processBundle function is provided for this bundle name, we need to parse the combined
      // HTML into a Yeti node tree so that we can pass it to the processBundle function, and then
      // render the processed tree back into HTML to get the final bundle content.
      const parsedBundleRootNode = await parseHTML(textEncoder.encode(htmlContent), []);
      let processedNode = parsedBundleRootNode;
      if (config.html.processBundle[bundleName]) {
        processedNode = await config.html.processBundle[bundleName](processedNode, bundleName);
      }
      if (config.html.processBundle[WILDCARD_BUNDLE_NAME]) {
        // If we have a wildcard processBundle function, perform an additional pass after the specific bundle name pass
        // to allow the wildcard function to apply generic transformations to the bundle's HTML tree, or to process bundles without specific functions.
        processedNode = await config.html.processBundle[WILDCARD_BUNDLE_NAME](processedNode, bundleName);
      }
      htmlContent = renderHTML(processedNode);
    }

    inlinedHTMLBundleContentCache.set(bundleName, htmlContent);

    return htmlContent;
  };

  const externalBundles: {
    css?: CSSBundleGetterMap;
    js?: JSBundleGetterMap;
    html?: Map<string, string[]>;
  } = {};

  const wildcardNodes = new Array<{
    node: YetiElementNode;
    parent: YetiRootNode | YetiElementNode;
    assetType: "css" | "js" | "html";
  } & ({
    type: "inline";
  } | {
    type: "src";
    attrName: string;
  })>();

  const processNode = async (node: YetiChildNode, parent: YetiRootNode | YetiElementNode): Promise<YetiChildNode | typeof DELETE_NODE | null> => {
    if (node.type !== YETI_NODE_TYPE.ELEMENT) {
      return null;
    }

    if (!parent.children) {
      throw new Error("Expected parent node to have children. This state should not be possible.");
    }

    // Check for bundle inline element
    if (isInlinedBundleElementNode(node)) {
      const bundleName = node.attributes.bundleName;
      const assetType = node.attributes.assetType;

      if (bundleName === WILDCARD_BUNDLE_NAME) {
        // If this is a wildcard, we need to process it later after we've processed the entire tree
        // and know which bundles of the appropriate asset type are not referenced by any other
        // inline or src objects in the tree. For now, we'll just add it to the list of wildcard nodes
        // to be processed later and return null to remove it from the tree.
        wildcardNodes.push({
          node,
          type: "inline",
          assetType,
          parent,
        });
        return null;
      }

      let bundleContent: string | null;
      if (assetType === "css") {
        bundleContent = await getInlinedCSSBundleContent(bundleName);
      } else if (assetType === "js") {
        bundleContent = await getInlinedJSBundleContent(bundleName);
      } else {
        bundleContent = await getHTMLBundleContent(bundleName);
      }

      if (!bundleContent) {
        // If we don't have any content for this bundle, just remove the node from the tree
        return DELETE_NODE;
      } else {
        // Replace the inline node with a text node containing the bundle content
        return {
          type: YETI_NODE_TYPE.TEXT,
          content: bundleContent,
        };
      }
    }

    if (node.attributes) {
      // Check for bundle src objects on this element's attributes
      for (const attrName in node.attributes) {
        const attrValue: unknown = node.attributes[attrName];
        if (isBundleSrcObject(attrValue)) {
          const bundleName = attrValue.bundleName;
          const assetType = attrValue.assetType;

          if (bundleName === WILDCARD_BUNDLE_NAME) {
            // If this is a wildcard, we need to process it later after we've processed the entire tree
            wildcardNodes.push({
              node,
              type: "src",
              attrName,
              assetType,
              parent,
            });
          } else {
            let bundleContent;
            if (assetType === "html") {
              bundleContent = rootNode.assets?.html?.bundles?.get(bundleName) ?? null;
            } else {
              bundleContent = rootNode.assets?.[assetType]?.get(bundleName) ?? null;
            }

            if (!bundleContent) {
              // If we don't have any content for this bundle, we can just skip adding this attribute to the new attributes object, which will have the effect of removing it from the element in the tree.
              delete node.attributes[attrName];
            } else {
              // Replace the bundle src object with a string containing the path to the external bundle file.
              // For now we can just use the bundle name as the path, but this will be updated to the actual file path in a later step.
              node.attributes[attrName] = getExternalBundleFilePath(bundleName, assetType);
              externalBundles[assetType] ??= new Map();
              externalBundles[assetType].set(bundleName, bundleContent as any);
            }
          }
        }
      }
    }

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const result = await processNode(child, node);
        if (result === DELETE_NODE) {
          const prevSibling = node.children[i - 1];
          if (prevSibling && prevSibling.type === YETI_NODE_TYPE.TEXT && prevSibling.content.trim() === "") {
            // Delete preceding whitespace-only text node along with the deleted node to avoid leaving extraneous whitespace in the tree.
            node.children.splice(i - 1, 2);
          } else {
            node.children.splice(i, 1);
          }
          // Adjust the index to account for the removed element
          i--;
        } else if (result) {
          // Replace the child node with the returned node
          node.children[i] = result;
        }
      }
      if (node.children.length === 0) {
        delete node.children;
      }
    }

    return null;
  };

  for (let i = 0; i < rootNode.children.length; i++) {
    const child = rootNode.children[i];
    const result = await processNode(child, rootNode);
    if (result === DELETE_NODE) {
      rootNode.children.splice(i, 1);
      // Adjust the index to account for the removed element
      i--;
    } else if (result) {
      // Replace the child node with the returned node
      rootNode.children[i] = result;
    }
  }

  if (wildcardNodes.length > 0) {
    const unusedBundleNames = {
      css: new Set<string>(rootNode.assets?.css?.keys()),
      js: new Set<string>(rootNode.assets?.js?.keys()),
      html: new Set<string>(rootNode.assets?.html?.bundles?.keys()),
    };

    const unusedBundleContents: {
      css: Map<string, string> | null;
      js: Map<string, string> | null;
      html: Map<string, string> | null;
    } = {
      css: null,
      js: null,
      html: null,
    };

    const getUnusedBundleContents = async (assetType: "css" | "js" | "html"): Promise<Map<string, string>> => {
      if (unusedBundleContents[assetType]) {
        return unusedBundleContents[assetType];
      }

      const bundleContentsMap = unusedBundleContents[assetType] = new Map<string, string>();

      if (assetType === "css") {
        const unusedBundleNamesSet = new Set(rootNode.assets?.css?.keys()).difference(new Set(resolvedRawBundleContents.css.keys()));
        for (const bundleName of unusedBundleNamesSet) {
          const content = await getInlinedCSSBundleContent(bundleName);
          if (content) {
            bundleContentsMap.set(bundleName, content);
          }
        }
      } else if (assetType === "js") {
        const unusedBundleNamesSet = new Set(rootNode.assets?.js?.keys()).difference(new Set(resolvedRawBundleContents.js.keys()));
        for (const bundleName of unusedBundleNamesSet) {
          const content = await getInlinedJSBundleContent(bundleName);
          if (content) {
            bundleContentsMap.set(bundleName, content);
          }
        }
      } else {
        const unusedBundleNamesSet = new Set(rootNode.assets?.html?.bundles?.keys()).difference(new Set(resolvedRawBundleContents.html.keys()));
        for (const bundleName of unusedBundleNamesSet) {
          const content = await getHTMLBundleContent(bundleName);
          if (content) {
            bundleContentsMap.set(bundleName, content);
          }
        }
      }

      return bundleContentsMap;
    };

    for (const wildcardNodeEntry of wildcardNodes) {
      const { node, type, assetType, parent } = wildcardNodeEntry;

      if (assetType === "html") {
        throw new BundleError("Wildcard bundle inclusions are not supported for HTML bundles. Please specify a bundle name explicitly.");
      }

      if (!parent.children) {
        throw new Error("Expected parent node to have children. This state should not be possible.");
      }

      const nodeIndex = parent.children.indexOf(node);

      // If the previous sibling is a whitespace-only text node, we'll duplicate it along with each
      // duplicate of the wildcard node to preserve indentation
      const prevSibling = parent.children[nodeIndex - 1];
      const prevSiblingIsIndentationWhitespace = prevSibling && prevSibling.type === YETI_NODE_TYPE.TEXT && prevSibling.content.trim() === "";

      const bundleContentsMap = await getUnusedBundleContents(assetType);

      const nodesToInsert: YetiChildNode[] = [];

      if (type === "inline") {
        // For an inline wildcard, we want to insert a text node containing the contents of each unreferenced bundle of the appropriate asset type directly into the tree at the location of the inline node.
        for (const [bundleName, bundleContent] of bundleContentsMap) {
          if (prevSiblingIsIndentationWhitespace) {
            nodesToInsert.push(prevSibling);
          }
          nodesToInsert.push({
            type: YETI_NODE_TYPE.TEXT,
            content: bundleContent,
          });
        }
      } else if (type === "src") {
        const { attrName } = wildcardNodeEntry;
        // For a src wildcard, we want to duplicate the element with a different attribute value for each unreferenced bundle of the appropriate asset type and insert those elements into the tree at the location of the original element.
        for (const [bundleName, bundleContent] of bundleContentsMap) {
          if (prevSiblingIsIndentationWhitespace) {
            nodesToInsert.push(prevSibling);
          }
          nodesToInsert.push({
            ...node,
            attributes: {
              ...node.attributes,
              [attrName]: getExternalBundleFilePath(bundleName, assetType),
            },
          });
          externalBundleNames[assetType].add(bundleName);
        }
      }

      if (prevSiblingIsIndentationWhitespace) {
        parent.children.splice(nodeIndex - 1, 2, ...nodesToInsert);
      } else {
        parent.children.splice(nodeIndex, 1, ...nodesToInsert);
      }
    }
  }

  const externalBundleContents: {
    css?: Map<string, string>;
    js?: Map<string, string>;
    html?: Map<string, string>;
  } = {};

  if (externalBundleNames.css.size > 0) {
    externalBundleContents.css = new Map<string, string>();
  }
  for (const bundleName of externalBundleNames.css) {
    const content = rootNode.assets.css.get(bundleName);
    if (content) {
      externalBundleContents.css.set(bundleName, content);
    }
  }
  for (const bundleName of externalBundleNames.js) {
    const content = resolvedRawBundleContents.js.get(bundleName);
    if (content) {
      externalBundleContents.js.set(bundleName, content);
    }
  }
  for (const bundleName of externalBundleNames.html) {
    const content = resolvedRawBundleContents.html.get(bundleName);
    if (content) {
      externalBundleContents.html.set(bundleName, content);
    }
  }

  delete rootNode.assets;

  return {
    rootNode,
    externalBundleContents,
    dependencies,
  };
};