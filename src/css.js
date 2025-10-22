import { DEFAULT_BUNDLE_NAME, getBundleImportFileContents, getBundleImportFilePath, getBundleName, isBundleImportObject, isBundleObject } from "./bundle.js";

/**
 * @typedef {{
 *  cssBundles: {
 *    [bundleName: string]: string;
 *  };
 *  cssDependencies: string[];
 * }} CSSResult
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

    for (let i = 0; i < strings.length; i++) {
      const str = strings[i];
      const currentBundleArray = (rawCSSBundles[currentBundleName] ??= []);
      currentBundleArray.push(str);

      const value = values[i];
      if (isBundleImportObject(value)) {

        let importBundleName = currentBundleName;
        if (isBundleObject(value)) {
          importBundleName = getBundleName(value);
        }
        try {
          const fileContents = getBundleImportFileContents(value);
          const importBundleArray = (rawCSSBundles[importBundleName] ??= []);
          importBundleArray.push(fileContents);
          cssBundleDependencies.add(getBundleImportFilePath(value));
        } catch (err) {
          throw new Error(`bundle.import failed to import file at path "${importBundleName}": ${err.message}`);
        }

      } else if (isBundleObject(value)) {
        currentBundleName = getBundleName(value);
      } else if (value !== undefined && value !== null) {
        // If the value is not a bundle object, append it to the current bundle as a string
        currentBundleArray.push(String(value));
      }
    }

    /**
     * @type {Record<string, string>}
     */
    const cssBundles = {};

    for (const bundleName in rawCSSBundles) {
      const combinedBundleString = rawCSSBundles[bundleName].join("").trim();
      if (!combinedBundleString) {
        // Skip empty bundles
        continue;
      }

      cssBundles[bundleName] = combinedBundleString;
    }

    return {
      cssBundles,
      cssDependencies: Array.from(cssBundleDependencies),
    };
  };
}