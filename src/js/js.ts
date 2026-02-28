import { build } from 'esbuild';

import { BUNDLE_TYPE, isBundleObject, makeCssOrJsBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeCssOrJsBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.ts";
import { BundleError } from "../error.ts";
import { textEncoder } from '../utils/textEncoder.ts';

export interface JSBundleResult {
  bundleName: string;
  code: Uint8Array;
  dependencies: Set<string>;
}

export type JSBundleGetter = () => Promise<JSBundleResult>;
export type JSBundleGetterMap = Map<string, JSBundleGetter>;
const jsTemplateResultSymbol = Symbol("JS_TEMPLATE_RESULT");

export type JSTemplateResult = {
  bundles: JSBundleGetterMap;
  [jsTemplateResultSymbol]: true;
}

export const isJSTemplateResult = (obj: unknown): obj is JSTemplateResult => {
  return typeof obj === "object" && obj !== null &&
    jsTemplateResultSymbol in obj;
};

export const js = (strings: TemplateStringsArray, ...values: unknown[]): JSTemplateResult => {
  const rawJsBundles = new Map<string, string[]>();
  // Map of bundleName to array of import paths for that bundle{
  const bundleImportPaths = new Map<string, Set<string>>();

  let currentBundleName = js.getDefaultBundleName();

  const bundleNames = new Set<string>([currentBundleName]);

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
        bundleNames.add(currentBundleName);
      } else {
        // Import
        const importPath = value.importPath;
        const targetBundleName = value.bundleName ?? currentBundleName;
        let currentBundleImportPaths = bundleImportPaths.get(targetBundleName);
        if (!currentBundleImportPaths) {
          currentBundleImportPaths = new Set<string>();
          bundleImportPaths.set(targetBundleName, currentBundleImportPaths);
        }
        currentBundleImportPaths.add(importPath);
        bundleNames.add(targetBundleName);
      }
    } else if (value !== undefined && value !== null) {
      currentBundleArray.push(String(value));
    }
  }

  const bundleGetterMap: JSBundleGetterMap = new Map();

  for (const bundleName of bundleNames) {
    let cachedPromise: Promise<JSBundleResult> | null = null;

    bundleGetterMap.set(bundleName, () => {
      if (cachedPromise) {
        return cachedPromise;
      }

      cachedPromise = (async () => {
        const dependencies = new Set<string>();
        const codeChunks: Uint8Array[] = [];

        const importPaths = bundleImportPaths.get(bundleName);
        if (importPaths) {
          // Use esbuild to bundle imported files together and get a list of all input files for dependency tracking
          try {
            const result = await build({
              entryPoints: Array.from(importPaths),
              bundle: true,
              write: false,
              treeShaking: true,
              // Outputs data so we can get a list of all input files for dependency tracking
              metafile: true,
              absPaths: ["metafile"],
              format: "esm",
              platform: "browser",
            });
            for (const inputFile in result.metafile.inputs) {
              dependencies.add(inputFile);
            }
            for (const outputFile in result.outputFiles) {
              const outputFileData = result.outputFiles[outputFile];
              codeChunks.push(outputFileData.contents);
            }
          } catch (err) {
            throw new BundleError(`js.import() failed to import files for bundle "${bundleName}".`, {
              cause: err,
            });
          }
        }

        const rawBundleChunks = rawJsBundles.get(bundleName);
        if (rawBundleChunks) {
          for (const chunk of rawBundleChunks) {
            codeChunks.push(textEncoder.encode(chunk));
          }
        }

        let combinedCodeLength = 0;
        for (const chunk of codeChunks) {
          combinedCodeLength += chunk.length;
        }
        const combinedCode = new Uint8Array(combinedCodeLength);
        let offset = 0;
        for (const chunk of codeChunks) {
          combinedCode.set(chunk, offset);
          offset += chunk.length;
        }

        return {
          bundleName,
          code: combinedCode,
          dependencies,
        };
      })();

      return cachedPromise;
    });
  }

  return {
    bundles: bundleGetterMap,
    [jsTemplateResultSymbol]: true,
  };
};

js.getDefaultBundleName = () => getConfig().js.defaultBundleName;

js.bundle = <TBundleName extends string>(bundleName: TBundleName) => makeBundleStartObject("js", bundleName);

js.import = (importPath: string, bundleName?: string) => {
  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return makeCssOrJsBundleImportObject("js", resolvedFilePath, bundleName);
  } catch (err) {
    throw new Error(`js.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

js.inline = <TBundleName extends string>(bundleName: TBundleName) => makeCssOrJsBundleInlineObject("js", bundleName);

js.src = <TBundleName extends string>(bundleName: TBundleName) => makeBundleSrcObject("js", bundleName);

