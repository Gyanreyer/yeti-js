import { transform as transformCSS } from 'lightningcss';
import { transform as transformJS } from 'esbuild';

import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import type { YetiConfig } from '../config.ts';
import { YETI_NODE_TYPE } from '../html/types.ts';
import { isYetiNode } from '../html/utils.ts';
import { renderHTML } from '../html/renderHTML.ts';
import { parseHTML } from '../html/parseHTML.ts';
import { safeWriteFile } from '../utils/safeWriteFile.ts';
import { concatUint8Arrays } from '../utils/concatUint8Arrays.ts';
import { getCSSImportBundle, getJSImportBundle } from '../bundle/bundleImportCache.ts';
import { makeBundleVersionPlaceholder } from './bundleVersionPlaceholder.ts';
import type { PageBundleAggregate } from './processPageComponent.ts';

/**
 * Cross-page merged shape for a single bundle name. Built up in `eleventy.after` by
 * unioning import paths and concatenating raw contents from every page that contributed
 * to the bundle.
 */
export interface MergedBundleAggregate {
  importPaths: Set<string>;
  rawContents: Uint8Array[];
}

/**
 * Performs final transforms on the merged contents of an external CSS bundle, then writes the bundle to disk.
 *
 * The merged aggregate's `importPaths` are bundled in a single `getCSSImportBundle` call so
 * lightningcss runs once over the union of every page's imports for this bundle name.
 * That output is concatenated with each page's raw contribution and run through the final
 * lightningcss transform pass.
 */
export const processAndWriteExternalCSSBundle = async (
  bundleName: string,
  bundleAggregate: MergedBundleAggregate,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  const codeChunks: Uint8Array[] = [];
  if (bundleAggregate.importPaths.size > 0) {
    const importBundleResult = await getCSSImportBundle(bundleAggregate.importPaths);
    codeChunks.push(importBundleResult.code);
  }
  codeChunks.push(...bundleAggregate.rawContents);
  const combinedCode = concatUint8Arrays(codeChunks);

  const outputFilePath = config.css.deriveBundleFilePath(bundleName);

  const transformConfig = config.css.deriveBundleTransformConfig(bundleName, config.css.defaultBundleTransformConfig);
  const { code } = transformCSS({
    ...transformConfig,
    code: combinedCode,
    filename: outputFilePath,
  });

  bundleContentHashes.set(
    makeBundleVersionPlaceholder("css", bundleName),
    createHash("sha256").update(code).digest("hex").slice(0, 8),
  );
  await safeWriteFile(join(output, outputFilePath), code);
};

/**
 * Performs final transforms on the merged contents of an external JS bundle, then writes the bundle to disk.
 *
 * The merged aggregate's `importPaths` are bundled in a single `getJSImportBundle` call so
 * esbuild runs once over the union of every page's imports for this bundle name. That
 * single deduplicated output is concatenated with each page's raw contribution and run
 * through the final esbuild transform pass.
 */
export const processAndWriteExternalJSBundle = async (
  bundleName: string,
  bundleAggregate: MergedBundleAggregate,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  const codeChunks: Uint8Array[] = [];
  if (bundleAggregate.importPaths.size > 0) {
    const importBundleResult = await getJSImportBundle(bundleAggregate.importPaths);
    codeChunks.push(importBundleResult.code);
  }
  codeChunks.push(...bundleAggregate.rawContents);
  const combinedCode = concatUint8Arrays(codeChunks);

  const outputFilePath = config.js.deriveBundleFilePath(bundleName);

  const transformConfig = config.js.deriveBundleTransformConfig(bundleName, config.js.defaultBundleTransformConfig);
  const transformResult = await transformJS(combinedCode, transformConfig);

  bundleContentHashes.set(
    makeBundleVersionPlaceholder("js", bundleName),
    createHash("sha256").update(transformResult.code).digest("hex").slice(0, 8),
  );
  await safeWriteFile(join(output, outputFilePath), transformResult.code);
};

/**
 * Merge a single page's bundle aggregates into the cross-page merged aggregates.
 * Import paths are unioned (string-deduped via the Set), and raw contents are appended
 * preserving each page's contribution.
 */
export const mergePageBundleAggregates = (
  merged: Map<string, MergedBundleAggregate>,
  pageBundles: Map<string, PageBundleAggregate>,
): void => {
  for (const [bundleName, pageAgg] of pageBundles) {
    let mergedAgg = merged.get(bundleName);
    if (!mergedAgg) {
      mergedAgg = { importPaths: new Set(), rawContents: [] };
      merged.set(bundleName, mergedAgg);
    }
    for (const importPath of pageAgg.importPaths) {
      mergedAgg.importPaths.add(importPath);
    }
    mergedAgg.rawContents.push(...pageAgg.rawContents);
  }
};

/**
 * Performs final transforms on the combined contents of an external HTML bundle, then writes the bundle to disk
 */
export const processAndWriteExternalHTMLBundle = async (
  bundleName: string,
  importPaths: Set<string>,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  const outputFilePath = config.html.deriveBundleFilePath(bundleName);

  // Open all file handles and stat them in parallel, then read sequentially into a pre-allocated buffer
  const fileEntries = await Promise.all(
    Array.from(importPaths).map(async (importPath) => {
      const fh = await open(importPath, "r");
      const { size } = await fh.stat();
      return { fh, size };
    })
  );

  let bundleByteLength = 0;
  for (const { size } of fileEntries) {
    bundleByteLength += size;
  }
  const combinedBundleBytes = new Uint8Array(bundleByteLength);
  try {
    let offset = 0;
    for (const { fh, size } of fileEntries) {
      await fh.read(combinedBundleBytes, offset, size);
      offset += size;
    }
  } finally {
    await Promise.all(fileEntries.map(({ fh }) => fh.close()));
  }

  const transformConfig = config.html.deriveBundleTransformConfig(bundleName, config.html.defaultBundleTransformConfig);
  let parsedBundleRootNode = await parseHTML(combinedBundleBytes);
  if (transformConfig.processNodeTree) {
    parsedBundleRootNode = await transformConfig.processNodeTree(parsedBundleRootNode);
    if (!isYetiNode(parsedBundleRootNode) || parsedBundleRootNode.type !== YETI_NODE_TYPE.ROOT) {
      throw new Error(`Expected processNodeTree function to return a YetiRootNode for bundle ${bundleName}. Received: ${JSON.stringify(parsedBundleRootNode)}`);
    }
  }

  const renderedHTML = renderHTML(parsedBundleRootNode, {
    indentation: transformConfig.minify ? null : "  ",
  });

  bundleContentHashes.set(
    makeBundleVersionPlaceholder("html", bundleName),
    createHash("sha256").update(renderedHTML).digest("hex").slice(0, 8),
  );
  await safeWriteFile(join(output, outputFilePath), renderedHTML);
};
