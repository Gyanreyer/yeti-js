import htm from "htm";
import { fileURLToPath } from "node:url";
import { getCallSites } from "node:util";
import { bundleTypeSymbol, doesBundleMatchAssetType, getBundleImportFileContents, getBundleImportFilePath, getBundleAssetType, importFilePathSymbol, isBundleImportObject, resolveImportPath, shouldEscapeHTMLSymbol, assetTypeSymbol } from "./bundle.js";
import { escapeHTML } from "./utils/escapeHTML.js";
import { flattenRenderResults } from "./utils/flattenRenderResults.js";

/**
 * @import { YetiComponent, RenderResult } from "./types"
 */

const voidTagNames = {
  'area': true,
  'base': true,
  'br': true,
  'col': true,
  'command': true,
  'embed': true,
  'hr': true,
  'img': true,
  'input': true,
  'keygen': true,
  'link': true,
  'meta': true,
  'param': true,
  'source': true,
  'track': true,
  'wbr': true,
}


const setInnerHTMLAttr = 'dangerouslySetInnerHTML';
/**
 * @type {{[attrName: string]: string}}
 */
const DOMAttributeNames = {
  className: 'class',
  htmlFor: 'for'
};

/**
 * @param {unknown} tagNameOrComponent
 * @returns {tagNameOrComponent is YetiComponent<any>}
 */
const isNestedComponent = (tagNameOrComponent) => typeof tagNameOrComponent === 'function';

/**
 * @param {unknown} child
 * @returns {child is RenderResult}
 */
const isRenderResultChild = (child) => typeof child === 'object' && child !== null && 'html' in child;

/**
 * Hyperscript reviver that constructs a sanitized HTML string.
 * This is forked from the vhtml library's implementation.
 * https://github.com/developit/vhtml
 *
 * @param {string | YetiComponent<any>} tagNameOrComponent
 * @param {{
 *  [key: string]: any;
 * }} [attrs]
 * @param {unknown[]} children
 * @returns {RenderResult}
 */
const h = (tagNameOrComponent, attrs, ...children) => {
  let serializedHTMLStr = "";

  attrs = attrs || {};

  /**
   * List of file paths that were involved in rendering this HTML
   * which we will treat as our dependencies for Eleventy's
   * incremental builds.
   * @type {Set<string>}
   */
  const htmlDependencies = new Set();
  for (const callSite of getCallSites()) {
    if (callSite.scriptName.startsWith("file://")) {
      const path = fileURLToPath(callSite.scriptName);
      htmlDependencies.add(path);
    }
  }

  /**
   * @type {{
   *  [bundleName: string]: Set<string>;
   * }}
   */
  const cssBundles = {};
  /**
   * @type {Set<string>}
   */
  const cssDependencies = new Set();

  /**
   * @type {{
   *  [bundleName: string]: Set<string>;
   * }}
   */
  const jsBundles = {};
  /**
   * @type {Set<string>}
   */
  const jsDependencies = new Set();

  // Sortof component support!
  if (isNestedComponent(tagNameOrComponent)) {
    const componentCSS = tagNameOrComponent.css?.();
    if (componentCSS) {
      for (const bundleName in componentCSS.cssBundles) {
        cssBundles[bundleName] ??= new Set();
        cssBundles[bundleName].add(componentCSS.cssBundles[bundleName]);
      }
      for (const dependency of componentCSS.cssDependencies) {
        cssDependencies.add(dependency);
      }
    }

    const componentJS = tagNameOrComponent.js?.();
    if (componentJS) {
      for (const bundleName in componentJS.jsBundles) {
        jsBundles[bundleName] ??= new Set();
        jsBundles[bundleName].add(componentJS.jsBundles[bundleName]);
      }
      for (const dependency of componentJS.jsDependencies) {
        jsDependencies.add(dependency);
      }
    }

    const componentRenderResults = tagNameOrComponent({
      ...attrs,
      children,
    });

    return flattenRenderResults([{
      html: "",
      cssBundles,
      cssDependencies,
      jsBundles,
      jsDependencies,
      htmlDependencies,
    }].concat(componentRenderResults));
  }

  if (tagNameOrComponent) {
    serializedHTMLStr += '<' + tagNameOrComponent;
    if (attrs) {
      for (const attrName in attrs) {
        if (attrs[attrName] !== false && attrs[attrName] != null && attrName !== setInnerHTMLAttr) {
          serializedHTMLStr += ` ${attrName in DOMAttributeNames ? DOMAttributeNames[attrName] : escapeHTML(attrName)}="${escapeHTML(attrs[attrName])}"`;
        }
      }
    }
    serializedHTMLStr += '>';
  }

  if (!(tagNameOrComponent in voidTagNames)) {
    if (attrs[setInnerHTMLAttr]) {
      serializedHTMLStr += attrs[setInnerHTMLAttr].__html;
    } else {
      /**
       * @param {unknown | unknown[]} children
       */
      const addChildrenToSerializedStr = (children) => {
        if (Array.isArray(children)) {
          for (const child of children) {
            addChildrenToSerializedStr(child);
          }
        } else if (isRenderResultChild(children)) {
          serializedHTMLStr += children.html;
          if (children.cssBundles) {
            for (const bucketName in children.cssBundles) {
              cssBundles[bucketName] ??= new Set();
              for (const chunk of children.cssBundles[bucketName]) {
                cssBundles[bucketName].add(chunk);
              }
            }
          }
          if (children.jsBundles) {
            for (const bucketName in children.jsBundles) {
              jsBundles[bucketName] ??= new Set();
              for (const chunk of children.jsBundles[bucketName]) {
                jsBundles[bucketName].add(chunk);
              }
            }
          }
          if (children.cssDependencies) {
            for (const dependency of children.cssDependencies) {
              cssDependencies.add(dependency);
            }
          }
          if (children.jsDependencies) {
            for (const dependency of children.jsDependencies) {
              jsDependencies.add(dependency);
            }
          }
          if (children.htmlDependencies) {
            for (const dependency of children.htmlDependencies) {
              htmlDependencies.add(dependency);
            }
          }
        } else if (isBundleImportObject(children)) {
          if (!doesBundleMatchAssetType(children, "html")) {
            throw new Error(`html template received an import value of incompatible type "${getBundleAssetType(children)}". Only HTML imports via html.import() are allowed.`);
          }

          try {
            const importFilePath = getBundleImportFilePath(children);
            htmlDependencies.add(importFilePath);
            const importFileContents = getBundleImportFileContents(children);
            if (shouldEscapeHTMLSymbol in children && children[shouldEscapeHTMLSymbol]) {
              serializedHTMLStr += escapeHTML(importFileContents);
            } else {
              serializedHTMLStr += importFileContents;
            }
          } catch (err) {
            const importFilePath = getBundleImportFilePath(children);
            throw new Error(`html.import() failed to import file at path "${importFilePath}"`, {
              cause: err,
            });
          }
        } else {
          serializedHTMLStr += escapeHTML(String(children));
        }
      };

      addChildrenToSerializedStr(children);
    }

    serializedHTMLStr += tagNameOrComponent ? `</${tagNameOrComponent}>` : '';
  }

  return {
    html: serializedHTMLStr,
    cssBundles,
    cssDependencies,
    jsBundles,
    jsDependencies,
    htmlDependencies,
  };
}

const boundHTMLFunction = htm.bind(h);

/**
 * @type {import("./types").html['import']}
 */
const importHTML = (importPath, escape = false) => {
  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return {
      [importFilePathSymbol]: resolvedFilePath,
      [shouldEscapeHTMLSymbol]: escape,
      [assetTypeSymbol]: "html",
      [bundleTypeSymbol]: "import",
    };
  } catch (err) {
    throw new Error(`html.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

export const html = /** @type {import("./types").html} */(Object.defineProperty(boundHTMLFunction, "import", {
  value: importHTML,
}));
