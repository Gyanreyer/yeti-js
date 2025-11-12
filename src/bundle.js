import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getCallSites } from 'node:util';
import { fileURLToPath } from "node:url";

import { getConfig } from "./config.js";

/**
 * @import { HTMLImportObject, CSSBundleStartObject, JSBundleStartObject, CSSBundleImportObject, JSBundleImportObject, InlinedHTMLBundleContentObject } from "./types";
 */

/**
 * @typedef {CSSBundleStartObject | CSSBundleImportObject} AnyCSSBundleObject
 * @typedef {JSBundleStartObject | JSBundleImportObject} AnyJSBundleObject
 *
 * @typedef {AnyCSSBundleObject | AnyJSBundleObject} AnyCSSOrJSBundleObject
 *
 * @typedef {CSSBundleStartObject | JSBundleStartObject} AnyStartObject
 *
 * @typedef {CSSBundleImportObject | JSBundleImportObject | HTMLImportObject} AnyBundleImportObject
 *
 * @typedef {AnyCSSOrJSBundleObject | HTMLImportObject} AnyBundleObject
 */

export const WILDCARD_BUNDLE_NAME = "*";

export const bundleNameSymbol = Symbol("bundle-name");
export const bundleTypeSymbol = Symbol("bundle-type");
export const assetTypeSymbol = Symbol("asset-type");
export const importFilePathSymbol = Symbol("import-file-path");
export const shouldEscapeHTMLSymbol = Symbol("should-escape-html");
export const inlinedBundleContentTypeSymbol = Symbol("inlined-bundle-content-type");

const FILE_URL_PREFIX = "file://";

/**
 * @param {string} importPath
 */
export const resolveImportPath = (importPath) => {
  /**
 * @type {string}
 */
  let resolvedFilePath;

  if (importPath.startsWith(FILE_URL_PREFIX)) {
    resolvedFilePath = fileURLToPath(importPath);
  } else if (importPath.startsWith("/")) {
    const { inputDir } = getConfig();
    // Absolute path; resolve relative to the Eleventy input directory
    resolvedFilePath = resolve(inputDir, `.${importPath}`);
  } else if (importPath.startsWith("./") || importPath.startsWith("../")) {
    // Relative path; resolve relative to the caller file's directory
    const callSites = getCallSites();
    const callerDirname = dirname(
      // Need to go up two levels; first is this resolveImportPath function,
      // second is the import() method calling this,
      // third is the file which called import() which we're interested in.
      fileURLToPath(callSites[2].scriptName)
    );
    resolvedFilePath = resolve(callerDirname, importPath);
  } else {
    resolvedFilePath = fileURLToPath(import.meta.resolve(importPath));
  }

  return resolvedFilePath;
}

/**
 * @param {unknown} maybeBundleObj
 * @returns {maybeBundleObj is AnyStartObject}
 */
export const isBundleStartObject = (maybeBundleObj) =>
  typeof maybeBundleObj === "object" && maybeBundleObj !== null &&
  bundleTypeSymbol in maybeBundleObj &&
  maybeBundleObj[bundleTypeSymbol] === "start";

/**
 * @param {unknown} maybeBundleImportObj
 * @returns {maybeBundleImportObj is AnyBundleImportObject}
 */
export const isBundleImportObject = (maybeBundleImportObj) =>
  typeof maybeBundleImportObj === "object" && maybeBundleImportObj !== null &&
  bundleTypeSymbol in maybeBundleImportObj &&
  maybeBundleImportObj[bundleTypeSymbol] === "import";

/**
 * 
 * @param {unknown} maybeInlinedBundleObj
 * @returns {maybeInlinedBundleObj is InlinedHTMLBundleContentObject<string>}
 */
export const isInlinedHTMLBundleContentObject = (maybeInlinedBundleObj) =>
  typeof maybeInlinedBundleObj === "object" && maybeInlinedBundleObj !== null &&
  inlinedBundleContentTypeSymbol in maybeInlinedBundleObj &&
  maybeInlinedBundleObj[inlinedBundleContentTypeSymbol] === "html";

/**
 * @template {{
 *  [bundleNameSymbol]?: any;
 * }} TBundleObj
 * @param {TBundleObj} bundleObj
 * @returns {TBundleObj[typeof bundleNameSymbol]}
 */
export const getBundleName = (bundleObj) => bundleObj[bundleNameSymbol];

/**
 * @param {AnyBundleObject} bundleObj
 * @returns {AnyBundleObject[typeof assetTypeSymbol]}
 */
export const getBundleAssetType = (bundleObj) => bundleObj[assetTypeSymbol];

/**
 * @template {AnyBundleObject[assetTypeSymbol]} TExpectedType
 * @template {AnyBundleObject} TBundleObj
 * @param {AnyBundleObject} bundleObj
 * @param {TExpectedType} expectedType
 * @returns {bundleObj is Extract<TBundleObj, { [assetTypeSymbol]: TExpectedType }>}
*/
export const doesBundleMatchAssetType = (bundleObj, expectedType) => {
  return getBundleAssetType(bundleObj) === expectedType;
};

/**
 * @template {AnyBundleImportObject} TBundleImportObj
 * @param {TBundleImportObj} bundleImportObj
 * @returns {TBundleImportObj[typeof importFilePathSymbol]}
 */
export const getBundleImportFilePath = (bundleImportObj) => bundleImportObj[importFilePathSymbol];

/**
 * @param {AnyBundleImportObject} bundleImportObj
 * @returns {string}
 */
export const getBundleImportFileContents = (bundleImportObj) => {
  const filePath = bundleImportObj[importFilePathSymbol];
  return readFileSync(filePath, "utf8");
}

export const bundleSrcPrefix = "@bundle/";
export const bundleSrcPrefixLength = bundleSrcPrefix.length;

export const inlinedBundleRegex = /\/\*@--BUNDLE--(.*?)--@\*\//g;

export const inlinedWildcardBundle = "/*@--BUNDLE--*--@*/";

export const inlinedHTMLBundleTagName = "yeti-bundle--";