import { bundleAsync } from 'lightningcss';
import { BUNDLE_TYPE, isBundleObject, makeBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.js";
import { BundleError } from "../error.ts";
import { textDecoder } from '../html/utils.ts';

export interface CSSResult {
  cssBundles: Map<string, string[]>;
  cssDependencies: Set<string>;
}

export const css = (strings: TemplateStringsArray, ...values: unknown[]): () => Promise<CSSResult> => {
  const rawCssBundles = new Map<string, string[]>();
  // Map of bundleName to array of import paths for that bundle{
  const bundleImportPaths = new Map<string, string[]>();

  let currentBundleName = css.getDefaultBundleName();

  const stringCount = strings.length;
  for (let i = 0; i < stringCount; i++) {
    const str = strings[i];

    let currentBundleArray = rawCssBundles.get(currentBundleName);
    if (!currentBundleArray) {
      currentBundleArray = [str];
      rawCssBundles.set(currentBundleName, currentBundleArray);
    } else {
      currentBundleArray.push(str);
    }

    const value = values[i];
    if (isBundleObject(value)) {
      if (value.assetType !== "css") {
        throw new BundleError(`Encountered bundle object with asset type "${value.assetType}" in css template. Expected asset type "css".`);
      }

      const bundleType = value[BUNDLE_TYPE];
      if (bundleType !== "import" && bundleType !== "start") {
        throw new BundleError(`Encountered unsupported bundle object of type "${value[BUNDLE_TYPE]}" in css template.`);
      }

      if (bundleType === "start") {
        currentBundleName = value.bundleName;
      } else {
        // Import
        const importPath = value.importPath;
        const targetBundleName = value.bundleName ?? currentBundleName;
        let currentBundleImportPaths = bundleImportPaths.get(targetBundleName);
        if (!currentBundleImportPaths) {
          currentBundleImportPaths = [importPath];
          bundleImportPaths.set(targetBundleName, currentBundleImportPaths);
        } else {
          currentBundleImportPaths.push(importPath);
        }
      }
    } else if (value !== undefined && value !== null) {
      currentBundleArray.push(String(value));
    }
  }

  return async () => {
    const cssDependencies = new Set<string>();
    const finalCssBundles = new Map<string, string[]>();

    for (const [bundleName, importPaths] of bundleImportPaths.entries()) {
      try {
        const resultingCode = await Promise.all(importPaths.map(async (importPath) => {
          const result = await bundleAsync({
            filename: importPath,
            minify: true,
          });
          if (result.dependencies) {
            for (const dependency of result.dependencies) {
              cssDependencies.add(dependency.url);
            }
          }
          return textDecoder.decode(result.code);
        }));
        finalCssBundles.set(bundleName, resultingCode);
      } catch (err) {
        throw new BundleError(`css.import() failed to import files for bundle "${bundleName}".`, {
          cause: err,
        });
      }
    }

    for (const [bundleName, bundleChunks] of rawCssBundles.entries()) {
      let currentBundleArray = finalCssBundles.get(bundleName);
      if (!currentBundleArray) {
        currentBundleArray = [...bundleChunks];
        finalCssBundles.set(bundleName, currentBundleArray);
      } else {
        currentBundleArray.push(...bundleChunks);
      }
    }

    return {
      cssBundles: finalCssBundles,
      cssDependencies,
    };
  };
};

css.getDefaultBundleName = () => getConfig().css.defaultBundleName;

css.bundle = <TBundleName extends string>(bundleName: TBundleName) => makeBundleStartObject("css", bundleName);

css.import = (importPath: string, bundleName?: string) => {
  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return makeBundleImportObject("css", resolvedFilePath, bundleName);
  } catch (err) {
    throw new Error(`css.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

css.inline = <TBundleName extends string>(bundleName: TBundleName) => makeBundleInlineObject("css", bundleName);

css.src = <TBundleName extends string>(bundleName: TBundleName) => makeBundleSrcObject("css", bundleName);
