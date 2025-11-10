import { bundleNameSymbol, bundleSrcPrefix, bundleTypeSymbol, DEFAULT_BUNDLE_NAME, doesBundleMatchAssetType, getBundleImportFileContents, getBundleImportFilePath, getBundleName, getBundleAssetType, importFilePathSymbol, isBundleImportObject, isBundleStartObject, resolveImportPath, WILDCARD_BUNDLE_NAME, assetTypeSymbol } from "./bundle.js";

/**
 * @type {import("./types").css}
 */
export const css = (strings, ...values) => {
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
        if (!doesBundleMatchAssetType(value, "css")) {
          throw new Error(`css template received an import value of incompatible type "${getBundleAssetType(value)}". Only CSS imports via css.import() are allowed.`);
        }

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
          throw new Error(`css.import() failed to import file at path "${importFilePath}"`, {
            cause: err,
          });
        }
      } else if (isBundleStartObject(value)) {
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

css.bundle = (bundleName = DEFAULT_BUNDLE_NAME) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  return ({
    [bundleNameSymbol]: bundleName,
    [assetTypeSymbol]: "css",
    [bundleTypeSymbol]: "start",
  })
};

css.import = (importPath, bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`css.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return ({
      [importFilePathSymbol]: resolvedFilePath,
      [bundleNameSymbol]: bundleName,
      [assetTypeSymbol]: "css",
      [bundleTypeSymbol]: "import",
    })
  } catch (err) {
    throw new Error(`css.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

css.src = (bundleName) => `${bundleSrcPrefix}${bundleName}`;

css.inline = (bundleName) => `/*@--BUNDLE--${bundleName}--@*/`;
