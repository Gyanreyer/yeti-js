import { getCallSites } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  BUNDLE_TYPE,
  isBundleObject,
  makeCssOrJsBundleInlineObject,
  makeBundleSrcObject,
  makeBundleStartObject,
  makeCssOrJsBundleImportObject,
  PAGE_BUNDLE_NAME,
  type BundleContribution,
} from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { BundleError } from "../error.ts";
import { textEncoder } from '../utils/textEncoder.ts';

export const cssTemplateResultSymbol = Symbol("CSS_TEMPLATE_RESULT");

export type CSSTemplateResult = {
  bundles: Map<string, BundleContribution>;
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
  const callerFilePath = parentCallSiteURL ? fileURLToPath(parentCallSiteURL) : undefined;

  const rawCssBundles = new Map<string, string[]>();
  const bundleImportPaths = new Map<string, Set<string>>();

  let currentBundleName: string = PAGE_BUNDLE_NAME;
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

  // Filter out bundles that contain only whitespace AND have no imports.
  for (const bundleName of bundleNames) {
    const rawChunks = rawCssBundles.get(bundleName);
    if (!rawChunks || rawChunks.every(chunk => chunk.trimStart().length === 0)) {
      rawCssBundles.delete(bundleName);
      const hasImports = (bundleImportPaths.get(bundleName)?.size ?? 0) > 0;
      if (!hasImports) {
        bundleNames.delete(bundleName);
      }
    }
  }

  // Materialize the final BundleContribution map.
  const bundles = new Map<string, BundleContribution>();
  for (const bundleName of bundleNames) {
    const rawChunks = rawCssBundles.get(bundleName);
    const importPaths = bundleImportPaths.get(bundleName) ?? new Set<string>();
    const hasRawContent = rawChunks !== undefined && rawChunks.length > 0;
    bundles.set(bundleName, {
      importPaths,
      rawContent: hasRawContent ? textEncoder.encode(rawChunks.join("")) : new Uint8Array(0),
      callerFilePath: hasRawContent ? callerFilePath : undefined,
    });
  }

  return {
    bundles,
    [cssTemplateResultSymbol]: true,
  };
};

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
