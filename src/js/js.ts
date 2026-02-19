import { build } from 'esbuild';

import { BUNDLE_TYPE, isBundleObject, makeBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.js";
import { BundleError } from "../error.ts";

export interface JSResult {
  jsBundles: Map<string, string[]>;
  jsDependencies: Set<string>;
}

export const js = (strings: TemplateStringsArray, ...values: unknown[]): () => Promise<JSResult> => {
  const rawJsBundles = new Map<string, string[]>();
  // Map of bundleName to array of import paths for that bundle{
  const bundleImportPaths = new Map<string, string[]>();

  let currentBundleName = js.getDefaultBundleName();

  const stringCount = strings.length;
  for (let i = 0; i < stringCount; i++) {
    const str = strings[i];
    let currentBundleArray = rawJsBundles.get(currentBundleName);
    if (!currentBundleArray) {
      currentBundleArray = [str];
      rawJsBundles.set(currentBundleName, currentBundleArray);
    } else {
      currentBundleArray.push(str);
    }

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
    const jsDependencies = new Set<string>();
    const finalJsBundles = new Map<string, string[]>();

    for (const [bundleName, importPaths] of bundleImportPaths.entries()) {
      // Use esbuild to bundle imported files together and get a list of all input files for dependency tracking
      try {
        const result = await build({
          entryPoints: importPaths,
          bundle: true,
          write: false,
          minify: true,
          treeShaking: true,
          // Outputs data so we can get a list of all input files for dependency tracking
          metafile: true,
          absPaths: ["metafile"],
          format: "esm",
          platform: "browser",
        });
        for (const inputFile in result.metafile.inputs) {
          jsDependencies.add(inputFile);
        }
        finalJsBundles.set(bundleName, [result.outputFiles[0].text.trim()]);
      } catch (err) {
        throw new BundleError(`js.import() failed to import files for bundle "${bundleName}".`, {
          cause: err,
        });
      }
    }

    for (const [bundleName, bundleChunks] of rawJsBundles.entries()) {
      let currentBundleArray = finalJsBundles.get(bundleName);
      if (!currentBundleArray) {
        currentBundleArray = [...bundleChunks];
        finalJsBundles.set(bundleName, currentBundleArray);
      } else {
        currentBundleArray.push(...bundleChunks);
      }
    }

    return {
      jsBundles: finalJsBundles,
      jsDependencies,
    };
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

