import { bundleAsync } from 'lightningcss';
import { BUNDLE_TYPE, isBundleObject, makeBundleInlineObject, makeBundleSrcObject, makeBundleStartObject, makeBundleImportObject } from "../bundle/bundle.ts";
import { resolveImportPath } from "../bundle/import.ts";
import { getConfig } from "../config.ts";
import { BundleError } from "../error.ts";
import { textEncoder } from '../html/utils.ts';

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

export const css = (strings: TemplateStringsArray, ...values: unknown[]): CSSTemplateResult => {
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

  const bundleGetterMap = new Map<string, () => Promise<CSSBundleResult>>();

  for (const bundleName of bundleNames) {
    bundleGetterMap.set(bundleName, async () => {
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
            });
            if (result.dependencies) {
              for (const dependency of result.dependencies) {
                dependencies.add(dependency.url);
              }
            }
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
    return makeBundleImportObject("css", resolvedFilePath, bundleName);
  } catch (err) {
    throw new Error(`css.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

css.inline = <TBundleName extends string>(bundleName: TBundleName) => makeBundleInlineObject("css", bundleName);

css.src = <TBundleName extends string>(bundleName: TBundleName) => makeBundleSrcObject("css", bundleName);
