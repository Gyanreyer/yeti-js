
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { js } from "./js.ts";
import { updateConfig } from '../config.ts';
import { deriveOutputPathForSpecifier, getUsedExternalSpecifiers, resetUsedExternalSpecifiers } from './externalDependencies.ts';
import { textDecoder } from '../utils/textDecoder.ts';

describe("externalDependencies", () => {
  afterEach(() => {
    // Clean up: remove externalDependencies from config
    updateConfig({ js: { externalDependencies: undefined } });
    resetUsedExternalSpecifiers();
  });

  describe("deriveOutputPathForSpecifier", () => {
    test("derives path for a bare specifier", () => {
      assert.strictEqual(
        deriveOutputPathForSpecifier("lit", "/js/ext/"),
        "/js/ext/lit.js"
      );
    });

    test("derives path for a specifier with .js extension", () => {
      assert.strictEqual(
        deriveOutputPathForSpecifier("lit/decorators.js", "/js/ext/"),
        "/js/ext/lit/decorators.js"
      );
    });

    test("derives path for a specifier with .ts extension", () => {
      assert.strictEqual(
        deriveOutputPathForSpecifier("pkg/utils.ts", "/js/ext/"),
        "/js/ext/pkg/utils.js"
      );
    });

    test("derives path for a deeply nested specifier", () => {
      assert.strictEqual(
        deriveOutputPathForSpecifier("lit/directives/map.js", "/js/ext/"),
        "/js/ext/lit/directives/map.js"
      );
    });

    test("derives path for a specifier with no extension", () => {
      assert.strictEqual(
        deriveOutputPathForSpecifier("lit/decorators", "/js/ext/"),
        "/js/ext/lit/decorators.js"
      );
    });
  });

  describe("external dependency plugin integration", () => {
    test("imports matching an external dependency are externalized with rewritten paths", async () => {
      updateConfig({
        js: {
          externalDependencies: {
            "my-external-package": "/js/ext/my-external-package.js",
          },
        },
      });

      const result = js`${js.import("/test_data/js/file-with-external-import.js")}`;

      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);

      const bundleResult = await globalBundleGetter();
      const code = textDecoder.decode(bundleResult.code);

      // The output should contain an import statement pointing to the external path
      assert.match(code, /from\s+["']\/js\/ext\/my-external-package\.js["']/);

      // The output should NOT contain "externalFn" as a bundled function definition,
      // since the package is external. It should only appear in the import statement.
      assert.doesNotMatch(code, /function\s+externalFn/);

      // The local import (imported-file.ts) should still be bundled inline
      assert.match(code, /sayHello/);
    });

    test("used external specifiers are tracked", async () => {
      resetUsedExternalSpecifiers();

      updateConfig({
        js: {
          externalDependencies: {
            "my-external-package": "/js/ext/my-external-package.js",
          },
        },
      });

      const result = js`${js.import("/test_data/js/file-with-external-import.js")}`;
      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);
      await globalBundleGetter();

      const usedSpecifiers = getUsedExternalSpecifiers();
      assert(usedSpecifiers.has("my-external-package"));
      assert.strictEqual(usedSpecifiers.size, 1);
    });

    test("glob patterns match multiple specifiers and derive correct output paths", async () => {
      resetUsedExternalSpecifiers();

      updateConfig({
        js: {
          externalDependencies: {
            "{my-glob-package,my-glob-package/**}": "/js/ext/",
          },
        },
      });

      const result = js`${js.import("/test_data/js/file-with-subpath-import.js")}`;
      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);

      const bundleResult = await globalBundleGetter();
      const code = textDecoder.decode(bundleResult.code);

      // Both imports should be externalized with derived paths
      assert.match(code, /from\s+["']\/js\/ext\/my-glob-package\.js["']/);
      assert.match(code, /from\s+["']\/js\/ext\/my-glob-package\/utils\.js["']/);

      // Both specifiers should be tracked
      const usedSpecifiers = getUsedExternalSpecifiers();
      assert(usedSpecifiers.has("my-glob-package"));
      assert(usedSpecifiers.has("my-glob-package/utils"));
      assert.strictEqual(usedSpecifiers.size, 2);
    });

    test("non-matching imports are still bundled normally", async () => {
      updateConfig({
        js: {
          externalDependencies: {
            "some-other-package": "/js/ext/other.js",
          },
        },
      });

      // This file imports from imported-file.ts (local) - should still be bundled
      const result = js`${js.import("/test_data/js/file-with-import.js")}`;
      const bundle1Getter = result.bundles.get("global");
      assert(bundle1Getter);

      const bundleResult = await bundle1Getter();
      const code = textDecoder.decode(bundleResult.code);

      // The local dependency should be bundled inline as usual
      assert.match(code, /sayHello/);
      // No external import statements should appear
      assert.doesNotMatch(code, /from\s+["']\/js\/ext\//);
    });
  });
});