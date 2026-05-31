import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resetAccessTracking,
  clearBundleImportCache,
  getBundleCacheStats,
  getCSSImportBundle,
  getJSImportBundle,
  invalidateStaleEntries,
  loadBundleImportCache,
  resetBundleCacheStats,
  saveBundleImportCache,
  deriveBundleOutputCacheKey,
  getCachedBundleOutput,
  setCachedBundleOutput,
} from './bundleImportCache.ts';
import { BundleError } from '../error.ts';
import { getConfig, updateConfig } from '../config.ts';
import {
  getUsedExternalSpecifiers,
  resetUsedExternalSpecifiers,
} from '../js/externalDependencies.ts';

const tempDirsToCleanup: string[] = [];
const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'yeti-bundle-cache-test-'));
  tempDirsToCleanup.push(dir);
  return dir;
};

describe('bundleImportCache', () => {
  afterEach(async () => {
    clearBundleImportCache();
    while (tempDirsToCleanup.length > 0) {
      const dir = tempDirsToCleanup.pop()!;
      await rm(dir, { recursive: true, force: true }).catch(() => { });
    }
  });

  describe('getJSImportBundle', () => {
    test('returns the same result reference for repeated calls with the same import path set', async () => {
      const paths = new Set([
        fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js')),
      ]);
      const [r1, r2] = await Promise.all([getJSImportBundle(paths), getJSImportBundle(paths)]);
      assert.strictEqual(r1, r2);
    });

    test('returns the same result for two different Set instances containing the same paths', async () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const [r1, r2] = await Promise.all([
        getJSImportBundle(new Set([path])),
        getJSImportBundle(new Set([path])),
      ]);
      assert.strictEqual(r1, r2);
    });

    test('cache key is order-independent (sorted before hashing)', async () => {
      const a = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const b = fileURLToPath(import.meta.resolve('../../test_data/js/external-script-2.js'));
      const [r1, r2] = await Promise.all([
        getJSImportBundle(new Set([a, b])),
        getJSImportBundle(new Set([b, a])),
      ]);
      assert.strictEqual(r1, r2);
    });

    test('different import path sets produce different bundle results', async () => {
      const a = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const b = fileURLToPath(import.meta.resolve('../../test_data/js/external-script-2.js'));
      const r1 = await getJSImportBundle(new Set([a]));
      const r2 = await getJSImportBundle(new Set([b]));
      assert.notStrictEqual(r1, r2);
      assert.notStrictEqual(r1.code, r2.code);
    });

    test('result includes the imported file as a dependency', async () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const result = await getJSImportBundle(new Set([path]));
      assert(result.dependencyFilePaths.has(path));
    });

    test('synthetic entry file is not exposed as a dependency', async () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const result = await getJSImportBundle(new Set([path]));
      for (const dep of result.dependencyFilePaths) {
        assert(
          !dep.includes('__yeti_bundle_entry__'),
          `dependency set should not contain the synthetic entry filename, but got: ${dep}`,
        );
      }
    });

    test('throws BundleError on missing import paths', async () => {
      await assert.rejects(
        () => getJSImportBundle(new Set(['/nonexistent/file.js'])),
        (err: unknown): err is BundleError => err instanceof BundleError,
      );
    });

    test('throws on empty import path set', async () => {
      await assert.rejects(getJSImportBundle(new Set()), BundleError);
    });
  });

  describe('getCSSImportBundle', () => {
    test('returns the same result reference for repeated calls with the same import path set', async () => {
      const paths = new Set([
        fileURLToPath(import.meta.resolve('../../test_data/css/external-styles.css')),
      ]);
      const [r1, r2] = await Promise.all([getCSSImportBundle(paths), getCSSImportBundle(paths)]);
      assert.strictEqual(r1, r2);
    });

    test('result includes the imported file as a dependency', async () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/css/external-styles.css'));
      const result = await getCSSImportBundle(new Set([path]));
      assert(result.dependencyFilePaths.has(path));
    });

    test('throws BundleError on missing import paths', async () => {
      await assert.rejects(
        () => getCSSImportBundle(new Set(['/nonexistent/file.css'])),
        (err: unknown): err is BundleError => err instanceof BundleError,
      );
    });

    test('throws on empty import path set', async () => {
      await assert.rejects(getCSSImportBundle(new Set()), BundleError);
    });
  });

  describe('clearBundleImportCache', () => {
    test('drops cached entries so subsequent calls produce a fresh Promise', async () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const result1 = await getJSImportBundle(new Set([path]));

      clearBundleImportCache();

      const result2 = await getJSImportBundle(new Set([path]));
      // Different result objects (different esbuild invocation)
      assert.notStrictEqual(result1, result2);
      // But the byte content of the code should match (same input → same output)
      assert.deepStrictEqual(result1.code, result2.code);
    });
  });

  describe('invalidateStaleEntries', () => {
    test('keeps entries whose tracked dependency mtimes have not changed', async () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const result1 = await getJSImportBundle(new Set([path]));

      await invalidateStaleEntries();

      // Should still hit the cache.
      const result2 = await getJSImportBundle(new Set([path]));
      assert.strictEqual(result1, result2);
    });

    test('drops entries whose tracked dependency mtimes have changed on disk', async () => {
      const tempDir = await makeTempDir();
      const filePath = join(tempDir, 'shared.js');
      // Use a top-level side-effect call so esbuild's treeshaking won't drop it.
      await writeFile(filePath, 'console.log("shared-value-v1");\n');

      const result1 = await getJSImportBundle(new Set([filePath]));
      assert(
        new TextDecoder().decode(result1.code).includes('shared-value-v1'),
        `Expected v1 marker in result1 code. Got: ${new TextDecoder().decode(result1.code)}`,
      );

      // Bump the file's mtime forward to simulate a content change. Use a far-future
      // timestamp so the change is reliably detected even on filesystems with low mtime
      // resolution.
      const future = new Date(Date.now() + 1000 * 60 * 60);
      await writeFile(filePath, 'console.log("shared-value-v2");\n');
      await utimes(filePath, future, future);

      await invalidateStaleEntries();

      const result2 = await getJSImportBundle(new Set([filePath]));
      assert.notStrictEqual(result1, result2);
      assert(
        new TextDecoder().decode(result2.code).includes('shared-value-v2'),
        `Expected v2 marker in result2 code. Got: ${new TextDecoder().decode(result2.code)}`,
      );
    });

    test('drops entries whose tracked dependencies no longer exist on disk', async () => {
      const tempDir = await makeTempDir();
      const filePath = join(tempDir, 'soon-to-be-deleted.js');
      await writeFile(filePath, 'console.log("delete-me");\n');

      const result1 = await getJSImportBundle(new Set([filePath]));
      assert(result1);

      await rm(filePath);

      await invalidateStaleEntries();

      // The entry should have been dropped — calling again with a now-missing path should
      // produce a fresh attempt that fails.
      await assert.rejects(
        () => getJSImportBundle(new Set([filePath])),
        (err: unknown): err is BundleError => err instanceof BundleError,
      );
    });

    test('drops entries whose previous build threw an error', async () => {
      // First call produces a rejected promise that gets cached.
      const failedPromise = getJSImportBundle(new Set(['/nonexistent/file.js']));
      await assert.rejects(failedPromise);

      // Invalidation should drop the failed entry.
      await invalidateStaleEntries();

      // Subsequent call should be a fresh attempt (also failing here, but it's a NEW
      // promise instance, not the cached rejection).
      const newPromise = getJSImportBundle(new Set(['/nonexistent/file.js']));
      assert.notStrictEqual(newPromise, failedPromise);
      await assert.rejects(newPromise);
    });

    test('invalidates JS and CSS caches independently and correctly', async () => {
      const tempDir = await makeTempDir();
      const jsPath = join(tempDir, 'a.js');
      const cssPath = join(tempDir, 'a.css');
      await writeFile(jsPath, 'console.log("js-v1");\n');
      await writeFile(cssPath, '.marker-v1 { color: red; }\n');

      const jsResult1 = await getJSImportBundle(new Set([jsPath]));
      const cssResult1 = await getCSSImportBundle(new Set([cssPath]));

      // Touch only the css file
      const future = new Date(Date.now() + 1000 * 60 * 60);
      await writeFile(cssPath, '.marker-v2 { color: blue; }\n');
      await utimes(cssPath, future, future);

      await invalidateStaleEntries();

      // JS cache entry should still be valid (the underlying file is unchanged)
      const jsResult2 = await getJSImportBundle(new Set([jsPath]));
      assert.strictEqual(jsResult1, jsResult2);

      // CSS cache entry should be invalidated and rebuilt
      const cssResult2 = await getCSSImportBundle(new Set([cssPath]));
      assert.notStrictEqual(cssResult1, cssResult2);
      assert(new TextDecoder().decode(cssResult2.code).includes('marker-v2'));
    });
  });
});

describe('bundleImportCache — persistence + replay', () => {
  afterEach(async () => {
    clearBundleImportCache();
    resetUsedExternalSpecifiers();
    while (tempDirsToCleanup.length > 0) {
      const dir = tempDirsToCleanup.pop()!;
      await rm(dir, { recursive: true, force: true }).catch(() => { });
    }
  });

  test('round-trip: save → clear → load yields a cache hit on the same import set', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'yeti-bundle-cache-persist-'));
    tempDirsToCleanup.push(cacheDir);
    const versionKey = 'test-version-key';
    const inputDir = getConfig().inputDir;
    const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));

    resetAccessTracking();
    const r1 = await getJSImportBundle(new Set([path]));
    await saveBundleImportCache(cacheDir, versionKey, inputDir);

    clearBundleImportCache();
    resetAccessTracking();
    await loadBundleImportCache(cacheDir, versionKey, inputDir);
    resetBundleCacheStats();

    const r2 = await getJSImportBundle(new Set([path]));
    const stats = getBundleCacheStats();
    assert.equal(stats.jsHits, 1, 'expected exactly one cache hit after load');
    assert.equal(stats.jsMisses, 0, 'expected zero cache misses after load');
    assert.deepStrictEqual(r2.code, r1.code);
    // After load, the result is a fresh object reconstructed from the serialized bytes.
    assert.notStrictEqual(r2, r1);
  });

  test('load returns silently when version key does not match', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'yeti-bundle-cache-version-'));
    tempDirsToCleanup.push(cacheDir);
    const inputDir = getConfig().inputDir;
    const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));

    resetAccessTracking();
    await getJSImportBundle(new Set([path]));
    await saveBundleImportCache(cacheDir, 'old-version', inputDir);

    clearBundleImportCache();
    resetAccessTracking();
    await loadBundleImportCache(cacheDir, 'new-version', inputDir);
    resetBundleCacheStats();

    await getJSImportBundle(new Set([path]));
    const stats = getBundleCacheStats();
    assert.equal(stats.jsMisses, 1, 'mismatched version should leave cache empty → fresh miss');
    assert.equal(stats.jsHits, 0);
  });

  test('access-tracking eviction: entries not accessed during a build are dropped at save time', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'yeti-bundle-cache-evict-'));
    tempDirsToCleanup.push(cacheDir);
    const versionKey = 'evict-test';
    const inputDir = getConfig().inputDir;
    const a = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
    const b = fileURLToPath(import.meta.resolve('../../test_data/js/external-script-2.js'));

    // Build pass 1: populate cache with both A and B
    resetAccessTracking();
    await getJSImportBundle(new Set([a]));
    await getJSImportBundle(new Set([b]));
    await saveBundleImportCache(cacheDir, versionKey, inputDir);

    // Simulate a fresh process that only references A this build.
    clearBundleImportCache();
    resetAccessTracking();
    await loadBundleImportCache(cacheDir, versionKey, inputDir);
    await getJSImportBundle(new Set([a])); // accesses A only
    await saveBundleImportCache(cacheDir, versionKey, inputDir);

    // Now load fresh again — B should have been evicted from disk.
    clearBundleImportCache();
    resetAccessTracking();
    await loadBundleImportCache(cacheDir, versionKey, inputDir);
    resetBundleCacheStats();

    await getJSImportBundle(new Set([a]));
    await getJSImportBundle(new Set([b]));
    const stats = getBundleCacheStats();
    assert.equal(stats.jsHits, 1, 'A should hit (still cached)');
    assert.equal(stats.jsMisses, 1, 'B should miss (evicted)');
  });

  test('external specifiers are replayed into the global set on cache hit', async () => {
    const tempDir = await makeTempDir();
    // A page-level JS file that imports a bare specifier configured as external.
    const filePath = join(tempDir, 'uses-external.js');
    await writeFile(filePath, 'import "test-external-mod";\nconsole.log("hi");\n');

    const originalDeps = getConfig().js.externalDependencies;
    updateConfig({
      js: { externalDependencies: { 'test-external-mod': '/js/ext/test-mod.js' } },
    });

    try {
      // First call: cache miss; esbuild plugin records the specifier into the local out set.
      resetAccessTracking();
      resetUsedExternalSpecifiers();
      await getJSImportBundle(new Set([filePath]));
      assert.ok(
        getUsedExternalSpecifiers().has('test-external-mod'),
        'cache miss: specifier should be in the global set',
      );

      // Reset the global set, then call again — should be a cache hit, but the specifier
      // must still end up in the global set (replayed from BundleImportResult.externalSpecifiers).
      resetUsedExternalSpecifiers();
      resetBundleCacheStats();
      await getJSImportBundle(new Set([filePath]));
      assert.equal(getBundleCacheStats().jsHits, 1, 'expected cache hit on second call');
      assert.ok(
        getUsedExternalSpecifiers().has('test-external-mod'),
        'cache hit: specifier should still be replayed into the global set',
      );
    } finally {
      updateConfig({
        js: { externalDependencies: originalDeps as Record<string, string> | undefined },
      });
    }
  });

  test('persistence preserves replay on cache hit across save/load cycle', async () => {
    const tempDir = await makeTempDir();
    const cacheDir = await mkdtemp(join(tmpdir(), 'yeti-bundle-cache-replay-'));
    tempDirsToCleanup.push(cacheDir);
    const filePath = join(tempDir, 'uses-external.js');
    await writeFile(filePath, 'import "persisted-external-mod";\nconsole.log("hi");\n');

    const originalDeps = getConfig().js.externalDependencies;
    updateConfig({
      js: { externalDependencies: { 'persisted-external-mod': '/js/ext/persisted.js' } },
    });

    try {
      const versionKey = 'replay-test';
      const inputDir = getConfig().inputDir;

      resetAccessTracking();
      resetUsedExternalSpecifiers();
      await getJSImportBundle(new Set([filePath]));
      await saveBundleImportCache(cacheDir, versionKey, inputDir);

      // Simulate fresh process: in-memory cache cleared, on-disk cache survives.
      clearBundleImportCache();
      resetUsedExternalSpecifiers();
      resetAccessTracking();
      await loadBundleImportCache(cacheDir, versionKey, inputDir);
      resetBundleCacheStats();

      await getJSImportBundle(new Set([filePath]));
      assert.equal(getBundleCacheStats().jsHits, 1);
      assert.ok(
        getUsedExternalSpecifiers().has('persisted-external-mod'),
        'replay should work even after save/load (specifiers persisted with the entry)',
      );
    } finally {
      updateConfig({
        js: { externalDependencies: originalDeps as Record<string, string> | undefined },
      });
    }
  });
});

describe('bundleImportCache — bundle output cache', () => {
  afterEach(() => {
    clearBundleImportCache();
  });

  test('miss returns null and increments miss counter', () => {
    const key = deriveBundleOutputCacheKey(new Uint8Array([1, 2, 3]), { minify: true }, '/css/a.css');
    const result = getCachedBundleOutput(key);
    assert.equal(result, null);
    assert.equal(getBundleCacheStats().bundleOutputMisses, 1);
    assert.equal(getBundleCacheStats().bundleOutputHits, 0);
  });

  test('hit returns the stored entry and increments hit counter', () => {
    const key = deriveBundleOutputCacheKey(new Uint8Array([1, 2, 3]), { minify: true }, '/css/a.css');
    const entry = { code: new Uint8Array([10, 20, 30]), contentHash: 'abcd1234' };
    setCachedBundleOutput(key, entry);

    resetBundleCacheStats();
    const result = getCachedBundleOutput(key);
    assert.strictEqual(result, entry);
    assert.equal(getBundleCacheStats().bundleOutputHits, 1);
    assert.equal(getBundleCacheStats().bundleOutputMisses, 0);
  });

  test('identical inputs produce identical cache keys', () => {
    const code = new Uint8Array([1, 2, 3, 4, 5]);
    const config = { minify: true, target: 'es2022' };
    const k1 = deriveBundleOutputCacheKey(code, config, '/css/a.css');
    const k2 = deriveBundleOutputCacheKey(new Uint8Array([1, 2, 3, 4, 5]), { minify: true, target: 'es2022' }, '/css/a.css');
    assert.equal(k1, k2);
  });

  test('different combinedCode produces different keys', () => {
    const config = { minify: true };
    const k1 = deriveBundleOutputCacheKey(new Uint8Array([1, 2, 3]), config, '/css/a.css');
    const k2 = deriveBundleOutputCacheKey(new Uint8Array([1, 2, 4]), config, '/css/a.css');
    assert.notEqual(k1, k2);
  });

  test('different transformConfig produces different keys', () => {
    const code = new Uint8Array([1, 2, 3]);
    const k1 = deriveBundleOutputCacheKey(code, { minify: true }, '/css/a.css');
    const k2 = deriveBundleOutputCacheKey(code, { minify: false }, '/css/a.css');
    assert.notEqual(k1, k2);
  });

  test('different outputFilePath produces different keys', () => {
    // outputFilePath is fed to the CSS/HTML transform as `filename`, so it's part of the key.
    const code = new Uint8Array([1, 2, 3]);
    const config = { minify: true };
    const k1 = deriveBundleOutputCacheKey(code, config, '/css/_pages/pageA.css');
    const k2 = deriveBundleOutputCacheKey(code, config, '/css/_pages/pageB.css');
    assert.notEqual(k1, k2);
  });

  test('cache key is stable across object key insertion order', () => {
    const code = new Uint8Array([1, 2, 3]);
    const k1 = deriveBundleOutputCacheKey(code, { minify: true, target: 'es2022' }, '/css/a.css');
    const k2 = deriveBundleOutputCacheKey(code, { target: 'es2022', minify: true }, '/css/a.css');
    assert.equal(k1, k2);
  });

  test('cache key reflects function bodies in transformConfig', () => {
    const code = new Uint8Array([1, 2, 3]);
    const k1 = deriveBundleOutputCacheKey(code, { processNodeTree: (n: unknown) => n }, '/html/a.html');
    const k2 = deriveBundleOutputCacheKey(code, { processNodeTree: (n: unknown) => ({ ...(n as object) }) }, '/html/a.html');
    assert.notEqual(k1, k2, 'different function bodies should produce different keys');

    const k3 = deriveBundleOutputCacheKey(code, { processNodeTree: (n: unknown) => n }, '/html/a.html');
    const k4 = deriveBundleOutputCacheKey(code, { processNodeTree: (n: unknown) => n }, '/html/a.html');
    assert.equal(k3, k4, "identical function bodies should produce the same key even if they aren't referentially equal");
  });

  test('cache key handles nested objects and arrays stably', () => {
    const code = new Uint8Array([1, 2, 3]);
    const k1 = deriveBundleOutputCacheKey(code, { targets: { chrome: 95, firefox: 90 }, plugins: ['a', 'b'] }, '/css/a.css');
    const k2 = deriveBundleOutputCacheKey(code, { plugins: ['a', 'b'], targets: { firefox: 90, chrome: 95 } }, '/css/a.css');
    assert.equal(k1, k2);
  });

  test('clearBundleImportCache drops bundle output entries', () => {
    const key = deriveBundleOutputCacheKey(new Uint8Array([1]), {}, '/css/a.css');
    setCachedBundleOutput(key, { code: new Uint8Array([2]), contentHash: 'xxxxxxxx' });
    clearBundleImportCache();
    assert.equal(getCachedBundleOutput(key), null);
  });

  test('persistence round-trip: save → clear → load yields a hit', async () => {
    const cacheDir = await makeTempDir();
    const versionKey = 'output-cache-test-key';
    const inputDir = getConfig().inputDir;

    const code = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
    const config = { minify: true, target: 'es2022' };
    const key = deriveBundleOutputCacheKey(code, config, '/css/a.css');
    const stored = { code: new Uint8Array([1, 2, 3, 4, 5]), contentHash: 'deadbeef' };
    setCachedBundleOutput(key, stored);
    // Mark accessed so it survives eviction at save time.
    getCachedBundleOutput(key);

    await saveBundleImportCache(cacheDir, versionKey, inputDir);
    clearBundleImportCache();

    assert.equal(getCachedBundleOutput(key), null);
    resetBundleCacheStats();

    await loadBundleImportCache(cacheDir, versionKey, inputDir);

    const loaded = getCachedBundleOutput(key);
    assert.ok(loaded, 'expected hit after load');
    assert.equal(loaded.contentHash, 'deadbeef');
    assert.deepEqual(Array.from(loaded.code), [1, 2, 3, 4, 5]);
    assert.equal(getBundleCacheStats().bundleOutputHits, 1);
  });

  test('persistence: unaccessed bundle output entries are evicted at save', async () => {
    const cacheDir = await makeTempDir();
    const versionKey = 'output-cache-eviction-key';
    const inputDir = getConfig().inputDir;

    const accessedKey = deriveBundleOutputCacheKey(new Uint8Array([1]), { a: 1 }, '/css/a.css');
    const unaccessedKey = deriveBundleOutputCacheKey(new Uint8Array([2]), { a: 2 }, '/css/b.css');

    setCachedBundleOutput(accessedKey, { code: new Uint8Array([10]), contentHash: 'aaaaaaaa' });
    setCachedBundleOutput(unaccessedKey, { code: new Uint8Array([20]), contentHash: 'bbbbbbbb' });

    // Only mark `accessedKey` as accessed.
    resetAccessTracking();
    getCachedBundleOutput(accessedKey);

    await saveBundleImportCache(cacheDir, versionKey, inputDir);
    clearBundleImportCache();
    await loadBundleImportCache(cacheDir, versionKey, inputDir);

    assert.ok(getCachedBundleOutput(accessedKey), 'accessed entry survives');
    resetBundleCacheStats();
    assert.equal(getCachedBundleOutput(unaccessedKey), null, 'unaccessed entry evicted');
  });

});
