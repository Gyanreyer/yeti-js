import { readFile } from "node:fs/promises";
import { BUNDLE_TYPE, isBundleObject, makeBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.js";
import { BundleError } from "../error.ts";

export interface JSResult {
  jsBundles: {
    [bundleName: string]: string;
  };
  jsDependencies: {
    [path: string]: true;
  };
}

export const js = (strings: TemplateStringsArray, ...values: unknown[]): () => Promise<JSResult> => async () => {
  const rawJsBundles: Record<string, string[]> = {};
  const jsDependencies: Record<string, true> = {};

  let currentBundleName = js.getDefaultBundleName();

  const stringCount = strings.length;
  for (let i = 0; i < stringCount; i++) {
    const currentBundleArray = (rawJsBundles[currentBundleName] ??= []);
    currentBundleArray.push(strings[i]);

    const value = values[i];
    if (isBundleObject(value)) {
      if (value.assetType !== "js") {
        throw new BundleError(`Encountered bundle object with asset type "${value.assetType}" in js template. Expected asset type "js".`);
      }

      const bundleType = value[BUNDLE_TYPE];
      if (bundleType !== "import" && bundleType !== "start") {
        throw new BundleError(`Encountered unsupported bundle object of type "${value[BUNDLE_TYPE]}" in js template.`);
      }

      if (bundleType === "start") {
        currentBundleName = value.bundleName;
      } else {
        // Import
        const importPath = value.importPath;
        jsDependencies[importPath] = true;
        const targetBundleName = value.bundleName ?? currentBundleName;
        try {
          const fileContents = await readFile(importPath, "utf-8");
          const targetBundleArray = (rawJsBundles[targetBundleName] ??= []);
          targetBundleArray.push(fileContents.trim());
        } catch (err) {
          throw new BundleError(`js.import() failed to import file at path "${importPath}".`, {
            cause: err,
          });
        }
      }
    } else if (value !== undefined && value !== null) {
      currentBundleArray.push(String(value));
    }
  }

  const finalJsBundles: Record<string, string> = {};
  for (const [bundleName, bundleChunks] of Object.entries(rawJsBundles)) {
    const combinedBundleString = bundleChunks.join("").trim();
    if (combinedBundleString) {
      finalJsBundles[bundleName] = combinedBundleString;
    }
  }

  return {
    jsBundles: finalJsBundles,
    jsDependencies,
  };
};

js.getDefaultBundleName = () => getConfig().js.defaultBundleName;

js.bundle = <TBundleName extends string>(bundleName: TBundleName) => makeBundleStartObject("js", bundleName);

js.import = (importPath: string, bundleName?: string) => {
  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return makeBundleImportObject("js", resolvedFilePath, bundleName);
  } catch (err) {
    throw new Error(`js.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

js.inline = <TBundleName extends string>(bundleName: TBundleName) => makeBundleInlineObject("js", bundleName);

js.src = <TBundleName extends string>(bundleName: TBundleName) => makeBundleSrcObject("js", bundleName);

