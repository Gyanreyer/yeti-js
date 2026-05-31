import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { isJSTemplateResult, js } from "./js.ts";
import { css } from '../css/css.ts';
import { html } from '../html/html.ts';
import { textEncoder } from '../utils/textEncoder.ts';
import { textDecoder } from '../utils/textDecoder.ts';
import { BundleError } from '../error.ts';
import {
  BUNDLE_TYPE,
  type BundleSrcObject,
  type BundleInlineObject,
  type BundleContribution,
} from '../bundle/bundle.ts';
import {
  clearBundleImportCache,
  getJSImportBundle,
} from '../bundle/bundleImportCache.ts';

describe("js", () => {
  afterEach(() => {
    // The process-wide bundle import cache is shared across tests; clear it so each test
    // sees a fresh state and any error-path tests don't trip over a previously cached result.
    clearBundleImportCache();
  });

  describe("js templates", () => {
    test("A simple string-only js template produces a contribution with raw content under the page-scoped @page key by default", () => {
      const result = js`
      console.log("Hello, world!");
    `;
      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["@page"]);

      const pageContribution = result.bundles.get("@page") as BundleContribution;
      assert(pageContribution);
      assert.strictEqual(pageContribution.importPaths.size, 0);
      assert.deepStrictEqual(
        pageContribution.rawContent,
        textEncoder.encode(`\n      console.log("Hello, world!");\n    `),
      );
      assert.strictEqual(pageContribution.callerFilePath, import.meta.filename);
    });

    test("A js template with multiple bundles separates raw content per bundle name", () => {
      const result = js`
      console.log("This is the page bundle.");
      ${js.bundle("bundle1")}
      console.log("This is bundle 1.");
      ${js.bundle("bundle2")}
      console.log("This is bundle 2.");
    `;

      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["@page", "bundle1", "bundle2"]);

      const pageContribution = result.bundles.get("@page") as BundleContribution;
      const bundle1Contribution = result.bundles.get("bundle1") as BundleContribution;
      const bundle2Contribution = result.bundles.get("bundle2") as BundleContribution;
      assert(pageContribution);
      assert(bundle1Contribution);
      assert(bundle2Contribution);

      assert.deepStrictEqual(
        pageContribution.rawContent,
        textEncoder.encode(`\n      console.log("This is the page bundle.");\n      `),
      );
      assert.strictEqual(pageContribution.importPaths.size, 0);

      assert.deepStrictEqual(
        bundle1Contribution.rawContent,
        textEncoder.encode(`\n      console.log("This is bundle 1.");\n      `),
      );
      assert.strictEqual(bundle1Contribution.importPaths.size, 0);

      assert.deepStrictEqual(
        bundle2Contribution.rawContent,
        textEncoder.encode(`\n      console.log("This is bundle 2.");\n    `),
      );
      assert.strictEqual(bundle2Contribution.importPaths.size, 0);
    });

    test("A js template with imports captures resolved import paths per bundle", () => {
      const result = js`
      ${js.import("../../test_data/js/external-script.js", "bundle1")}
      ${js.import("/test_data/js/external-script-2.js", "bundle2")}
    `;

      assert.deepEqual(Array.from(result.bundles.keys()), ["bundle1", "bundle2"]);

      const bundle1Contribution = result.bundles.get("bundle1") as BundleContribution;
      const bundle2Contribution = result.bundles.get("bundle2") as BundleContribution;
      assert(bundle1Contribution);
      assert(bundle2Contribution);

      assert.deepStrictEqual(
        bundle1Contribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js"))]),
      );
      // bundle1 was imports-only (the surrounding raw content is whitespace-only and dropped),
      // so the caller file is not tracked as a contribution dependency.
      assert.strictEqual(bundle1Contribution.callerFilePath, undefined);
      assert.strictEqual(bundle1Contribution.rawContent.byteLength, 0);

      assert.deepStrictEqual(
        bundle2Contribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/js/external-script-2.js"))]),
      );
      assert.strictEqual(bundle2Contribution.callerFilePath, undefined);
      assert.strictEqual(bundle2Contribution.rawContent.byteLength, 0);
    });

    test("A js template with mixed bundle targets correctly partitions imports and raw content", () => {
      const result = js`
      console.log("This is the page bundle.");

      ${js.import("/test_data/js/external-script.js", "my-bundle")}

      ${js.bundle("another-bundle")}
      console.log("Another bundle.");

      ${js.import("/test_data/js/external-script-2.js")}
    `;

      assert.deepEqual(Array.from(result.bundles.keys()), ["@page", "my-bundle", "another-bundle"]);

      const myBundleContribution = result.bundles.get("my-bundle") as BundleContribution;
      const anotherBundleContribution = result.bundles.get("another-bundle") as BundleContribution;
      const pageContribution = result.bundles.get("@page") as BundleContribution;
      assert(myBundleContribution);
      assert(anotherBundleContribution);
      assert(pageContribution);

      assert.deepStrictEqual(
        myBundleContribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js"))]),
      );

      // js.import() with no explicit bundle name targets the *current active bundle*, which
      // at that point in the template is "another-bundle" (set by the preceding js.bundle() call).
      assert.deepStrictEqual(
        anotherBundleContribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/js/external-script-2.js"))]),
      );
      assert.deepStrictEqual(
        anotherBundleContribution.rawContent,
        textEncoder.encode(`\n      console.log("Another bundle.");\n\n      \n    `),
      );

      assert.strictEqual(pageContribution.importPaths.size, 0);
      assert.deepStrictEqual(
        pageContribution.rawContent,
        textEncoder.encode(`\n      console.log("This is the page bundle.");\n\n      \n\n      `),
      );
    });

    test("Bundles whose raw content is whitespace-only but have imports are kept", () => {
      const result = js`
        ${js.import("/test_data/js/external-script.js", "my-bundle")}
        ${js.bundle("my-bundle")}


      `;

      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["my-bundle"]);

      const myBundleContribution = result.bundles.get("my-bundle") as BundleContribution;
      assert(myBundleContribution);
      assert.deepStrictEqual(
        myBundleContribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js"))]),
      );
      assert.strictEqual(myBundleContribution.rawContent.byteLength, 0);
      // Caller is not a dep when the bundle is imports-only
      assert.strictEqual(myBundleContribution.callerFilePath, undefined);
    });

    test("Bundles whose raw content is whitespace-only and have no imports are dropped entirely", () => {
      const result = js`
        ${js.bundle("empty-bundle")}


        ${js.bundle("non-empty-bundle")}
        console.log("hi");
      `;

      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["non-empty-bundle"]);
    });

    test("A js template with a css or html import throws an error at construction time", () => {
      assert.throws(
        () => js`${css.import("../../test_data/css/style.css")}`,
        new BundleError(
          `Encountered bundle object with asset type "css" in js template. Expected asset type "js".`
        ),
      );

      assert.throws(
        () => js`${html.import("../../test_data/html/index.html")}`,
        new BundleError(
          `Encountered bundle object with asset type "html" in js template. Expected asset type "js".`
        ),
      );
    });
  });

  describe("bundling contributions via the bundle import cache", () => {
    test("getJSImportBundle bundles a single import path through esbuild", async () => {
      const result = js`${js.import("../../test_data/js/external-script.js", "bundle1")}`;
      const bundle1Contribution = result.bundles.get("bundle1") as BundleContribution;
      assert(bundle1Contribution);

      const bundleResult = await getJSImportBundle(bundle1Contribution.importPaths);

      // The bundled output should contain the source content
      assert.match(textDecoder.decode(bundleResult.code), /Hello, world!/);
      // The dependency set should include the imported file
      assert(
        bundleResult.dependencyFilePaths.has(
          fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js")),
        ),
      );
    });

    test("getJSImportBundle bundles transitive dependencies into a single output", async () => {
      const result = js`${js.import("/test_data/js/file-with-import.js", "bundle1")}`;
      const bundle1Contribution = result.bundles.get("bundle1") as BundleContribution;
      assert(bundle1Contribution);

      const bundleResult = await getJSImportBundle(bundle1Contribution.importPaths);
      const code = textDecoder.decode(bundleResult.code);

      // Output should include code from both the entry file and its imported dependency
      assert.match(code, /sayHello/);
      // Dependency tracking should include both files
      assert(
        bundleResult.dependencyFilePaths.has(
          fileURLToPath(import.meta.resolve("../../test_data/js/file-with-import.js")),
        ),
      );
      assert(
        bundleResult.dependencyFilePaths.has(
          fileURLToPath(import.meta.resolve("../../test_data/js/imported-file.ts")),
        ),
      );
    });

    test("getJSImportBundle throws when an import path does not exist", async () => {
      const result = js`${js.import("/test_data/js/nonexistent-file.js")}`;
      const pageContribution = result.bundles.get("@page") as BundleContribution;
      assert(pageContribution);

      await assert.rejects(
        () => getJSImportBundle(pageContribution.importPaths),
        (err: unknown): err is BundleError => {
          assert(err instanceof BundleError);
          assert(err.cause instanceof Error);
          return true;
        },
      );
    });

    test("getJSImportBundle deduplicates work for repeated calls with the same path set", async () => {
      const result = js`${js.import("../../test_data/js/external-script.js", "bundle1")}`;
      const bundle1Contribution = result.bundles.get("bundle1") as BundleContribution;
      assert(bundle1Contribution);

      const [result1, result2] = await Promise.all([
        getJSImportBundle(bundle1Contribution.importPaths),
        getJSImportBundle(bundle1Contribution.importPaths),
      ]);
      assert.strictEqual(result1, result2);
      // Same Uint8Array reference, not just same content
      assert.strictEqual(result1.code, result2.code);
    });
  });

  describe("js.src()", () => {
    test("js.src() returns the expected bundle src object", () => {
      const result = js.src("my-bundle");
      assert.deepStrictEqual<BundleSrcObject<"js">>(result, {
        assetType: "js",
        bundleName: "my-bundle",
        [BUNDLE_TYPE]: "src",
      });
    });
  });

  describe("js.inline()", () => {
    test("js.inline() returns the expected bundle inline object", () => {
      const result = js.inline("my-bundle");
      assert.deepStrictEqual<BundleInlineObject<"js">>(result, {
        assetType: "js",
        bundleName: "my-bundle",
        [BUNDLE_TYPE]: "inline",
      });
    });
  });
});
