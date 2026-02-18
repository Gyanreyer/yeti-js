import { readFile } from "node:fs/promises";
import { BUNDLE_TYPE, isBundleObject, makeBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.js";
import { BundleError } from "../error.ts";

export interface CSSResult {
  cssBundles: {
    [bundleName: string]: string;
  };
  cssDependencies: {
    [path: string]: true;
  };
}

export const css = (strings: TemplateStringsArray, ...values: unknown[]): () => Promise<CSSResult> => async () => {
  const rawCssBundles: Record<string, string[]> = {};
  const cssDependencies: Record<string, true> = {};

  let currentBundleName = css.getDefaultBundleName();

  const stringCount = strings.length;
  for (let i = 0; i < stringCount; i++) {
    const currentBundleArray = (rawCssBundles[currentBundleName] ??= []);
    currentBundleArray.push(strings[i]);

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
        cssDependencies[importPath] = true;
        const targetBundleName = value.bundleName ?? currentBundleName;
        try {
          const fileContents = await readFile(importPath, "utf-8");
          const targetBundleArray = (rawCssBundles[targetBundleName] ??= []);
          targetBundleArray.push(fileContents.trim());
        } catch (err) {
          throw new BundleError(`css.import() failed to import file at path "${importPath}".`, {
            cause: err,
          });
        }
      }
    } else if (value !== undefined && value !== null) {
      currentBundleArray.push(String(value));
    }
  }

  const finalCssBundles: Record<string, string> = {};
  for (const [bundleName, bundleChunks] of Object.entries(rawCssBundles)) {
    const combinedBundleString = bundleChunks.join("").trim();
    if (combinedBundleString) {
      finalCssBundles[bundleName] = combinedBundleString;
    }
  }

  return {
    cssBundles: finalCssBundles,
    cssDependencies,
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
