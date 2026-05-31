import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  BUNDLE_TYPE,
  type BundleContribution,
  type BundleSrcObject,
  type BundleInlineObject,
} from "../bundle/bundle.ts";
import { textEncoder } from "../utils/textEncoder.ts";
import { textDecoder } from "../utils/textDecoder.ts";

import { BundleError } from "../error.ts";
import { html } from "../html/html.ts";
import { js } from "../js/js.ts";

import { css, isCSSTemplateResult } from "./css.ts";
import {
  clearBundleImportCache,
  getCSSImportBundle,
} from "../bundle/bundleImportCache.ts";

describe("css", () => {
  afterEach(() => {
    clearBundleImportCache();
  });

  describe("css templates", () => {
    test("A simple string-only css template produces a contribution with raw content under the page-scoped @page key by default", () => {
      const result = css`
        body {
          margin: 1000px;
        }
      `;
      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["@page"]);

      const pageContribution = result.bundles.get("@page");
      assert(pageContribution);
      assert.strictEqual(pageContribution.importPaths.size, 0);
      assert.deepStrictEqual(
        pageContribution.rawContent,
        textEncoder.encode(`
        body {
          margin: 1000px;
        }
      `),
      );
      assert.strictEqual(pageContribution.callerFilePath, import.meta.filename);
    });

    test("A css template with multiple bundles separates raw content per bundle name", () => {
      const result = css`
        ${css.bundle("my-bundle")}
        :root {
          color: rebeccapurple;
        }

        ${css.bundle("another-bundle")}
        body {
          margin: 0;
        }
      `;

      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(
        Array.from(result.bundles.keys()),
        ["my-bundle", "another-bundle"],
      );

      const myBundleContribution = result.bundles.get("my-bundle") as BundleContribution;
      assert(myBundleContribution);
      assert.deepStrictEqual(
        myBundleContribution.rawContent,
        textEncoder.encode(`
        :root {
          color: rebeccapurple;
        }

        `),
      );

      const anotherBundleContribution = result.bundles.get("another-bundle") as BundleContribution;
      assert(anotherBundleContribution);
      assert.deepStrictEqual(
        anotherBundleContribution.rawContent,
        textEncoder.encode(`
        body {
          margin: 0;
        }
      `),
      );
    });

    test("A css template with imports captures resolved import paths per bundle", () => {
      const result = css`
        ${css.import("../../test_data/css/external-styles.css", "bundle-1")}
        ${css.import("/test_data/css/external-styles-2.css", "bundle-2")}
        ${css.import("/test_data/css/styles-with-import.css", "bundle-3")}
      `;

      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["bundle-1", "bundle-2", "bundle-3"]);

      const bundle1Contribution = result.bundles.get("bundle-1") as BundleContribution;
      assert(bundle1Contribution);
      assert.deepStrictEqual(
        bundle1Contribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/css/external-styles.css"))]),
      );

      const bundle2Contribution = result.bundles.get("bundle-2") as BundleContribution;
      assert(bundle2Contribution);
      assert.deepStrictEqual(
        bundle2Contribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/css/external-styles-2.css"))]),
      );

      const bundle3Contribution = result.bundles.get("bundle-3") as BundleContribution;
      assert(bundle3Contribution);
      assert.deepStrictEqual(
        bundle3Contribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/css/styles-with-import.css"))]),
      );
    });

    test("Bundles containing only whitespace are dropped", () => {
      const result = css`
        ${css.bundle("empty-bundle")}


        ${css.bundle("non-empty-bundle")}
        body { margin: 0; }
      `;

      assert(isCSSTemplateResult(result));
      // empty-bundle should be filtered out because it contains only whitespace
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["non-empty-bundle"]);
    });

    test("Bundles whose raw content is whitespace-only but have imports are kept", () => {
      const result = css`
        ${css.import("../../test_data/css/external-styles.css", "bundle-with-import")}
        ${css.bundle("bundle-with-import")}


      `;

      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["bundle-with-import"]);

      const contribution = result.bundles.get("bundle-with-import") as BundleContribution;
      assert(contribution);
      assert.deepStrictEqual(
        contribution.importPaths,
        new Set([fileURLToPath(import.meta.resolve("../../test_data/css/external-styles.css"))]),
      );
      assert.strictEqual(contribution.rawContent.byteLength, 0);
      // Caller is not a dep when the bundle is imports-only
      assert.strictEqual(contribution.callerFilePath, undefined);
    });

    test("A css template with a js or html import throws an error at construction time", () => {
      assert.throws(
        () => css`${js.import("/test_data/js/external-script.js")}`,
        new BundleError(
          `Encountered bundle object with asset type "js" in css template. Expected asset type "css".`,
        ),
      );

      assert.throws(
        () => css`${html.import("/test_data/html/external-fragment.html")}`,
        new BundleError(
          `Encountered bundle object with asset type "html" in css template. Expected asset type "css".`,
        ),
      );
    });
  });

  describe("bundling contributions via the bundle import cache", () => {
    test("getCSSImportBundle bundles a single import path through lightningcss", async () => {
      const result = css`${css.import("../../test_data/css/external-styles.css", "my-bundle")}`;
      const myBundleContribution = result.bundles.get("my-bundle") as BundleContribution;
      assert(myBundleContribution);

      const bundleResult = await getCSSImportBundle(myBundleContribution.importPaths);
      const code = textDecoder.decode(bundleResult.code);
      assert.match(code, /font-size/);

      assert(
        bundleResult.dependencyFilePaths.has(
          fileURLToPath(import.meta.resolve("../../test_data/css/external-styles.css")),
        ),
      );
    });

    test("getCSSImportBundle resolves transitive @import statements as dependencies", async () => {
      const result = css`${css.import("/test_data/css/styles-with-import.css", "bundle")}`;
      const contribution = result.bundles.get("bundle") as BundleContribution;
      assert(contribution);

      const bundleResult = await getCSSImportBundle(contribution.importPaths);
      assert(
        bundleResult.dependencyFilePaths.has(
          fileURLToPath(import.meta.resolve("../../test_data/css/styles-with-import.css")),
        ),
      );
      assert(
        bundleResult.dependencyFilePaths.has(
          fileURLToPath(import.meta.resolve("../../test_data/css/imported-styles.css")),
        ),
      );
    });

    test("getCSSImportBundle throws when an import path does not exist", async () => {
      const result = css`${css.import("/test_data/css/non-existent-file.css")}`;
      const pageContribution = result.bundles.get("@page");
      assert(pageContribution);

      await assert.rejects(
        () => getCSSImportBundle(pageContribution.importPaths),
        (err: unknown): err is BundleError => {
          assert(err instanceof BundleError);
          assert(err.cause instanceof Error);
          return true;
        },
      );
    });

    test("getCSSImportBundle deduplicates work for repeated calls with the same path set", async () => {
      const result = css`${css.import("../../test_data/css/external-styles.css", "my-bundle")}`;
      const contribution = result.bundles.get("my-bundle") as BundleContribution;
      assert(contribution);

      const [result1, result2] = await Promise.all([
        getCSSImportBundle(contribution.importPaths),
        getCSSImportBundle(contribution.importPaths),
      ]);
      assert.strictEqual(result1, result2);
    });
  });

  describe("css.src()", () => {
    test("css.src() returns the expected bundle src object", () => {
      const result = css.src("my-bundle");
      assert.deepStrictEqual<BundleSrcObject<"css">>(result, {
        assetType: "css",
        bundleName: "my-bundle",
        [BUNDLE_TYPE]: "src",
      });
    });
  });

  describe("css.inline()", () => {
    test("css.inline() returns the expected bundle inline object", () => {
      const result = css.inline("my-bundle");
      assert.deepStrictEqual<BundleInlineObject<"css">>(result, {
        assetType: "css",
        bundleName: "my-bundle",
        [BUNDLE_TYPE]: "inline",
      });
    });
  });
});
