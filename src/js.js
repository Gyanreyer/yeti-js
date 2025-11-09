import { bundleNameSymbol, bundleSrcPrefix, bundleTypeSymbol, DEFAULT_BUNDLE_NAME, doesBundleMatchType, getBundleImportFileContents, getBundleImportFilePath, getBundleName, getBundleType, importFilePathSymbol, isBundleImportObject, isBundleObject, resolveImportPath, WILDCARD_BUNDLE_NAME } from "./bundle.js";

/**
 * @import { JSResult } from './types';
 */

/**
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 * @returns {() => JSResult}
 */
export function js(strings, ...values) {
  return () => {
    /**
     * @type {Record<string, string[]>}
     */
    const rawJSBundles = {};
    /**
     * @type {Set<string>}
     */
    const jsBundleDependencies = new Set();

    let currentBundleName = DEFAULT_BUNDLE_NAME;

    let currentBundleChunk = "";

    for (let i = 0; i < strings.length; i++) {
      const str = strings[i];
      currentBundleChunk += str;
      const currentBundleArray = (rawJSBundles[currentBundleName] ??= []);

      const value = values[i];

      if (isBundleImportObject(value)) {
        if (!doesBundleMatchType(value, "js")) {
          throw new Error(`js template received an import value of incompatible type "${getBundleType(value)}". Only JS imports via js.import() are allowed.`);
        }

        if (currentBundleChunk) {
          currentBundleArray.push(currentBundleChunk.trim());
          currentBundleChunk = "";
        }

        const importFilePath = getBundleImportFilePath(value);
        jsBundleDependencies.add(importFilePath);
        let importBundleName = currentBundleName;
        const bundleName = getBundleName(value);
        if (bundleName !== undefined) {
          importBundleName = bundleName;
        }
        try {
          const fileContents = getBundleImportFileContents(value);
          const importBundleArray = (rawJSBundles[importBundleName] ??= []);
          importBundleArray.push(fileContents.trim());
        } catch (err) {
          throw new Error(`js.import() failed to import file at path "${importFilePath}"`, {
            cause: err,
          });
        }
      } else if (isBundleObject(value)) {
        if (currentBundleChunk) {
          currentBundleArray.push(currentBundleChunk.trim());
          currentBundleChunk = "";
        }

        const bundleName = getBundleName(value);
        if (bundleName !== undefined) {
          currentBundleName = bundleName;
        }
      } else if (value !== undefined && value !== null) {
        // If the value is not a bundle object, append it to the current chunk as a string
        currentBundleChunk += String(value);
      }
    }

    if (currentBundleChunk) {
      // If we have a remaining chunk which hasn't been committed to the bundle yet,
      // commit it now.
      const currentBundleArray = (rawJSBundles[currentBundleName] ??= []);
      currentBundleArray.push(currentBundleChunk.trim());
    }

    /**
     * @type {Record<string, string>}
     */
    const jsBundles = {};

    for (const bundleName in rawJSBundles) {
      const combinedBundleString = rawJSBundles[bundleName].join("\n").trim();
      if (!combinedBundleString) {
        // Skip empty bundles
        continue;
      }

      // Wrap the bundle inside a block scope to avoid naming collisions
      jsBundles[bundleName] = `{\n${combinedBundleString}\n}`;
    }

    return {
      jsBundles,
      jsDependencies: jsBundleDependencies,
    };
  };
}

/**
 * @import {CssOrJSBundleObject, CssOrJSBundleImportObject} from "./bundle.js"
 */

/**
 * @param {string} bundleName
 * @returns {CssOrJSBundleObject}
 */
js.bundle = (bundleName = DEFAULT_BUNDLE_NAME) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  return ({
    [bundleNameSymbol]: bundleName,
    [bundleTypeSymbol]: "js",
  })
};

/**
 * @param {string} importPath
 * @param {string} [bundleName]
 *
 * @returns {CssOrJSBundleImportObject}
 */
js.import = (importPath, bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`js.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return ({
      [importFilePathSymbol]: resolvedFilePath,
      [bundleNameSymbol]: bundleName,
      [bundleTypeSymbol]: "js",
    })
  } catch (err) {
    throw new Error(`js.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

/**
 * @param {string} bundleName
 */
js.src = (bundleName) => `${bundleSrcPrefix}${bundleName}`;

/**
 * @param {string} bundleName
 */
js.inline = (bundleName) => {
  return `/*@--BUNDLE--${bundleName}--@*/`;
}