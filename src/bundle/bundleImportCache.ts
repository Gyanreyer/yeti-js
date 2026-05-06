import { build } from 'esbuild';
import { bundleAsync } from 'lightningcss';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompress, brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';

import { BundleError } from '../error.ts';
import { getConfig } from '../config.ts';
import {
  addUsedExternalSpecifiers,
  createExternalDependenciesEsbuildPlugin,
} from '../js/externalDependencies.ts';
import { safeWriteFile } from '../utils/safeWriteFile.ts';

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

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
  /**
   * Bare specifiers matched against the `js.externalDependencies` config during this bundle's
   * build. Recorded so that bundle-level cache hits (which skip esbuild) can still register
   * their external dependencies for the per-build `buildAndWriteExternalDependencies()` pass.
   * Always empty for CSS bundles (lightningcss has no equivalent plugin).
   */
  externalSpecifiers: Set<string>;
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

// Stats only used internally for tests to verify that cache hits are happening as expected
const stats = { jsHits: 0, jsMisses: 0, cssHits: 0, cssMisses: 0 };
export const getBundleCacheStats = () => stats;
export const resetBundleCacheStats = (): void => {
  stats.jsHits = 0;
  stats.jsMisses = 0;
  stats.cssHits = 0;
  stats.cssMisses = 0;
};

// Access tracking for cache eviction

// Cache keys touched during the current build pass. Used at save time to evict
// entries that are no longer referenced by any page (e.g. user removed an import),
// so the persisted cache file doesn't grow monotonically across sessions.
let accessedKeys = new Set<string>();
/**
 * Drop the set of cache keys touched during the previous build so the next build starts
 * fresh. Call from `eleventy.before` — at save time, any entry whose key isn't in this
 * set is considered no-longer-referenced and evicted.
 */
export const resetAccessTracking = (): void => {
  accessedKeys = new Set<string>();
};

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
 * Build a JS bundle for the given import path set. Internal — no cache lookup, no stats,
 * no global side effects. Always runs esbuild.
 */
const buildJSBundle = async (importPaths: ReadonlySet<string>): Promise<BundleImportResult> => {
  const sortedPaths = Array.from(importPaths).sort();
  const stdinContents = sortedPaths.map((p) => `import ${JSON.stringify(p)};`).join('\n');
  // esbuild will resolve imports relative to the project input dir
  const resolveDir = getConfig().inputDir;
  const { externalDependencies } = getConfig().js;

  const externalSpecifiers = new Set<string>();
  const plugins = externalDependencies
    ? [createExternalDependenciesEsbuildPlugin(externalDependencies, externalSpecifiers)]
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
    externalSpecifiers,
  };
};

/**
 * Build a CSS bundle for the given import path set. Internal — no cache lookup, no stats,
 * no global side effects. Always runs lightningcss.
 */
const buildCSSBundle = async (importPaths: ReadonlySet<string>): Promise<BundleImportResult> => {
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
    externalSpecifiers: new Set(),
  };
};

/**
 * Bundle a set of JS import paths together into a single deduplicated output.
 *
 * Uses esbuild's `stdin` option to feed a synthetic entry file that re-imports each
 * absolute path. esbuild then walks the merged module graph and produces a single output
 * file in which any module shared between entry points appears exactly once.
 *
 * Results are memoized by the (sorted) import path set, so two pages contributing the
 * same imports to the same bundle name share a single bundling pass. After every call
 * (hit or miss), the bundle's external specifiers are replayed into the global
 * `usedExternalSpecifiers` set so the per-build external-dependencies pass sees them
 * even when esbuild was skipped.
 */
export const getJSImportBundle = async (importPaths: ReadonlySet<string>): Promise<BundleImportResult> => {
  if (importPaths.size === 0) {
    throw new BundleError('getJSImportBundle called with empty import path set');
  }

  const key = hashImportPaths(importPaths);
  accessedKeys.add(key);

  const existing = jsCache.get(key);
  if (existing) {
    stats.jsHits++;
    const result = await existing.resultPromise;
    addUsedExternalSpecifiers(result.externalSpecifiers);
    return result;
  }
  stats.jsMisses++;

  const resultPromise = buildJSBundle(importPaths);
  jsCache.set(key, { resultPromise });
  const result = await resultPromise;
  addUsedExternalSpecifiers(result.externalSpecifiers);
  return result;
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
export const getCSSImportBundle = async (importPaths: ReadonlySet<string>): Promise<BundleImportResult> => {
  if (importPaths.size === 0) {
    throw new BundleError('getCSSImportBundle called with empty import path set');
  }

  const key = hashImportPaths(importPaths);
  accessedKeys.add(key);

  const existing = cssCache.get(key);
  if (existing) {
    stats.cssHits++;
    return existing.resultPromise;
  }
  stats.cssMisses++;

  const resultPromise = buildCSSBundle(importPaths);
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
 * Test/debug escape hatch — drops every cached entry unconditionally and resets stats.
 */
export const clearBundleImportCache = (): void => {
  jsCache.clear();
  cssCache.clear();
  resetBundleCacheStats();
  accessedKeys = new Set<string>();
};

// ── Persistence ────────────────────────────────────────────────────────

interface SerializedCacheEntry {
  /** Cache key (hash of sorted import paths) */
  k: string;
  /** Bundled output code, base64-encoded */
  c: string;
  /** Map of dependency file path → recorded mtimeMs */
  d: Record<string, number>;
  /** External dependency specifiers matched during the build (JS only) */
  e: string[];
}

interface SerializedBundleImportCache {
  cacheVersionKey: string;
  jsCache: SerializedCacheEntry[];
  cssCache: SerializedCacheEntry[];
}

/**
 * Derive a per-site cache filename from the inputDir so multiple sites sharing the same
 * `node_modules` (e.g. a monorepo) each get their own file. Suffix differs from the page
 * build cache so the two files coexist in `cacheDir`.
 */
const getBundleCacheFilename = (inputDir: string): string => {
  const hash = createHash('sha256').update(inputDir).digest('hex').slice(0, 16);
  return `${hash}.bundles.cache.br`;
};

const serializeCache = async (cache: Map<string, CacheEntry>): Promise<SerializedCacheEntry[]> => {
  const serialized: SerializedCacheEntry[] = [];
  for (const [key, entry] of cache) {
    let result: BundleImportResult;
    try {
      result = await entry.resultPromise;
    } catch {
      // Skip entries that failed to build — no use persisting them.
      continue;
    }
    serialized.push({
      k: key,
      c: Buffer.from(result.code).toString('base64'),
      d: Object.fromEntries(result.dependencyLastModifiedTimestamps),
      e: Array.from(result.externalSpecifiers),
    });
  }
  return serialized;
};

const deserializeCache = (
  cache: Map<string, CacheEntry>,
  entries: SerializedCacheEntry[],
): void => {
  for (const entry of entries) {
    const result: BundleImportResult = {
      code: new Uint8Array(Buffer.from(entry.c, 'base64')),
      dependencyFilePaths: new Set(Object.keys(entry.d)),
      dependencyLastModifiedTimestamps: new Map(Object.entries(entry.d)),
      externalSpecifiers: new Set(entry.e),
    };
    cache.set(entry.k, { resultPromise: Promise.resolve(result) });
  }
};

/**
 * Load a previously-saved bundle import cache from disk into the in-memory `jsCache` and
 * `cssCache` maps. Returns silently on any error (missing file, decompression failure,
 * malformed JSON, version mismatch) — a missing/invalid persisted cache simply means
 * the next build will be a clean miss, which is always safe.
 *
 * Call BEFORE `invalidateStaleEntries()` so the existing mtime-based invalidation logic
 * naturally drops any persisted entries whose deps have changed on disk.
 */
export const loadBundleImportCache = async (
  cacheDir: string,
  expectedVersionKey: string,
  inputDir: string,
): Promise<void> => {
  const filePath = join(cacheDir, getBundleCacheFilename(inputDir));

  let raw: Buffer;
  try {
    raw = await readFile(filePath);
  } catch {
    return;
  }

  let json: string;
  try {
    json = (await decompress(raw)).toString('utf-8');
  } catch {
    return;
  }

  let data: SerializedBundleImportCache;
  try {
    data = JSON.parse(json);
  } catch {
    return;
  }

  if (data.cacheVersionKey !== expectedVersionKey) {
    return;
  }

  deserializeCache(jsCache, data.jsCache);
  deserializeCache(cssCache, data.cssCache);
};

/**
 * Persist the in-memory cache to disk. Entries whose key was not accessed during the
 * current build pass (i.e. no longer referenced by any page) are evicted before saving,
 * preventing the cache file from growing monotonically across sessions.
 *
 * Failed/rejected entries are also skipped silently — they're not worth persisting.
 */
export const saveBundleImportCache = async (
  cacheDir: string,
  versionKey: string,
  inputDir: string,
): Promise<void> => {
  // Evict entries that weren't accessed this build.
  for (const key of jsCache.keys()) {
    if (!accessedKeys.has(key)) {
      jsCache.delete(key);
    }
  }
  for (const key of cssCache.keys()) {
    if (!accessedKeys.has(key)) {
      cssCache.delete(key);
    }
  }

  const [jsEntries, cssEntries] = await Promise.all([
    serializeCache(jsCache),
    serializeCache(cssCache),
  ]);

  const serialized: SerializedBundleImportCache = {
    cacheVersionKey: versionKey,
    jsCache: jsEntries,
    cssCache: cssEntries,
  };

  const compressed = await compress(Buffer.from(JSON.stringify(serialized)));
  const filePath = join(cacheDir, getBundleCacheFilename(inputDir));
  await safeWriteFile(filePath, compressed);
};
