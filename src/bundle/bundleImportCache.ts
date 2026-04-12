import { build } from 'esbuild';
import { bundleAsync } from 'lightningcss';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { BundleError } from '../error.ts';
import { getConfig } from '../config.ts';
import { createExternalDependenciesEsbuildPlugin } from '../js/externalDependencies.ts';

/**
 * Result of bundling a set of import paths together for a single asset bundle.
 */
export interface BundleImportResult {
  /** Final bundled code (post-bundler, pre-final-transform) */
  code: Uint8Array;
  /** Absolute paths of all input files that contributed to this bundle (transitive deps included) */
  dependencyFilePaths: Set<string>;
  /**
   * Maps dependency file paths to millisecond timestamps of the last time the file was modified.
   * Used by `invalidateStaleEntries()` to detect when a tracked dep has changed on disk
   * and the cached result needs to be dropped.
   */
  dependencyLastModifiedTimestamps: Map<string, number>;
}

interface CacheEntry {
  /**
   * Promise resolving to the bundle result. Concurrent callers share this promise so the
   * underlying esbuild/lightningcss work happens at most once per cache key.
   */
  resultPromise: Promise<BundleImportResult>;
}

const jsCache = new Map<string, CacheEntry>();
const cssCache = new Map<string, CacheEntry>();

/**
 * Stable hash of an import path set, used as the cache key. Sort + hash so set ordering
 * doesn't affect lookup.
 */
const hashImportPaths = (importPaths: ReadonlySet<string>): string => {
  const sorted = Array.from(importPaths).sort();
  const hash = createHash('sha1');
  for (const p of sorted) {
    hash.update(p);
    hash.update('\0');
  }
  return hash.digest('hex');
};

/**
 * Gather a map of last modified times for a set of file paths.
 * If a file no longer exists, its last modified time is recorded as -1.
 */
const getFilePathLastModifiedTimes = async (filePaths: Iterable<string>): Promise<Map<string, number>> => {
  const lastModifiedTimes = new Map<string, number>();
  await Promise.all(
    Array.from(filePaths, async (dep) => {
      try {
        // mtimeMs is millisecond timestamp for last time the file was modified
        const { mtimeMs } = await stat(dep);
        lastModifiedTimes.set(dep, mtimeMs);
      } catch {
        lastModifiedTimes.set(dep, -1);
      }
    }),
  );
  return lastModifiedTimes;
};

/**
 * Filename used for the synthetic entry file passed to esbuild/lightningcss. Both bundlers
 * accept a virtual entry whose contents we provide; the filename only shows up in error
 * messages and metafile inputs (which we filter out).
 */
const SYNTHETIC_JS_ENTRY_NAME = '__yeti_bundle_entry__.js';
const SYNTHETIC_CSS_ENTRY_NAME = '__yeti_bundle_entry__.css';

/**
 * Bundle a set of JS import paths together into a single deduplicated output.
 *
 * Uses esbuild's `stdin` option to feed a synthetic entry file that re-imports each
 * absolute path. esbuild then walks the merged module graph and produces a single output
 * file in which any module shared between entry points appears exactly once.
 *
 * Results are memoized by the (sorted) import path set, so two pages contributing the
 * same imports to the same bundle name share a single bundling pass.
 */
export const getJSImportBundle = (importPaths: ReadonlySet<string>): Promise<BundleImportResult> => {
  if (importPaths.size === 0) {
    throw new BundleError('getJSImportBundle called with empty import path set');
  }

  const key = hashImportPaths(importPaths);
  const existing = jsCache.get(key);
  if (existing) {
    return existing.resultPromise;
  }

  // Sort import paths alphabetically to ensure our built
  // output is consistently stable regardless of the order in which
  // imports were contributed by pages.
  const sortedPaths = Array.from(importPaths).sort();
  // We're going to construct a synthetic entrypoint file which just imports all of the
  // input paths, then let esbuild do the work of bundling them up.
  const stdinContents = sortedPaths.map((p) => `import ${JSON.stringify(p)};`).join('\n');
  // esbuild needs a non-empty resolveDir to resolve any imports from the stdin source —
  // including absolute paths, which esbuild still validates against a real directory.
  // Anchor at the configured project input dir.
  const resolveDir = getConfig().inputDir;

  const resultPromise = (async (): Promise<BundleImportResult> => {
    const { externalDependencies } = getConfig().js;
    const plugins = externalDependencies
      ? [createExternalDependenciesEsbuildPlugin(externalDependencies, true)]
      : undefined;

    let buildResult;
    try {
      buildResult = await build({
        stdin: {
          contents: stdinContents,
          resolveDir,
          sourcefile: SYNTHETIC_JS_ENTRY_NAME,
          loader: 'js',
        },
        bundle: true,
        write: false,
        treeShaking: true,
        metafile: true,
        absPaths: ['metafile'],
        format: 'esm',
        platform: 'browser',
        // esbuild requires an outdir even when write is false; nothing is actually written there.
        outdir: 'out',
        // Suppress esbuild's stderr error logging on failure — we wrap any error in a
        // BundleError below, and consumers can decide whether to log/surface it.
        logLevel: 'silent',
        plugins,
      });
    } catch (err) {
      throw new BundleError(`Failed to bundle JS imports: ${sortedPaths.join(', ')}`, { cause: err });
    }

    if (buildResult.outputFiles.length !== 1) {
      throw new BundleError(
        `Expected exactly 1 output file from JS import bundle, got ${buildResult.outputFiles.length}`,
      );
    }

    const dependencyFilePaths = new Set<string>();
    for (const inputFile in buildResult.metafile.inputs) {
      // Filter the synthetic entry — it's a build artifact, not a real dependency.
      if (inputFile.endsWith(SYNTHETIC_JS_ENTRY_NAME)) {
        continue;
      }
      dependencyFilePaths.add(inputFile);
    }

    const dependencyLastModifiedTimestamps = await getFilePathLastModifiedTimes(dependencyFilePaths);

    return {
      code: buildResult.outputFiles[0].contents,
      dependencyFilePaths,
      dependencyLastModifiedTimestamps,
    };
  })();

  jsCache.set(key, { resultPromise });
  return resultPromise;
};

/**
 * Bundle a set of CSS import paths together into a single deduplicated output.
 *
 * Uses lightningcss's `bundleAsync` with a custom resolver that intercepts a synthetic
 * entry filename and returns a series of `@import` statements pointing at each absolute
 * import path. lightningcss handles transitive deps via the resolver and naturally
 * deduplicates files imported multiple times (per CSS @import semantics).
 *
 * Results are memoized by the (sorted) import path set.
 */
export const getCSSImportBundle = (importPaths: ReadonlySet<string>): Promise<BundleImportResult> => {
  if (importPaths.size === 0) {
    throw new BundleError('getCSSImportBundle called with empty import path set');
  }

  const key = hashImportPaths(importPaths);
  const existing = cssCache.get(key);
  if (existing) return existing.resultPromise;

  const sortedPaths = Array.from(importPaths).sort();
  // The synthetic entry file path is never read from disk; resolver intercepts it.
  // Anchor it in the configured project input dir so any relative resolution (which we
  // don't expect to happen, since we use absolute @import URLs) has a sane base.
  const syntheticDir = getConfig().inputDir;
  const syntheticPath = resolve(syntheticDir, SYNTHETIC_CSS_ENTRY_NAME);
  // Construct the synthetic entry file contents as a series of @import statements for each
  // input path. lightningcss will parse these and call our resolver for each one, which lets
  // us track all transitive dependencies without having to do our own graph walk.
  const syntheticCSS = sortedPaths.map((p) => `@import ${JSON.stringify(p)};`).join('\n');

  const resultPromise = (async (): Promise<BundleImportResult> => {
    const dependencyFilePaths = new Set<string>();

    let result;
    try {
      result = await bundleAsync({
        filename: syntheticPath,
        resolver: {
          async read(filePath) {
            if (filePath === syntheticPath) {
              // Synthetic entry: serve our generated @imports without touching the disk.
              return syntheticCSS;
            }
            dependencyFilePaths.add(filePath);
            return await readFile(filePath, 'utf-8');
          },
          resolve(specifier, from) {
            const resolved = resolve(dirname(from), specifier);
            dependencyFilePaths.add(resolved);
            return resolved;
          },
        },
      });
    } catch (err) {
      throw new BundleError(`Failed to bundle CSS imports: ${sortedPaths.join(', ')}`, { cause: err });
    }

    const dependencyLastModifiedTimestamps = await getFilePathLastModifiedTimes(dependencyFilePaths);

    return {
      code: result.code,
      dependencyFilePaths,
      dependencyLastModifiedTimestamps,
    };
  })();

  cssCache.set(key, { resultPromise });
  return resultPromise;
};

/**
 * Goes over all entries in a cache map and cleans up any entries
 * whose tracked dependency files have been modified since the last time we checked.
 */
const checkCacheEntries = async (
  cache: Map<string, CacheEntry>,
): Promise<void> => {
  await Promise.all(
    Array.from(cache.entries(), async ([key, entry]) => {
      let result: BundleImportResult;
      try {
        result = await entry.resultPromise;
      } catch {
        // Previous build failed — drop the failed entry so we retry on next request.
        cache.delete(key);
        return;
      }

      for (const [filePath, recordedLastModifiedTime] of result.dependencyLastModifiedTimestamps) {
        try {
          const { mtimeMs: currentLastModifiedTime } = await stat(filePath);
          if (currentLastModifiedTime !== recordedLastModifiedTime) {
            cache.delete(key);
            return;
          }
        } catch {
          // If the file no longer exists, we consider the entry stale and drop it.
          cache.delete(key);
          return;
        }
      }
    }),
  );
};

/**
 * Walk every cache entry and drop any whose tracked dependencies' mtimes no longer match
 * the snapshot taken at build time. Called from `eleventy.before` so that watch-mode
 * builds get fresh bundle results when input files change, but unchanged bundles can
 * be reused across builds.
 *
 * This is the seam intended for the upcoming incremental-build work — finer-grained
 * invalidation can plug in here without changing the public surface.
 */
export const invalidateStaleEntries = async (): Promise<void> => {
  await Promise.all([
    checkCacheEntries(jsCache),
    checkCacheEntries(cssCache),
  ]);
};

/**
 * Test/debug escape hatch — drops every cached entry unconditionally.
 */
export const clearBundleImportCache = (): void => {
  jsCache.clear();
  cssCache.clear();
};
