import { transform as transformCSS } from 'lightningcss';
import { transform as transformJS } from 'esbuild';

import { join } from 'node:path';
import { createHash } from 'node:crypto';

import type { YetiConfig } from '../config.ts';
import { logWarning } from '../log.ts';
import { YETI_NODE_TYPE } from '../html/types.ts';
import { isYetiNode } from '../html/utils.ts';
import { renderHTML } from '../html/renderHTML.ts';
import { parseHTML } from '../html/parseHTML.ts';
import { writeFileIfChanged } from '../utils/writeFileIfChanged.ts';
import { readAndConcatFiles } from '../utils/readAndConcatFiles.ts';
import { concatUint8Arrays } from '../utils/concatUint8Arrays.ts';
import {
  getCSSImportBundle,
  getJSImportBundle,
  deriveBundleOutputCacheKey,
  getCachedBundleOutput,
  setCachedBundleOutput,
} from '../bundle/bundleImportCache.ts';
import { makeBundleVersionPlaceholder, makePageBundleVersionPlaceholder } from './bundleVersionPlaceholder.ts';
import type { PageBundleAggregate, PageScopedBundles } from './processPageComponent.ts';
import type { PageContext } from './types.ts';

const textEncoder = new TextEncoder();

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
 * Shared output-cache / placeholder / write pipeline used by every bundle-writing variant
 * (external CSS/JS/HTML and page-scoped CSS/JS/HTML). Looks up `combinedCode` + `transformConfig`
 * in the bundle output cache; on a miss it runs `transform()` to produce the final bytes,
 * hashes them, and stores the entry. Then registers the placeholder → content hash mapping
 * and writes the bytes (skipping the write if the file is byte-identical on disk).
 */
const processAndWriteBundle = async ({
  combinedCode,
  transformConfig,
  outputFilePath,
  outputAbsolutePath,
  placeholderToken,
  bundleContentHashes,
  transform,
}: {
  combinedCode: Uint8Array;
  transformConfig: unknown;
  /** Site-relative output path, also passed as the `filename` to the CSS/HTML transform. */
  outputFilePath: string;
  outputAbsolutePath: string;
  placeholderToken: string;
  bundleContentHashes: Map<string, string>;
  transform: () => Promise<Uint8Array> | Uint8Array;
}): Promise<void> => {
  const cacheKey = deriveBundleOutputCacheKey(combinedCode, transformConfig, outputFilePath);
  let entry = getCachedBundleOutput(cacheKey);
  if (!entry) {
    const code = await transform();
    entry = {
      code,
      contentHash: createHash("sha256").update(code).digest("hex").slice(0, 8),
    };
    setCachedBundleOutput(cacheKey, entry);
  }
  bundleContentHashes.set(placeholderToken, entry.contentHash);
  await writeFileIfChanged(outputAbsolutePath, entry.code);
};

/**
 * Build the combined input bytes for a CSS bundle: lightningcss-bundled imports (if any)
 * concatenated with each contributing page's raw template contents.
 */
const buildCombinedCSSCode = async (
  importPaths: Set<string>,
  rawContents: Uint8Array[],
): Promise<Uint8Array> => {
  const codeChunks: Uint8Array[] = [];
  if (importPaths.size > 0) {
    const importBundleResult = await getCSSImportBundle(importPaths);
    codeChunks.push(importBundleResult.code);
  }
  codeChunks.push(...rawContents);
  return concatUint8Arrays(codeChunks);
};

/**
 * Build the combined input bytes for a JS bundle: esbuild-bundled imports (if any)
 * concatenated with each contributing page's raw template contents.
 */
const buildCombinedJSCode = async (
  importPaths: Set<string>,
  rawContents: Uint8Array[],
): Promise<Uint8Array> => {
  const codeChunks: Uint8Array[] = [];
  if (importPaths.size > 0) {
    const importBundleResult = await getJSImportBundle(importPaths);
    codeChunks.push(importBundleResult.code);
  }
  codeChunks.push(...rawContents);
  return concatUint8Arrays(codeChunks);
};

/**
 * Parse the combined bundle bytes, optionally run the user-supplied `processNodeTree` hook
 * over the parsed tree, and render the final HTML output. `errorContextLabel` is woven into
 * the validation error message so failures point at the offending bundle.
 */
const transformHTMLBundle = async (
  combinedBytes: Uint8Array,
  transformConfig: YetiConfig["html"]["defaultBundleTransformConfig"],
  errorContextLabel: string,
): Promise<Uint8Array> => {
  let parsedBundleRootNode = await parseHTML(combinedBytes);
  if (transformConfig.processNodeTree) {
    parsedBundleRootNode = await transformConfig.processNodeTree(parsedBundleRootNode);
    if (!isYetiNode(parsedBundleRootNode) || parsedBundleRootNode.type !== YETI_NODE_TYPE.ROOT) {
      throw new Error(`Expected processNodeTree function to return a YetiRootNode for ${errorContextLabel}. Received: ${JSON.stringify(parsedBundleRootNode)}`);
    }
  }
  const renderedHTML = renderHTML(parsedBundleRootNode, {
    indentation: transformConfig.minify ? null : "  ",
  });
  return textEncoder.encode(renderedHTML);
};

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
  const combinedCode = await buildCombinedCSSCode(bundleAggregate.importPaths, bundleAggregate.rawContents);
  const outputFilePath = config.css.deriveBundleFilePath(bundleName);
  const transformConfig = config.css.deriveBundleTransformConfig(bundleName, config.css.defaultBundleTransformConfig);

  await processAndWriteBundle({
    combinedCode,
    transformConfig,
    outputFilePath,
    outputAbsolutePath: join(output, outputFilePath),
    placeholderToken: makeBundleVersionPlaceholder("css", bundleName),
    bundleContentHashes,
    transform: () => transformCSS({
      ...transformConfig,
      code: combinedCode,
      filename: outputFilePath,
    }).code,
  });
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
  const combinedCode = await buildCombinedJSCode(bundleAggregate.importPaths, bundleAggregate.rawContents);
  const outputFilePath = config.js.deriveBundleFilePath(bundleName);
  const transformConfig = config.js.deriveBundleTransformConfig(bundleName, config.js.defaultBundleTransformConfig);

  await processAndWriteBundle({
    combinedCode,
    transformConfig,
    outputFilePath,
    outputAbsolutePath: join(output, outputFilePath),
    placeholderToken: makeBundleVersionPlaceholder("js", bundleName),
    bundleContentHashes,
    transform: async () => textEncoder.encode((await transformJS(combinedCode, transformConfig)).code),
  });
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
 * Cross-page merged shape for a per-template `@page` bundle. Pagination variants of the same
 * template share an `inputPath` and merge into a single entry — the unioned import paths +
 * concatenated raw contents become the source of one page-bundle file written to disk.
 *
 * `page` is the most recent `PageContext` observed for this template; it's used
 * for `derivePageBundleFilePath(page)`. We carry only the `page` subobject (not full
 * `EleventyPageData`) because Eleventy's surrounding context (`pagination`, `collections`,
 * etc.) contains circular refs that don't survive build-cache JSON serialization. The default
 * deriver only reads `page.inputPath`, which is constant across pagination variants.
 */
export interface MergedPageBundle {
  inputPath: string;
  page: PageContext;
  css: MergedBundleAggregate | null;
  js: MergedBundleAggregate | null;
  htmlImportPaths: Set<string> | null;
}

/**
 * Merge one page's `PageScopedBundles` into the cross-template merged map keyed by `inputPath`.
 */
export const mergePageScopedBundles = (
  merged: Map<string, MergedPageBundle>,
  pageBundles: PageScopedBundles,
  page: PageContext,
): void => {
  let entry = merged.get(pageBundles.inputPath);
  if (!entry) {
    entry = {
      inputPath: pageBundles.inputPath,
      page,
      css: null,
      js: null,
      htmlImportPaths: null,
    };
    merged.set(pageBundles.inputPath, entry);
  }

  if (pageBundles.css) {
    if (!entry.css) {
      entry.css = { importPaths: new Set(), rawContents: [] };
    }
    for (const importPath of pageBundles.css.importPaths) {
      entry.css.importPaths.add(importPath);
    }
    entry.css.rawContents.push(...pageBundles.css.rawContents);
  }

  if (pageBundles.js) {
    if (!entry.js) {
      entry.js = { importPaths: new Set(), rawContents: [] };
    }
    for (const importPath of pageBundles.js.importPaths) {
      entry.js.importPaths.add(importPath);
    }
    entry.js.rawContents.push(...pageBundles.js.rawContents);
  }

  if (pageBundles.html) {
    if (!entry.htmlImportPaths) {
      entry.htmlImportPaths = new Set();
    }
    for (const importPath of pageBundles.html) {
      entry.htmlImportPaths.add(importPath);
    }
  }
};

/**
 * The bundle contributions a single page render produces: per-name external CSS/JS aggregates,
 * external HTML import paths, and the page-scoped (`@page`) bundles. This is the shape the plugin
 * accumulates per template `inputPath` across renders before the `eleventy.after` merge step.
 */
export interface PageRenderContributions {
  css: Map<string, PageBundleAggregate>;
  js: Map<string, PageBundleAggregate>;
  htmlImportPaths: Map<string, Set<string>>;
  pageBundles: PageScopedBundles;
}

const mergeAggregateInto = (
  target: PageBundleAggregate,
  incoming: PageBundleAggregate,
  seenRawContents: Set<Uint8Array>,
): void => {
  for (const importPath of incoming.importPaths) {
    target.importPaths.add(importPath);
  }
  // Dedupe rawContents by Uint8Array reference identity. A component's css/js tagged template is
  // evaluated once at module load, so the same component contributing across pagination variants
  // yields the *same* reference — we keep exactly one copy. Content authored only on some variants
  // is a distinct reference and is appended.
  for (const chunk of incoming.rawContents) {
    if (!seenRawContents.has(chunk)) {
      seenRawContents.add(chunk);
      target.rawContents.push(chunk);
    }
  }
};

const mergeAggregateMapInto = (
  target: Map<string, PageBundleAggregate>,
  incoming: Map<string, PageBundleAggregate>,
  seenRawContents: Set<Uint8Array>,
): void => {
  for (const [bundleName, incomingAgg] of incoming) {
    let targetAgg = target.get(bundleName);
    if (!targetAgg) {
      targetAgg = { importPaths: new Set(), rawContents: [] };
      target.set(bundleName, targetAgg);
    }
    mergeAggregateInto(targetAgg, incomingAgg, seenRawContents);
  }
};

const mergeStringSetMapInto = (
  target: Map<string, Set<string>>,
  incoming: Map<string, Set<string>>,
): void => {
  for (const [bundleName, incomingSet] of incoming) {
    let targetSet = target.get(bundleName);
    if (!targetSet) {
      targetSet = new Set();
      target.set(bundleName, targetSet);
    }
    for (const value of incomingSet) {
      targetSet.add(value);
    }
  }
};

/**
 * Collect every rawContent `Uint8Array` reference already present in `contributions` into a Set,
 * for use as the reference-dedupe membership index when merging in additional renders.
 *
 * Only rawContents need reference tracking; `importPaths` and HTML import paths are string Sets
 * that dedupe by value. A given rawContent reference only ever belongs to a single bundle (the one
 * its `bundle()` marker selected at authoring time), so a single shared Set across all bundles is
 * sufficient and correct.
 */
export const collectRawContentRefs = (contributions: PageRenderContributions): Set<Uint8Array> => {
  const seen = new Set<Uint8Array>();
  for (const agg of contributions.css.values()) {
    for (const chunk of agg.rawContents) seen.add(chunk);
  }
  for (const agg of contributions.js.values()) {
    for (const chunk of agg.rawContents) seen.add(chunk);
  }
  if (contributions.pageBundles.css) {
    for (const chunk of contributions.pageBundles.css.rawContents) seen.add(chunk);
  }
  if (contributions.pageBundles.js) {
    for (const chunk of contributions.pageBundles.js.rawContents) seen.add(chunk);
  }
  return seen;
};

/**
 * Merge one additional render's `incoming` contributions into the accumulated `target` for a
 * template `inputPath`. Used for pagination variants of the same template, which each invoke the
 * render function separately but must share a single set of bundles.
 *
 * Import paths and HTML paths union by string value; rawContents dedupe by reference identity via
 * `seenRawContents` (see {@link collectRawContentRefs}). `seenRawContents` must already contain the
 * references in `target` — seed it once from the first render before the first merge.
 */
export const mergeRenderContributions = (
  target: PageRenderContributions,
  incoming: PageRenderContributions,
  seenRawContents: Set<Uint8Array>,
): void => {
  mergeAggregateMapInto(target.css, incoming.css, seenRawContents);
  mergeAggregateMapInto(target.js, incoming.js, seenRawContents);
  mergeStringSetMapInto(target.htmlImportPaths, incoming.htmlImportPaths);

  if (incoming.pageBundles.css) {
    if (!target.pageBundles.css) {
      target.pageBundles.css = { importPaths: new Set(), rawContents: [] };
    }
    mergeAggregateInto(target.pageBundles.css, incoming.pageBundles.css, seenRawContents);
  }
  if (incoming.pageBundles.js) {
    if (!target.pageBundles.js) {
      target.pageBundles.js = { importPaths: new Set(), rawContents: [] };
    }
    mergeAggregateInto(target.pageBundles.js, incoming.pageBundles.js, seenRawContents);
  }
  if (incoming.pageBundles.html) {
    if (!target.pageBundles.html) {
      target.pageBundles.html = new Set();
    }
    for (const importPath of incoming.pageBundles.html) {
      target.pageBundles.html.add(importPath);
    }
  }
};

/**
 * Warn when two different page templates derive the same `@page` bundle output path for the same
 * asset type. `derivePageBundleFilePath` is documented as needing to return a path unique per
 * template; a collision silently overwrites one template's bundle with another's, so we surface
 * it as a warning rather than letting it pass unnoticed.
 *
 * Only bundles that will actually be written (non-empty for that asset type) are considered, and
 * detection is per asset type — matching the per-deriver contract. The derivers run here in
 * addition to the write step; they're expected to be pure path builders, so the extra calls are
 * cheap and side-effect-free.
 */
export const warnOnPageBundlePathCollisions = (
  mergedPageBundles: Map<string, MergedPageBundle>,
  config: YetiConfig,
): void => {
  // Per asset type: derived output path → the first template inputPath that claimed it.
  const claimedPaths: Record<"css" | "js" | "html", Map<string, string>> = {
    css: new Map(),
    js: new Map(),
    html: new Map(),
  };

  const checkAssetType = (
    assetType: "css" | "js" | "html",
    hasContent: boolean,
    pageBundle: MergedPageBundle,
  ): void => {
    if (!hasContent) {
      return;
    }
    const derivedPath = config[assetType].derivePageBundleFilePath(pageBundle.page);
    const claimed = claimedPaths[assetType];
    const claimant = claimed.get(derivedPath);
    if (claimant === undefined) {
      claimed.set(derivedPath, pageBundle.inputPath);
    } else if (claimant !== pageBundle.inputPath) {
      logWarning(
        `Page-bundle path collision: templates "${claimant}" and "${pageBundle.inputPath}" both ` +
        `derive the ${assetType.toUpperCase()} @page bundle path "${derivedPath}", so one will ` +
        `overwrite the other. Ensure "${assetType}.derivePageBundleFilePath" returns a unique path per template.`,
      );
    }
  };

  for (const pageBundle of mergedPageBundles.values()) {
    checkAssetType("css", pageBundle.css !== null, pageBundle);
    checkAssetType("js", pageBundle.js !== null, pageBundle);
    checkAssetType("html", pageBundle.htmlImportPaths !== null && pageBundle.htmlImportPaths.size > 0, pageBundle);
  }
};

/**
 * Records, per template `inputPath` and asset type, the distinct `@page` bundle output paths
 * derived across that template's rendered pages. Used to detect a `derivePageBundleFilePath`
 * that returns *different* paths for pagination variants of the same template — the inverse of
 * the cross-template collision that {@link warnOnPageBundlePathCollisions} catches.
 *
 * The three sets stay small (one entry per distinct path, normally one); they are not the per-page
 * data and do not grow with page count.
 */
export type PageBundlePathTracker = Map<string, { css: Set<string>; js: Set<string>; html: Set<string> }>;

/**
 * Record the `@page` bundle output paths a single render derived, one render at a time. Called for
 * every rendered page (including each pagination variant), but only for the asset types that the
 * render actually emits an external `@page` reference for — i.e. the ones whose `pageBundles.*`
 * field is populated. The deriver is the same pure path builder already invoked for the rendered
 * `src` value, so the extra call is cheap.
 */
export const recordRenderedPageBundlePaths = (
  tracker: PageBundlePathTracker,
  inputPath: string,
  pageBundles: Pick<PageScopedBundles, "css" | "js" | "html">,
  page: PageContext,
  config: YetiConfig,
): void => {
  let entry = tracker.get(inputPath);
  if (!entry) {
    entry = { css: new Set(), js: new Set(), html: new Set() };
    tracker.set(inputPath, entry);
  }
  if (pageBundles.css) {
    entry.css.add(config.css.derivePageBundleFilePath(page));
  }
  if (pageBundles.js) {
    entry.js.add(config.js.derivePageBundleFilePath(page));
  }
  if (pageBundles.html && pageBundles.html.size > 0) {
    entry.html.add(config.html.derivePageBundleFilePath(page));
  }
};

/**
 * Warn when a single template derives more than one `@page` bundle output path for the same asset
 * type across its rendered pages. Pagination variants of a template share one `@page` bundle file
 * (keyed by `inputPath`), written to the path derived from the *last-observed* page context. If
 * `derivePageBundleFilePath` keys off a per-page field (`url`, `outputPath`, …) instead of a
 * template-constant one (`inputPath`, `fileSlug`, …), each variant references a different path
 * while only one file is written — so the other variants reference a path that 404s.
 *
 * `tracker` holds the paths each render referenced; we additionally fold in the path the bundle is
 * actually written to (derived from `merged.page`, the last-observed context) so the comparison
 * still catches the case where the final variant referenced no content for an asset type but an
 * earlier variant did. Only asset types with content in the merged bundle are checked, mirroring
 * {@link warnOnPageBundlePathCollisions}. Templates not rendered this build (incremental cache
 * hits) have no tracker entry and are skipped.
 */
export const warnOnInconsistentPageBundlePaths = (
  tracker: PageBundlePathTracker,
  mergedPageBundles: Map<string, MergedPageBundle>,
  config: YetiConfig,
): void => {
  const assetTypes = ["css", "js", "html"] as const;
  for (const [inputPath, merged] of mergedPageBundles) {
    const observedPaths = tracker.get(inputPath);
    if (!observedPaths) {
      continue;
    }
    for (const assetType of assetTypes) {
      const hasContent = assetType === "html"
        ? merged.htmlImportPaths !== null && merged.htmlImportPaths.size > 0
        : merged[assetType] !== null;
      if (!hasContent) {
        continue;
      }
      const observed = observedPaths[assetType];
      // Fold in the path the bundle is actually written to so a final variant that referenced no
      // content for this asset type can't hide a mismatch with the content-bearing variants.
      observed.add(config[assetType].derivePageBundleFilePath(merged.page));
      if (observed.size > 1) {
        logWarning(
          `Inconsistent @page bundle path: template "${inputPath}" derived multiple distinct ` +
          `${assetType.toUpperCase()} @page bundle paths across its rendered pages ` +
          `(${Array.from(observed).map((p) => `"${p}"`).join(", ")}). Pagination variants of a ` +
          `template share a single @page bundle file, so "${assetType}.derivePageBundleFilePath" ` +
          `must return the same path for every variant — derive it from template-constant fields ` +
          `like "inputPath" or "fileSlug", not per-page fields like "url" or "outputPath". Variants ` +
          `referencing the un-written path(s) will 404.`,
        );
      }
    }
  }
};

/**
 * Write the CSS portion of a per-template page bundle. Mirrors `processAndWriteExternalCSSBundle`
 * but routes the output path through `config.css.derivePageBundleFilePath(pageProps)` and the
 * placeholder through `makePageBundleVersionPlaceholder` so each template gets its own file
 * and version-cache key.
 */
export const processAndWriteCSSPageBundle = async (
  pageBundle: MergedPageBundle,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  if (!pageBundle.css) return;
  const combinedCode = await buildCombinedCSSCode(pageBundle.css.importPaths, pageBundle.css.rawContents);
  const outputFilePath = config.css.derivePageBundleFilePath(pageBundle.page);
  const transformConfig = config.css.deriveBundleTransformConfig("@page", config.css.defaultBundleTransformConfig);

  await processAndWriteBundle({
    combinedCode,
    transformConfig,
    outputFilePath,
    outputAbsolutePath: join(output, outputFilePath),
    placeholderToken: makePageBundleVersionPlaceholder("css", pageBundle.inputPath),
    bundleContentHashes,
    transform: () => transformCSS({
      ...transformConfig,
      code: combinedCode,
      filename: outputFilePath,
    }).code,
  });
};

/**
 * Write the JS portion of a per-template page bundle.
 */
export const processAndWriteJSPageBundle = async (
  pageBundle: MergedPageBundle,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  if (!pageBundle.js) return;
  const combinedCode = await buildCombinedJSCode(pageBundle.js.importPaths, pageBundle.js.rawContents);
  const outputFilePath = config.js.derivePageBundleFilePath(pageBundle.page);
  const transformConfig = config.js.deriveBundleTransformConfig("@page", config.js.defaultBundleTransformConfig);

  await processAndWriteBundle({
    combinedCode,
    transformConfig,
    outputFilePath,
    outputAbsolutePath: join(output, outputFilePath),
    placeholderToken: makePageBundleVersionPlaceholder("js", pageBundle.inputPath),
    bundleContentHashes,
    transform: async () => textEncoder.encode((await transformJS(combinedCode, transformConfig)).code),
  });
};

/**
 * Write the HTML portion of a per-template page bundle. Read+concat+parse+transform mirrors
 * `processAndWriteExternalHTMLBundle`; only the output path and placeholder differ.
 */
export const processAndWriteHTMLPageBundle = async (
  pageBundle: MergedPageBundle,
  output: string,
  config: YetiConfig,
  bundleContentHashes: Map<string, string>,
) => {
  if (!pageBundle.htmlImportPaths || pageBundle.htmlImportPaths.size === 0) return;

  const outputFilePath = config.html.derivePageBundleFilePath(pageBundle.page);
  const combinedBundleBytes = await readAndConcatFiles(pageBundle.htmlImportPaths);
  const transformConfig = config.html.deriveBundleTransformConfig("@page", config.html.defaultBundleTransformConfig);

  await processAndWriteBundle({
    combinedCode: combinedBundleBytes,
    transformConfig,
    outputFilePath,
    outputAbsolutePath: join(output, outputFilePath),
    placeholderToken: makePageBundleVersionPlaceholder("html", pageBundle.inputPath),
    bundleContentHashes,
    transform: () => transformHTMLBundle(combinedBundleBytes, transformConfig, `@page bundle of "${pageBundle.inputPath}"`),
  });
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
  const combinedBundleBytes = await readAndConcatFiles(importPaths);
  const transformConfig = config.html.deriveBundleTransformConfig(bundleName, config.html.defaultBundleTransformConfig);

  await processAndWriteBundle({
    combinedCode: combinedBundleBytes,
    transformConfig,
    outputFilePath,
    outputAbsolutePath: join(output, outputFilePath),
    placeholderToken: makeBundleVersionPlaceholder("html", bundleName),
    bundleContentHashes,
    transform: () => transformHTMLBundle(combinedBundleBytes, transformConfig, `bundle ${bundleName}`),
  });
};
