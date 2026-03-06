import { bundleAsync } from 'lightningcss';
import { getCallSites } from 'node:util';
import { fileURLToPath } from 'node:url';

import { BUNDLE_TYPE, isBundleObject, makeCssOrJsBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeCssOrJsBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.ts";
import { BundleError } from "../error.ts";
import { textEncoder } from '../utils/textEncoder.ts';
import { dirname, resolve } from 'node:path';

export interface CSSBundleResult {
  bundleName: string;
  code: Uint8Array;
  dependencies: Set<string>;
}

export type CSSBundleGetter = () => Promise<CSSBundleResult>;
export type CSSBundleGetterMap = Map<string, CSSBundleGetter>;
export const cssTemplateResultSymbol = Symbol("CSS_TEMPLATE_RESULT");

export type CSSTemplateResult = {
  bundles: CSSBundleGetterMap;
  [cssTemplateResultSymbol]: true;
}

export const isCSSTemplateResult = (obj: unknown): obj is CSSTemplateResult => {
  return typeof obj === "object" && obj !== null &&
    cssTemplateResultSymbol in obj;
};

// Cache call site URLs by template strings array object. Tagged template literals reuse the same
// strings array reference across calls, so this avoids a V8 stack walk on every css`` invocation.
const callSiteCache = new WeakMap<TemplateStringsArray, string | undefined>();

export const css = (strings: TemplateStringsArray, ...values: unknown[]): CSSTemplateResult => {
  // Get the file URL of the file which called this css template tag
  // so we can use it for dependency tracking
  let parentCallSiteURL: string | undefined;
  if (callSiteCache.has(strings)) {
    parentCallSiteURL = callSiteCache.get(strings);
  } else {
    parentCallSiteURL = getCallSites()[1]?.scriptName;
    callSiteCache.set(strings, parentCallSiteURL);
  }

  const rawCssBundles = new Map<string, string[]>();
  // Map of bundleName to array of import paths for that bundle{
  const bundleImportPaths = new Map<string, Set<string>>();

  let currentBundleName = css.getDefaultBundleName();

  const bundleNames = new Set<string>([currentBundleName]);

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

  // Filter out bundles that contain only whitespace
  for (const bundleName of bundleNames) {
    const rawChunks = rawCssBundles.get(bundleName);
    if (!rawChunks || rawChunks.every(chunk => chunk.trimStart().length === 0)) {
      // If the raw chunks are entirely composed of whitespace, drop that from the bundle
      rawCssBundles.delete(bundleName);
      const hasImports = (bundleImportPaths.get(bundleName)?.size ?? 0) > 0;
      if (!hasImports) {
        // If the bundle also has no imports, drop it entirely
        bundleNames.delete(bundleName);
      }
    }
  }

  const bundleGetterMap: CSSBundleGetterMap = new Map();

  for (const bundleName of bundleNames) {
    let cachedPromise: Promise<CSSBundleResult> | null = null;

    bundleGetterMap.set(bundleName, () => {
      if (cachedPromise) {
        return cachedPromise;
      }

      cachedPromise = (async () => {
        const dependencies = new Set<string>();
        // We'll gather the code for the bundle in an array of Uint8Arrays (code chunks)
        // and then stitch them together into a single Uint8Array at the end to return as the bundle result.
        const codeChunks: Uint8Array[] = [];

        const importPaths = bundleImportPaths.get(bundleName);
        if (importPaths) {
          // Use lightningcss to bundle each imported file and its dependencies,
          // and collect the resulting code and dependencies for the bundle result
          for (const importPath of importPaths) {
            dependencies.add(importPath);
            try {
              const result = await bundleAsync({
                filename: importPath,
                resolver: {
                  // Resolve paths for @import statements in CSS files.
                  // This lets us track any imported CSS files as dependencies.
                  resolve: (specifier, from) => {
                    const resolvedPath = resolve(dirname(from), specifier);
                    dependencies.add(resolvedPath);
                    return resolvedPath;
                  },
                }
              });
              codeChunks.push(result.code);
            } catch (err) {
              throw new BundleError(`css.import() failed to import file "${importPath}" for bundle "${bundleName}".`, {
                cause: err,
              });
            }
          }
        }

        const rawBundleChunks = rawCssBundles.get(bundleName);
        if (rawBundleChunks) {
          if (parentCallSiteURL) {
            const callerFilePath = fileURLToPath(parentCallSiteURL);
            dependencies.add(callerFilePath);
          }
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
    [cssTemplateResultSymbol]: true,
  };
};

css.getDefaultBundleName = () => getConfig().css.defaultBundleName;

css.bundle = <TBundleName extends string>(bundleName: TBundleName) => makeBundleStartObject("css", bundleName);

css.import = (importPath: string, bundleName?: string) => {
  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return makeCssOrJsBundleImportObject("css", resolvedFilePath, bundleName);
  } catch (err) {
    throw new Error(`css.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

css.inline = <TBundleName extends string>(bundleName: TBundleName) => makeCssOrJsBundleInlineObject("css", bundleName);

css.src = <TBundleName extends string>(bundleName: TBundleName) => makeBundleSrcObject("css", bundleName);
