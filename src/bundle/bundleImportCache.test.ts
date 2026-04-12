import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clearBundleImportCache,
  getCSSImportBundle,
  getJSImportBundle,
  invalidateStaleEntries,
} from './bundleImportCache.ts';
import { BundleError } from '../error.ts';

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
    test('returns the same Promise reference for repeated calls with the same import path set', () => {
      const paths = new Set([
        fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js')),
      ]);
      const promise1 = getJSImportBundle(paths);
      const promise2 = getJSImportBundle(paths);
      assert.strictEqual(promise1, promise2);
    });

    test('returns the same Promise for two different Set instances containing the same paths', () => {
      const path = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const promise1 = getJSImportBundle(new Set([path]));
      const promise2 = getJSImportBundle(new Set([path]));
      assert.strictEqual(promise1, promise2);
    });

    test('cache key is order-independent (sorted before hashing)', () => {
      const a = fileURLToPath(import.meta.resolve('../../test_data/js/external-script.js'));
      const b = fileURLToPath(import.meta.resolve('../../test_data/js/external-script-2.js'));
      const promise1 = getJSImportBundle(new Set([a, b]));
      const promise2 = getJSImportBundle(new Set([b, a]));
      assert.strictEqual(promise1, promise2);
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

    test('throws on empty import path set', () => {
      assert.throws(() => getJSImportBundle(new Set()), BundleError);
    });
  });

  describe('getCSSImportBundle', () => {
    test('returns the same Promise reference for repeated calls with the same import path set', () => {
      const paths = new Set([
        fileURLToPath(import.meta.resolve('../../test_data/css/external-styles.css')),
      ]);
      const promise1 = getCSSImportBundle(paths);
      const promise2 = getCSSImportBundle(paths);
      assert.strictEqual(promise1, promise2);
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

    test('throws on empty import path set', () => {
      assert.throws(() => getCSSImportBundle(new Set()), BundleError);
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
