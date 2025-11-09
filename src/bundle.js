import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getCallSites } from 'node:util';
import { fileURLToPath } from "node:url";

import { getConfig } from "./config.js";

export const DEFAULT_BUNDLE_NAME = "default";
export const WILDCARD_BUNDLE_NAME = "*";

export const bundleNameSymbol = Symbol("bundle-name");
export const bundleTypeSymbol = Symbol("bundle-type");

/**
 * @typedef {{
 *  [bundleNameSymbol]: string;
 *  [bundleTypeSymbol]: "js" | "css";
 * }} CssOrJSBundleObject
 */

export const importFilePathSymbol = Symbol("import-file-path");

/**
 * @typedef {{
 *  [importFilePathSymbol]: string;
 *  [bundleNameSymbol]?: string;
 *  [bundleTypeSymbol]: "js" | "css";
 * }} CssOrJSBundleImportObject
 */

export const shouldEscapeHTMLSymbol = Symbol("should-escape-html");

/**
 * @typedef {{
 *  [importFilePathSymbol]: string;
 *  [shouldEscapeHTMLSymbol]: boolean;
 *  [bundleTypeSymbol]: "html";
 * }} HTMLImportObject
 */

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
 * @returns {maybeBundleObj is CssOrJSBundleObject}
 */
export const isBundleObject = (maybeBundleObj) =>
  typeof maybeBundleObj === "object" && maybeBundleObj !== null &&
  bundleNameSymbol in maybeBundleObj &&
  typeof maybeBundleObj[bundleNameSymbol] === "string";

/**
 * @param {unknown} maybeBundleImportObj
 * @returns {maybeBundleImportObj is CssOrJSBundleImportObject | HTMLImportObject}
 */
export const isBundleImportObject = (maybeBundleImportObj) =>
  typeof maybeBundleImportObj === "object" && maybeBundleImportObj !== null &&
  importFilePathSymbol in maybeBundleImportObj &&
  typeof maybeBundleImportObj[importFilePathSymbol] === "string";

/**
 * @overload
 * @param {CssOrJSBundleObject} bundleObj
 * @returns {string}
 */
/**
 * @overload
 * @param {CssOrJSBundleImportObject} bundleImportObj
 * @returns {string | undefined}
 */
/**
 * @param {CssOrJSBundleObject | CssOrJSBundleImportObject} bundleObj
 * @returns {string | undefined}
 */
export const getBundleName = (bundleObj) => bundleObj[bundleNameSymbol];

/**
 * @param {CssOrJSBundleObject | CssOrJSBundleImportObject | HTMLImportObject} bundleObj
 * @returns {"js" | "css" | "html"}
 */
export const getBundleType = (bundleObj) => bundleObj[bundleTypeSymbol];

/**
 * @template {"css" | "js" | "html"} TExpectedType
 * @param {CssOrJSBundleObject | CssOrJSBundleImportObject | HTMLImportObject} bundleObj 
 * @param {TExpectedType} expectedType
 * @returns {bundleObj is (TExpectedType extends "html" ? HTMLImportObject : (CssOrJSBundleObject | CssOrJSBundleImportObject) & {
 *  [bundleTypeSymbol]: TExpectedType;
 * })}
*/
export const doesBundleMatchType = (bundleObj, expectedType) => {
  return getBundleType(bundleObj) === expectedType;
};

/**
 * @param {CssOrJSBundleImportObject | HTMLImportObject} obj 
 * @returns {obj is (CssOrJSBundleImportObject) & { [bundleTypeSymbol]: "css" }}
 */
export const isCSSBundleObject = (obj) =>
  isBundleObject(obj) && getBundleType(obj) === "css";

/**
 * @param {CssOrJSBundleImportObject | HTMLImportObject} bundleImportObj
 * @returns {string}
 */
export const getBundleImportFilePath = (bundleImportObj) => bundleImportObj[importFilePathSymbol];

/**
 * @param {CssOrJSBundleImportObject | HTMLImportObject} bundleImportObj
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
