import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getCallSites } from 'node:util';

import { getConfig } from "./config.js";

export const DEFAULT_BUNDLE_NAME = "default";
export const WILDCARD_BUNDLE_NAME = "*";

export const bundleNameSymbol = Symbol("bundle-name");

/**
 * @typedef {{
 *  [bundleNameSymbol]: string
 * }} BundleObject
 */

/**
 * @param {string} bundleName
 * @returns {BundleObject}
 */
export const bundle = (bundleName = DEFAULT_BUNDLE_NAME) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  return ({
    [bundleNameSymbol]: bundleName,
  })
};

export const importFilePathSymbol = Symbol("import-file-path");

/**
 * @typedef {{
 *  [importFilePathSymbol]: string;
 *  [bundleNameSymbol]?: string;
 * }} BundleImportObject
 */

export const shouldEscapeHTMLSymbol = Symbol("should-escape-html");

/**
 * @typedef {{
 *  [importFilePathSymbol]: string;
 *  [shouldEscapeHTMLSymbol]: boolean;
 * }} BundleHTMLImportObject
 */

const FILE_URL_PREFIX = "file://";
const FILE_URL_PREFIX_LENGTH = FILE_URL_PREFIX.length;

/**
 * @param {string} importPath
 */
const resolveImportPath = (importPath) => {
  /**
 * @type {string}
 */
  let resolvedFilePath;

  if (importPath.startsWith(FILE_URL_PREFIX)) {
    resolvedFilePath = importPath.slice(FILE_URL_PREFIX_LENGTH);
  } else if (importPath.startsWith("/")) {
    const { inputDir } = getConfig();
    // Absolute path; resolve relative to the Eleventy input directory
    resolvedFilePath = resolve(inputDir, `.${importPath}`);
  } else if (importPath.startsWith("./") || importPath.startsWith("../")) {
    // Relative path; resolve relative to the caller file's directory
    const callSites = getCallSites();
    const callerDirname = dirname(
      // Need to go up two levels; first is this resolveImportPath function,
      // second is the bundle.import()/bundle.importHTML() method calling this,
      // third is the file which called bundle.import() which we're interested in.
      callSites[2].scriptName).slice(FILE_URL_PREFIX_LENGTH);
    resolvedFilePath = resolve(callerDirname, importPath);
  } else {
    resolvedFilePath = import.meta.resolve(importPath).slice(FILE_URL_PREFIX_LENGTH);
  }

  return resolvedFilePath;
}

/**
 * @param {string} importPath
 * @param {string} [bundleName]
 *
 * @returns {BundleImportObject}
 */
bundle.import = (importPath, bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return ({
      [importFilePathSymbol]: resolvedFilePath,
      [bundleNameSymbol]: bundleName,
    })
  } catch (err) {
    throw new Error(`bundle.import failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

/**
 * Imports an external file as an HTML fragment.
 *
 * @param {string} importPath
 * @param {boolean} [escape=false] Whether the imported content should be escaped. This will convert characters like `<` and `>` to their HTML entity equivalents,
 *                                 so only use this for text/attribute content, not HTML fragments.
 * @returns {BundleHTMLImportObject}
 */
bundle.importHTML = (importPath, escape = false) => {
  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return {
      [importFilePathSymbol]: resolvedFilePath,
      [shouldEscapeHTMLSymbol]: escape,
    };
  } catch (err) {
    throw new Error(`bundle.importHTML failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

/**
 * @param {unknown} maybeBundleObj
 * @returns {maybeBundleObj is BundleObject}
 */
export const isBundleObject = (maybeBundleObj) =>
  typeof maybeBundleObj === "object" && maybeBundleObj !== null &&
  bundleNameSymbol in maybeBundleObj &&
  typeof maybeBundleObj[bundleNameSymbol] === "string";

/**
 * @param {unknown} maybeBundleImportObj
 * @returns {maybeBundleImportObj is BundleImportObject | BundleHTMLImportObject}
 */
export const isBundleImportObject = (maybeBundleImportObj) =>
  typeof maybeBundleImportObj === "object" && maybeBundleImportObj !== null &&
  importFilePathSymbol in maybeBundleImportObj &&
  typeof maybeBundleImportObj[importFilePathSymbol] === "string";

/**
 * @overload
 * @param {BundleObject} bundleObj
 * @returns {string}
 */
/**
 * @overload
 * @param {BundleImportObject} bundleImportObj
 * @returns {string | undefined}
 */
/**
 * @param {BundleObject | BundleImportObject} bundleObj
 * @returns {string | undefined}
 */
export const getBundleName = (bundleObj) => bundleObj[bundleNameSymbol];

/**
 * @param {BundleImportObject | BundleHTMLImportObject} bundleImportObj
 * @returns {string}
 */
export const getBundleImportFilePath = (bundleImportObj) => bundleImportObj[importFilePathSymbol];

/**
 * @param {BundleImportObject | BundleHTMLImportObject} bundleImportObj
 * @returns {string}
 */
export const getBundleImportFileContents = (bundleImportObj) => {
  const filePath = bundleImportObj[importFilePathSymbol];
  return readFileSync(filePath, "utf8");
}

export const bundleSrcPrefix = "@bundle/";
export const bundleSrcPrefixLength = bundleSrcPrefix.length;

/**
 * @param {string} bundleName
 */
bundle.src = (bundleName) => `${bundleSrcPrefix}${bundleName}`;

/**
 * @param {string} bundleName
 */
bundle.inline = (bundleName) => {
  return `/*@--BUNDLE--${bundleName}--@*/`;
}

export const inlinedBundleRegex = /\/\*@--BUNDLE--(.*?)--@\*\//g;

export const inlinedWildcardBundle = "/*@--BUNDLE--*--@*/";
