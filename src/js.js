import { bundleNameSymbol, bundleSrcPrefix, bundleTypeSymbol, doesBundleMatchAssetType, getBundleImportFileContents, getBundleImportFilePath, getBundleName, getBundleAssetType, importFilePathSymbol, isBundleImportObject, isBundleStartObject, resolveImportPath, WILDCARD_BUNDLE_NAME, assetTypeSymbol } from "./bundle.js";
import { getConfig } from "./config.js";

const getDefaultBundleName = () => getConfig().js.defaultBundleName;

/**
 * @type {import("./types").js}
 */
export const js = (strings, ...values) => {
  return () => {
    /**
     * @type {Record<string, string[]>}
     */
    const rawJSBundles = {};
    /**
     * @type {Set<string>}
     */
    const jsBundleDependencies = new Set();

    let currentBundleName = getDefaultBundleName();

    let currentBundleChunk = "";

    for (let i = 0; i < strings.length; i++) {
      const str = strings[i];
      currentBundleChunk += str;
      const currentBundleArray = (rawJSBundles[currentBundleName] ??= []);

      const value = values[i];

      if (isBundleImportObject(value)) {
        if (!doesBundleMatchAssetType(value, "js")) {
          throw new Error(`js template received an import value of incompatible type "${getBundleAssetType(value)}". Only JS imports via js.import() are allowed.`);
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
      } else if (isBundleStartObject(value)) {
        if (currentBundleChunk) {
          currentBundleArray.push(currentBundleChunk.trim());
          currentBundleChunk = "";
        }

        const bundleName = getBundleName(value);
        currentBundleName = bundleName;
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


js.bundle = (bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  return ({
    [bundleNameSymbol]: bundleName,
    [assetTypeSymbol]: "js",
    [bundleTypeSymbol]: "start",
  })
};

js.import = (importPath, bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`js.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return ({
      [importFilePathSymbol]: resolvedFilePath,
      [bundleNameSymbol]: bundleName,
      [assetTypeSymbol]: "js",
      [bundleTypeSymbol]: "import",
    })
  } catch (err) {
    throw new Error(`js.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

js.src = (bundleName) => `${bundleSrcPrefix}${bundleName}`;

js.inline = (bundleName) => `/*@--BUNDLE--${bundleName}--@*/`;