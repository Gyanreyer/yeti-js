import type EleventyUserConfig from '@11ty/eleventy/UserConfig';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';

import { updateConfig, type YetiConfig } from '../config.ts';
import { log, logError } from '../log.ts';
import type { EleventyPageData, YetiPageComponent } from './types.ts';
import { YETI_NODE_TYPE } from '../html/types.ts';
import { isYetiNode } from '../html/utils.ts';
import { renderHTML } from '../html/renderHTML.ts';
import { processPageComponent, type PageBundleAggregate } from './processPageComponent.ts';
import {
  resetUsedExternalSpecifiers,
  buildAndWriteExternalDependencies,
} from '../js/externalDependencies.ts';
import { mergeBundleSetMaps } from '../bundle/mergeBundleContents.ts';
import {
  resetAccessTracking,
  invalidateStaleEntries,
  loadBundleImportCache,
  saveBundleImportCache,
} from '../bundle/bundleImportCache.ts';
import {
  processAndWriteExternalCSSBundle,
  processAndWriteExternalJSBundle,
  processAndWriteExternalHTMLBundle,
  mergePageBundleAggregates,
  type MergedBundleAggregate,
} from './processExternalBundles.ts';
import {
  computeCacheVersionKey,
  loadBuildCache,
  saveBuildCache,
  evictDeletedPages,
  type HashPosition,
  type PageCacheEntry,
  type BuildCacheData,
} from './buildCache.ts';

// Register an ESM resolver hook that cache-busts project file imports during
// watch rebuilds so that component-attached assets (css`...`, js`...`) are
// re-evaluated when source files change. The hook is registered once at module
// load time; a MessagePort sends the input directory and a build counter before
// each build so the resolver knows what to bust.
const { port1: esmCacheBustPort, port2 } = new MessageChannel();
// `import.meta.resolve` takes a plain string that TypeScript's `rewriteRelativeImportExtensions`
// does not rewrite, so we pick the extension that matches however this module itself was loaded.
const esmCacheBustSpecifier = import.meta.url.endsWith(".ts")
  ? "./esmCacheBust.ts"
  : "./esmCacheBust.js";
register(
  import.meta.resolve(esmCacheBustSpecifier),
  { data: { port: port2 }, transferList: [port2] },
);

let esmCacheBustBuildId = 0;

export const yetiPlugin = (eleventyConfig: EleventyUserConfig, userConfig: Partial<YetiConfig> = {}) => {
  // Update the Yeti config with any user-provided values
  const config = updateConfig(userConfig);

  // Watch all files in the input directory so that changes to non-template dependencies
  // (e.g. components, CSS files) are detected by Eleventy's watcher and trigger rebuilds.
  eleventyConfig.addWatchTarget((eleventyConfig.directories as { input: string }).input);

  // Persistent build cache state, loaded from disk at the start of each build.
  let buildCache: BuildCacheData | null = null;
  let cacheVersionKey: string | null = null;

  // Maps input paths to the per-page external bundle aggregates which we should merge across
  // pages in the "eleventy.after" hook before bundling, transforming, and writing to files.
  let globalExternalBundleContents: {
    [inputPath: string]: {
      css: Map<string, PageBundleAggregate>;
      js: Map<string, PageBundleAggregate>;
      htmlImportPaths: Map<string, Set<string>>;
    };
  } = {};

  eleventyConfig.on("eleventy.before", async ({
    directories: {
      // These directory paths are relative to the project root (CWD)
      input: inputDir,
      output: outputDir,
    },
  }: {
    directories: {
      input: string;
      output: string;
    };
  }) => {
    updateConfig({
      inputDir: resolve(inputDir),
      outputDir: resolve(outputDir),
      quietMode: eleventyConfig.quietMode,
      ...userConfig,
    });

    // Notify the ESM resolver hook of the new build so it cache-busts project file imports.
    esmCacheBustPort.postMessage({ inputDir: resolve(inputDir), buildId: ++esmCacheBustBuildId });

    resetUsedExternalSpecifiers();
    resetAccessTracking();

    // Compute the cache version key once per process. Both the page build cache and the
    // bundle import cache are gated by this same key (yeti + esbuild + lightningcss + format).
    cacheVersionKey ??= await computeCacheVersionKey();

    // Load both persistent caches from disk. The bundle import cache is loaded BEFORE
    // `invalidateStaleEntries()` so the existing mtime-based invalidation logic naturally
    // drops persisted entries whose deps changed on disk while no build was running.
    await loadBundleImportCache(config.cacheDir, cacheVersionKey, config.inputDir);

    // Drop any stale entries from the bundle import cache so watch-mode rebuilds pick up
    // dependency file changes. Untouched entries survive across builds.
    await invalidateStaleEntries();

    // Load the persistent page build cache from disk. This populates
    // globalExternalBundleContents with cached per-page bundle contributions
    // so that incremental builds (where only some pages recompile) still
    // have complete bundle data for the merge step in eleventy.after.
    buildCache = await loadBuildCache(config.cacheDir, cacheVersionKey, config.inputDir);

    // Replace globalExternalBundleContents with what's in the cache.
    // Pages that recompile this build will overwrite their entries in compile().
    globalExternalBundleContents = {};
    if (buildCache) {
      for (const [inputPath, entry] of buildCache.pages) {
        globalExternalBundleContents[inputPath] = entry.externalBundles;
      }
      // Evict cache entries for pages whose source files no longer exist on disk.
      await evictDeletedPages(buildCache.pages);
    }
  });

  eleventyConfig.addTemplateFormats(config.pageTemplateFileExtension);



  eleventyConfig.addExtension(config.pageTemplateFileExtension, {
    useJavaScriptImport: true,
    async getInstanceFromInputPath(inputPath: string) {
      // Use a file: URL so the ESM cache-bust resolver hook can intercept it.
      const mod = await import(
        pathToFileURL(resolve(process.cwd(), inputPath)).href
      );
      return {
        pageComponent: mod.default,
        config: mod.config,
      }
    },
    getData: ["config"],
    compile(this: {
      addDependencies: (input: string, dependencies: string[]) => void;
    }, { pageComponent }: { pageComponent: YetiPageComponent }, inputPath: string) {
      return async (data: EleventyPageData) => {
        const {
          pageRootNode,
          dependencies,
          externalBundles,
        } = await processPageComponent(pageComponent, data);
        if (!isYetiNode(pageRootNode) || pageRootNode.type !== YETI_NODE_TYPE.ROOT) {
          logError(`Error rendering page component for "${inputPath}": Expected component to return a YetiNode of type "ROOT". Page components must return an html template literal.`);
          return String(pageRootNode);
        }

        this.addDependencies(inputPath, Array.from(dependencies));
        globalExternalBundleContents[inputPath] = externalBundles;

        return renderHTML(pageRootNode, {
          indentation: config.html.minify ? null : "  ",
        });
      };
    },
  });

  eleventyConfig.on("eleventy.after", async ({
    directories: { output },
    results,
  }: {
    directories: {
      output: string;
    };
    results: Array<{ inputPath: string; outputPath: string }>;
  }) => {
    // Combine the per-page bundle aggregates for each bundle name across pages so we can run
    // a single bundling/transform pass per merged bundle in the output directory.
    const mergedCSSBundles = new Map<string, MergedBundleAggregate>();
    const mergedJSBundles = new Map<string, MergedBundleAggregate>();
    const combinedHTMLImportPaths = new Map<string, Set<string>>();

    for (const { css, js, htmlImportPaths } of Object.values(globalExternalBundleContents)) {
      mergePageBundleAggregates(mergedCSSBundles, css);
      mergePageBundleAggregates(mergedJSBundles, js);
      mergeBundleSetMaps(combinedHTMLImportPaths, htmlImportPaths);
    }

    // Map of placeholder token → content hash, populated as bundles are transformed and written
    const bundleContentHashes = new Map<string, string>();

    const processBundlePromises = new Array<Promise<void>>(mergedCSSBundles.size + mergedJSBundles.size + combinedHTMLImportPaths.size);
    let i = 0;
    for (const [bundleName, mergedAggregate] of mergedCSSBundles) {
      processBundlePromises[i++] = processAndWriteExternalCSSBundle(bundleName, mergedAggregate, output, config, bundleContentHashes);
    }
    for (const [bundleName, mergedAggregate] of mergedJSBundles) {
      processBundlePromises[i++] = processAndWriteExternalJSBundle(bundleName, mergedAggregate, output, config, bundleContentHashes);
    }
    for (const [bundleName, importPaths] of combinedHTMLImportPaths) {
      processBundlePromises[i++] = processAndWriteExternalHTMLBundle(bundleName, importPaths, output, config, bundleContentHashes);
    }
    await Promise.all(processBundlePromises);

    // Rewrite page HTML files to replace bundle version placeholder tokens with actual content hashes.
    // Track the exact character positions of each substituted hash so that future incremental
    // builds can update unchanged pages' hashes by direct offset splicing (zero false-match risk).
    const pageHashPositions = new Map<string, HashPosition[]>();

    if (bundleContentHashes.size > 0) {
      // Pass 1: rebuilt pages — substitute placeholder tokens with content hashes,
      // tracking the output position of each hash for the build cache.
      await Promise.all(
        results.map(async ({ inputPath, outputPath }) => {
          const original = await readFile(outputPath, "utf-8");

          // Find all placeholder occurrences across all bundles, sorted by position.
          const matches: { pos: number; placeholder: string; hash: string }[] = [];
          for (const [placeholder, hash] of bundleContentHashes) {
            let searchPos = 0;
            while (true) {
              const idx = original.indexOf(placeholder, searchPos);
              if (idx === -1) {
                break;
              }
              matches.push({ pos: idx, placeholder, hash });
              searchPos = idx + placeholder.length;
            }
          }

          if (matches.length === 0) {
            return;
          }
          matches.sort((a, b) => a.pos - b.pos);

          // Single-pass string build: replace each placeholder with its hash and
          // record the hash's character position in the output.
          const parts: string[] = [];
          const positions: HashPosition[] = [];
          let cursor = 0;
          let outputLen = 0;

          for (const { pos, placeholder, hash } of matches) {
            // Get the portion of the string that comes before this placeholder and append it to the output parts array.
            const before = original.slice(cursor, pos);
            parts.push(before);
            // Use the total length up to this point in the output string as the hash position
            outputLen += before.length;
            positions.push({ position: outputLen, placeholder });
            parts.push(hash);
            outputLen += hash.length;
            cursor = pos + placeholder.length;
          }
          parts.push(original.slice(cursor));
          const substituted = parts.join("");

          pageHashPositions.set(inputPath, positions);
          await writeFile(outputPath, substituted);
        })
      );

      // Pass 2: unchanged pages — update stale bundle hashes from previous builds.
      //
      // In incremental builds, Eleventy only rebuilds pages whose deps changed.
      // Pages that weren't rebuilt have old hashes baked into their on-disk HTML
      // from a previous build. If a bundle's content hash changed this build
      // (because a rebuilt page contributed different content to it), any unchanged
      // page referencing that bundle is left pointing at a stale hash.
      //
      // Using the exact character positions recorded in the build cache from the
      // previous build, splice current hashes directly at the known offsets.
      // All hashes are exactly 8 characters, so positions never shift between
      // substitutions.
      if (buildCache) {
        const rebuiltInputPaths = new Set(results.map(({ inputPath }) => inputPath));
        await Promise.all(
          Array.from(buildCache.pages.entries())
            .filter(([inputPath]) => !rebuiltInputPaths.has(inputPath))
            .map(async ([inputPath, entry]) => {
              if (entry.hashPositions.length === 0) {
                return;
              }

              let content = await readFile(entry.outputPath, "utf-8");
              let modified = false;

              for (const { position, placeholder } of entry.hashPositions) {
                const currentHash = bundleContentHashes.get(placeholder);
                if (!currentHash) {
                  continue;
                }
                const existingHash = content.slice(position, position + 8);
                if (existingHash !== currentHash) {
                  content = `${content.slice(0, position)}${currentHash}${content.slice(position + 8)}`;
                  modified = true;
                }
              }

              if (modified) {
                await writeFile(entry.outputPath, content);
                log(`Updated stale bundle hash${entry.hashPositions.length > 1 ? "es" : ""} in unchanged page "${entry.outputPath}"`);
              }

              // Carry forward the cached positions for unchanged pages
              pageHashPositions.set(inputPath, entry.hashPositions);
            })
        );
      }
    }

    // Build and write external dependency bundles
    if (config.js.externalDependencies) {
      await buildAndWriteExternalDependencies(config.js.externalDependencies, output);
    }

    // Persist the build cache to disk for future incremental builds.
    const updatedPages = new Map<string, PageCacheEntry>();
    for (const [inputPath, externalBundles] of Object.entries(globalExternalBundleContents)) {
      // Find the outputPath for this page. Rebuilt pages have it in results;
      // cached pages have it in the existing cache.
      const resultEntry = results.find((r) => r.inputPath === inputPath);
      const outputPath = resultEntry?.outputPath
        ?? buildCache?.pages.get(inputPath)?.outputPath;
      if (outputPath) {
        updatedPages.set(inputPath, {
          outputPath,
          hashPositions: pageHashPositions.get(inputPath) ?? [],
          externalBundles,
        });
      }
    }

    await Promise.all([
      saveBuildCache(config.cacheDir, config.inputDir, {
        cacheVersionKey: cacheVersionKey!,
        lastBundleContentHashes: bundleContentHashes,
        pages: updatedPages,
      }),
      saveBundleImportCache(config.cacheDir, cacheVersionKey!, config.inputDir),
    ]);
  });
}