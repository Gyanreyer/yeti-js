import { DEFAULT_BUNDLE_NAME, getBundleImportFileContents, getBundleImportFilePath, getBundleName, isBundleImportObject, isBundleObject } from "./bundle.js";

/**
 * @import { CSSResult } from './types';
 */

/**
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 * @returns {() => CSSResult}
 */
export function css(strings, ...values) {
  return () => {
    /**
     * @type {Record<string, string[]>}
     */
    const rawCSSBundles = {};
    /**
     * @type {Set<string>}
     */
    const cssBundleDependencies = new Set();

    let currentBundleName = DEFAULT_BUNDLE_NAME;

    let currentBundleChunk = "";

    for (let i = 0; i < strings.length; i++) {
      const str = strings[i];
      currentBundleChunk += str;
      const currentBundleArray = (rawCSSBundles[currentBundleName] ??= []);

      const value = values[i];
      if (isBundleImportObject(value)) {
        if (currentBundleChunk) {
          currentBundleArray.push(currentBundleChunk.trim());
          currentBundleChunk = "";
        }

        const importFilePath = getBundleImportFilePath(value);
        cssBundleDependencies.add(importFilePath);
        let importBundleName = currentBundleName;
        const bundleName = getBundleName(value);
        if (bundleName !== undefined) {
          importBundleName = bundleName;
        }
        try {
          const fileContents = getBundleImportFileContents(value);
          const importBundleArray = (rawCSSBundles[importBundleName] ??= []);
          importBundleArray.push(fileContents.trim());
        } catch (err) {
          throw new Error(`bundle.import failed to import file at path "${importFilePath}"`, {
            cause: err,
          });
        }
      } else if (isBundleObject(value)) {
        // A new bundle is being started.
        if (currentBundleChunk) {
          // Store the current chunk before switching bundles
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
      const currentBundleArray = (rawCSSBundles[currentBundleName] ??= []);
      currentBundleArray.push(currentBundleChunk.trim());
    }

    /**
     * @type {Record<string, string>}
     */
    const cssBundles = {};

    for (const bundleName in rawCSSBundles) {
      const combinedBundleString = rawCSSBundles[bundleName].join("\n").trim();
      if (!combinedBundleString) {
        // Skip empty bundles
        continue;
      }

      cssBundles[bundleName] = combinedBundleString;
    }

    return {
      cssBundles,
      cssDependencies: cssBundleDependencies,
    };
  };
}