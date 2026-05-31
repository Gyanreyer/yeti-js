import { access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliCompress, brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import type { PageBundleAggregate, PageScopedBundles } from './processPageComponent.ts';
import type { PageContext } from './types.ts';
import { safeWriteFile } from '../utils/safeWriteFile.ts';

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

/**
 * Bump this when the cache format or serialization logic changes in a way
 * that makes older cache files incompatible, even if no dependency versions changed.
 */
const CACHE_VERSION = 4;

/**
 * Derive a per-site cache filename from the inputDir so that multiple sites
 * sharing the same node_modules (e.g. a monorepo) each get their own cache file.
 */
const getCacheFilename = (inputDir: string): string => {
  const hash = createHash('sha256').update(inputDir).digest('hex').slice(0, 16);
  return `${hash}.cache.br`;
};

// ── Serialized shapes ──────────────────────────────────────────────────

interface SerializedHashPosition {
  /** Character offset in the post-substitution HTML where the 8-char hash begins */
  position: number;
  /** The placeholder token that was replaced at this position */
  placeholder: string;
}

interface SerializedPageCacheEntry {
  /**
   * One entry per rendered output of this template. A single template `inputPath` can produce
   * many outputs (pagination), each its own file with its own substituted-hash positions.
   */
  outputs: {
    outputPath: string;
    /** Exact character positions of each substituted bundle hash in this output's HTML */
    hashPositions: SerializedHashPosition[];
  }[];
  externalBundles: {
    css: Record<string, { importPaths: string[]; rawContents: string[] }>;
    js: Record<string, { importPaths: string[]; rawContents: string[] }>;
    htmlImportPaths: Record<string, string[]>;
  };
  /**
   * Page-scoped (`@page`) bundle contributions for this page. Persisted so that incremental
   * builds — where Eleventy only re-runs `compile()` for pages whose deps changed — still have
   * complete page-bundle data for the merge step in `eleventy.after`.
   */
  pageBundles: {
    inputPath: string;
    css: { importPaths: string[]; rawContents: string[] } | null;
    js: { importPaths: string[]; rawContents: string[] } | null;
    html: string[] | null;
  };
  /**
   * The most recent `PageContext` observed for this page. Needed in
   * `eleventy.after` because `derivePageBundleFilePath(page)` may key off any field on it.
   * Carrying it through the cache lets unchanged-on-this-build pages still get their
   * page-bundle written. We carry only the `page` subobject (not full `EleventyPageData`)
   * because surrounding fields like `pagination` contain circular refs that won't survive
   * JSON serialization.
   */
  page: PageContext;
}

interface SerializedBuildCache {
  cacheVersionKey: string;
  lastBundleContentHashes: Record<string, string>;
  pages: Record<string, SerializedPageCacheEntry>;
}

// ── In-memory shapes returned to plugin.ts ─────────────────────────────

export interface HashPosition {
  /** Character offset in the post-substitution HTML where the 8-char hash begins */
  position: number;
  /** The placeholder token that was replaced at this position */
  placeholder: string;
}

/** One rendered output of a template: its file path and the substituted-hash positions in it. */
export interface PageCacheOutput {
  outputPath: string;
  /** Exact character positions of each substituted bundle hash in this output's HTML */
  hashPositions: HashPosition[];
}

export interface PageCacheEntry {
  /**
   * One entry per rendered output of this template. A single template `inputPath` can produce
   * many outputs (pagination); each output file tracks its own hash positions so incremental
   * builds can splice stale hashes into every variant, not just one.
   */
  outputs: PageCacheOutput[];
  externalBundles: {
    css: Map<string, PageBundleAggregate>;
    js: Map<string, PageBundleAggregate>;
    htmlImportPaths: Map<string, Set<string>>;
  };
  /** Page-scoped (`@page`) bundle aggregates for this page. */
  pageBundles: PageScopedBundles;
  /** The most recent `PageContext` observed for this page. */
  page: PageContext;
}

export interface BuildCacheData {
  cacheVersionKey: string;
  lastBundleContentHashes: Map<string, string>;
  pages: Map<string, PageCacheEntry>;
}

// ── Version key computation ────────────────────────────────────────────

const getPackageVersion = async (packageJsonPath: string): Promise<string> => {
  const raw = await readFile(new URL(packageJsonPath), 'utf-8');
  return JSON.parse(raw).version;
};

/**
 * Compute a cache version key from yeti-js + esbuild + lightningcss + object-hash
 * versions plus the manual CACHE_VERSION constant. Any change in these values
 * invalidates the entire cache. object-hash is included because its serialization
 * is part of the bundle output cache key — a library upgrade that changes the
 * serialization shape would otherwise produce silent key collisions across versions.
 */
export const computeCacheVersionKey = async (): Promise<string> => {
  const yetiVersion = await getPackageVersion(import.meta.resolve('../../package.json'));
  const esbuildVersion = (await import('esbuild')).version;
  const lightningcssVersion = await getLightningcssVersion();
  const objectHashVersion = await getPackageVersion(import.meta.resolve('object-hash/package.json'));

  const hash = createHash('sha256');
  hash.update(`yeti:${yetiVersion}`);
  hash.update(`esbuild:${esbuildVersion}`);
  hash.update(`lightningcss:${lightningcssVersion}`);
  hash.update(`object-hash:${objectHashVersion}`);
  hash.update(`format:${CACHE_VERSION}`);
  return hash.digest('hex');
};


/**
 * esbuild exports its version directly but lightningcss doesn't so we need to
 * find its package.json file and read the version from there.
 */
const getLightningcssVersion = async (): Promise<string> => {
  // Resolve the lightningcss module's entrypoint and walk up to find package.json.
  const entryPath = fileURLToPath(import.meta.resolve('lightningcss'));
  let dir = dirname(entryPath);
  while (true) {
    try {
      const pkgPath = join(dir, 'package.json');
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      if (pkg.name === 'lightningcss') {
        return pkg.version;
      }
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find lightningcss package.json');
    }
    dir = parent;
  }
};

// -- Serialization helpers --

const serializePageBundleAggregate = (
  agg: PageBundleAggregate,
): { importPaths: string[]; rawContents: string[] } => ({
  importPaths: Array.from(agg.importPaths),
  rawContents: agg.rawContents.map((buf) => Buffer.from(buf).toString('base64')),
});

const deserializePageBundleAggregate = (
  json: { importPaths: string[]; rawContents: string[] },
): PageBundleAggregate => ({
  importPaths: new Set(json.importPaths),
  rawContents: json.rawContents.map((b64) => new Uint8Array(Buffer.from(b64, 'base64'))),
});

export const serializePageEntry = (
  outputs: PageCacheOutput[],
  externalBundles: {
    css: Map<string, PageBundleAggregate>;
    js: Map<string, PageBundleAggregate>;
    htmlImportPaths: Map<string, Set<string>>;
  },
  pageBundles: PageScopedBundles,
  page: PageContext,
): SerializedPageCacheEntry => {
  const cssBundles: SerializedPageCacheEntry["externalBundles"]["css"] = {};
  for (const [bundleName, agg] of externalBundles.css) {
    cssBundles[bundleName] = serializePageBundleAggregate(agg);
  }
  const jsBundles: SerializedPageCacheEntry["externalBundles"]["js"] = {};
  for (const [bundleName, agg] of externalBundles.js) {
    jsBundles[bundleName] = serializePageBundleAggregate(agg);
  }
  const htmlImportPaths: SerializedPageCacheEntry["externalBundles"]["htmlImportPaths"] = {};
  for (const [importPath, paths] of externalBundles.htmlImportPaths) {
    htmlImportPaths[importPath] = Array.from(paths);
  }

  return ({
    outputs,
    externalBundles: {
      css: cssBundles,
      js: jsBundles,
      htmlImportPaths: htmlImportPaths,
    },
    pageBundles: {
      inputPath: pageBundles.inputPath,
      css: pageBundles.css ? serializePageBundleAggregate(pageBundles.css) : null,
      js: pageBundles.js ? serializePageBundleAggregate(pageBundles.js) : null,
      html: pageBundles.html ? Array.from(pageBundles.html) : null,
    },
    page,
  });
};

const deserializePageEntry = (json: SerializedPageCacheEntry): PageCacheEntry => ({
  outputs: json.outputs.map((o) => ({ outputPath: o.outputPath, hashPositions: o.hashPositions })),
  externalBundles: {
    css: new Map(
      Object.entries(json.externalBundles.css).map(([k, v]) => [k, deserializePageBundleAggregate(v)]),
    ),
    js: new Map(
      Object.entries(json.externalBundles.js).map(([k, v]) => [k, deserializePageBundleAggregate(v)]),
    ),
    htmlImportPaths: new Map(
      Object.entries(json.externalBundles.htmlImportPaths).map(([k, v]) => [k, new Set(v)]),
    ),
  },
  pageBundles: {
    inputPath: json.pageBundles.inputPath,
    css: json.pageBundles.css ? deserializePageBundleAggregate(json.pageBundles.css) : null,
    js: json.pageBundles.js ? deserializePageBundleAggregate(json.pageBundles.js) : null,
    html: json.pageBundles.html ? new Set(json.pageBundles.html) : null,
  },
  page: json.page,
});

// -- Load / Save --

/**
 * Load the build cache from disk. Returns null if the cache file is missing,
 * corrupt, or has a version key mismatch.
 */
export const loadBuildCache = async (
  cacheDir: string,
  expectedVersionKey: string,
  inputDir: string,
): Promise<BuildCacheData | null> => {
  const filePath = join(cacheDir, getCacheFilename(inputDir));

  let raw: Buffer;
  try {
    raw = await readFile(filePath);
  } catch {
    return null;
  }

  let json: string;
  try {
    json = (await decompress(raw)).toString('utf-8');
  } catch {
    return null;
  }

  let data: SerializedBuildCache;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }

  if (data.cacheVersionKey !== expectedVersionKey) {
    return null;
  }

  const pages = new Map<string, PageCacheEntry>();
  for (const [inputPath, entry] of Object.entries(data.pages)) {
    pages.set(inputPath, deserializePageEntry(entry));
  }

  return {
    cacheVersionKey: data.cacheVersionKey,
    lastBundleContentHashes: new Map(Object.entries(data.lastBundleContentHashes)),
    pages,
  };
};

/**
 * Persist the build cache to disk. Creates the cache directory if needed.
 */
export const saveBuildCache = async (
  cacheDir: string,
  inputDir: string,
  data: BuildCacheData,
): Promise<void> => {
  const compressedFileData = await compress(
    Buffer.from(
      JSON.stringify(
        {
          cacheVersionKey: data.cacheVersionKey,
          lastBundleContentHashes: Object.fromEntries(data.lastBundleContentHashes),
          pages: Object.fromEntries(
            Array.from(data.pages, ([inputPath, entry]) => [
              inputPath,
              serializePageEntry(
                entry.outputs,
                entry.externalBundles,
                entry.pageBundles,
                entry.page,
              ),
            ]),
          ),
        } satisfies SerializedBuildCache
      )
    )
  );

  const filePath = join(cacheDir, getCacheFilename(inputDir));
  await safeWriteFile(filePath, compressedFileData);
};

// -- Cache eviction helpers --

/**
 * Remove page entries whose inputPath no longer exists on disk.
 */
export const evictDeletedPages = async (
  pages: Map<string, PageCacheEntry>,
): Promise<void> => {
  const promises = new Array<Promise<void>>(pages.size);
  let i = 0;
  for (const inputPath of pages.keys()) {
    promises[i++] = access(inputPath).catch(() => {
      pages.delete(inputPath);
    });
  }
  await Promise.all(promises);
};
