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
import { makeBundleVersionPlaceholder } from './bundleVersionPlaceholder.ts';

/**
 * Performs final transforms on the combined contents of an external CSS bundle, then writes the bundle to disk
 */
export const processAndWriteExternalCSSBundle = async (
  bundleName: string,
  bundleContents: Set<Uint8Array>,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  const combinedCode = concatUint8Arrays(bundleContents);
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
 * Performs final transforms on the combined contents of an external JS bundle, then writes the bundle to disk
 */
export const processAndWriteExternalJSBundle = async (
  bundleName: string,
  bundleContents: Set<Uint8Array>,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  const combinedCode = concatUint8Arrays(bundleContents);
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
