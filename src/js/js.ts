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

const jsTemplateResultSymbol = Symbol("JS_TEMPLATE_RESULT");

export type JSTemplateResult = {
  bundles: Map<string, BundleContribution>;
  [jsTemplateResultSymbol]: true;
}

export const isJSTemplateResult = (obj: unknown): obj is JSTemplateResult => {
  return typeof obj === "object" && obj !== null &&
    jsTemplateResultSymbol in obj;
};

// Cache call site URLs by template strings array object. Tagged template literals reuse the same
// strings array reference across calls, so this avoids a V8 stack walk on every js`` invocation.
const callSiteCache = new WeakMap<TemplateStringsArray, string | undefined>();

export const js = (strings: TemplateStringsArray, ...values: unknown[]): JSTemplateResult => {
  // Get the file URL of the file which called this js template tag
  // so we can use it for dependency tracking
  let parentCallSiteURL: string | undefined;
  if (callSiteCache.has(strings)) {
    parentCallSiteURL = callSiteCache.get(strings);
  } else {
    parentCallSiteURL = getCallSites()[1]?.scriptName;
    callSiteCache.set(strings, parentCallSiteURL);
  }
  const callerFilePath = parentCallSiteURL ? fileURLToPath(parentCallSiteURL) : undefined;

  // Per-bundle accumulators populated as we walk the template strings/values.
  const rawJsBundles = new Map<string, string[]>();
  const bundleImportPaths = new Map<string, Set<string>>();

  let currentBundleName: string = PAGE_BUNDLE_NAME;
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

  // Filter out bundles that contain only whitespace AND have no imports.
  // Bundles with imports but only-whitespace raw content are kept (with no raw content).
  for (const bundleName of bundleNames) {
    const rawChunks = rawJsBundles.get(bundleName);
    if (!rawChunks || rawChunks.every(chunk => chunk.trimStart().length === 0)) {
      // Whitespace-only raw content is dropped from the contribution.
      rawJsBundles.delete(bundleName);
      const hasImports = (bundleImportPaths.get(bundleName)?.size ?? 0) > 0;
      if (!hasImports) {
        // No imports either — drop the bundle entirely.
        bundleNames.delete(bundleName);
      }
    }
  }

  // Materialize the final BundleContribution map. Encoding to Uint8Array up front (rather
  // than lazily inside a getter) makes the contribution immutable and removes the need
  // for the per-instance caching layer that the old getter pattern carried.
  const bundles = new Map<string, BundleContribution>();
  for (const bundleName of bundleNames) {
    const rawChunks = rawJsBundles.get(bundleName);
    const importPaths = bundleImportPaths.get(bundleName) ?? new Set<string>();
    const hasRawContent = rawChunks !== undefined && rawChunks.length > 0;
    bundles.set(bundleName, {
      importPaths,
      rawContent: hasRawContent ? textEncoder.encode(rawChunks.join("")) : new Uint8Array(0),
      // Caller file is only a dependency when its content actually contributed to the bundle.
      // For imports-only bundles, the caller's source body doesn't matter — only the import
      // path strings do, and those are captured at template construction time anyway.
      callerFilePath: hasRawContent ? callerFilePath : undefined,
    });
  }

  return {
    bundles,
    [jsTemplateResultSymbol]: true,
  };
};

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
