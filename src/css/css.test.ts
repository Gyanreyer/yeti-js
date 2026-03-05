import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { BUNDLE_TYPE } from "../bundle/bundle.ts";
import { textEncoder } from "../utils/textEncoder.ts";

import { BundleError } from "../error.ts";
import { html } from "../html/html.ts";
import { js } from "../js/js.ts";

import { css, isCSSTemplateResult } from "./css.ts";

describe("css", () => {
  describe("css templates", () => {
    test("A simple string-only css template is processed as expected", async () => {
      const result = css`
        body {
          margin: 1000px;
        }
      `;
      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["global"]);
      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);
      const globalBundleResult = await globalBundleGetter();

      assert.deepStrictEqual(globalBundleResult, {
        bundleName: "global",
        code: textEncoder.encode(`
        body {
          margin: 1000px;
        }
      `),
        dependencies: new Set([import.meta.filename]),
      });
    });

    test("A css template with bundles specified is processed as expected", async () => {
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

      const myBundleGetter = result.bundles.get("my-bundle");
      assert(myBundleGetter);
      const myBundleResult = await myBundleGetter();
      assert.deepStrictEqual(myBundleResult, {
        bundleName: "my-bundle",
        code: textEncoder.encode(`
        :root {
          color: rebeccapurple;
        }

        `),
        dependencies: new Set([import.meta.filename]),
      });

      const anotherBundleGetter = result.bundles.get("another-bundle");
      assert(anotherBundleGetter);
      const anotherBundleResult = await anotherBundleGetter();
      assert.deepStrictEqual(anotherBundleResult, {
        bundleName: "another-bundle",
        code: textEncoder.encode(`
        body {
          margin: 0;
        }
      `),
        dependencies: new Set([import.meta.filename]),
      });
    });

    test("A css template with imports is processed as expected", async () => {
      const result = css`
        ${css.import("../../test_data/css/external-styles.css", "bundle-1")}
        ${css.import("/test_data/css/external-styles-2.css", "bundle-2")}
        ${css.import("/test_data/css/styles-with-import.css", "bundle-3")}
      `;

      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["bundle-1", "bundle-2", "bundle-3"]);

      const bundle1Getter = result.bundles.get("bundle-1");
      assert(bundle1Getter);
      const bundle1Result = await bundle1Getter();
      assert.deepStrictEqual(bundle1Result, {
        bundleName: "bundle-1",
        code: textEncoder.encode(`:root {
  font-size: 100px;
}
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/css/external-styles.css"))
        ]),
      });

      const bundle2Getter = result.bundles.get("bundle-2");
      assert(bundle2Getter);
      const bundle2Result = await bundle2Getter();
      assert.deepStrictEqual(bundle2Result, {
        bundleName: "bundle-2",
        code: textEncoder.encode(`h1 {
  font-family: sans-serif;
}
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/css/external-styles-2.css"))
        ]),
      });

      const bundle3Getter = result.bundles.get("bundle-3");
      assert(bundle3Getter);
      const bundle3Result = await bundle3Getter();
      debugger;
      assert.deepStrictEqual(bundle3Result, {
        bundleName: "bundle-3",
        code: textEncoder.encode(`:root {
  --brand-color: rebeccapurple;
}

:root {
  font-size: 100px;
}
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/css/styles-with-import.css")),
          fileURLToPath(import.meta.resolve("../../test_data/css/imported-styles.css")),
        ]),
      });
    });

    test("Bundles containing only whitespace are dropped", async () => {
      const result = css`
        ${css.bundle("empty-bundle")}
        
        
        ${css.bundle("non-empty-bundle")}
        body { margin: 0; }
      `;

      assert(isCSSTemplateResult(result));
      // empty-bundle should be filtered out because it contains only whitespace
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["non-empty-bundle"]);

      const nonEmptyBundleGetter = result.bundles.get("non-empty-bundle");
      assert(nonEmptyBundleGetter);
      const nonEmptyBundleResult = await nonEmptyBundleGetter();
      assert.deepStrictEqual(nonEmptyBundleResult, {
        bundleName: "non-empty-bundle",
        code: textEncoder.encode(`
        body { margin: 0; }
      `),
        dependencies: new Set([import.meta.filename]),
      });
    });

    test("Bundles with imports are kept even if raw content is only whitespace", async () => {
      const result = css`
        ${css.import("../../test_data/css/external-styles.css", "bundle-with-import")}
        ${css.bundle("bundle-with-import")}
        
        
      `;

      assert(isCSSTemplateResult(result));
      // bundle-with-import should be kept because it has imports
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["bundle-with-import"]);

      const bundleGetter = result.bundles.get("bundle-with-import");
      assert(bundleGetter);
      const bundleResult = await bundleGetter();

      assert.deepStrictEqual(bundleResult, {
        bundleName: "bundle-with-import",
        code: textEncoder.encode(`:root {
  font-size: 100px;
}
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/css/external-styles.css")),
          // The caller file is not a dependency since we dropped the whitespace-only content
        ]),
      });
    });

    test("A css template with imports for files that don't exist throws an error", async () => {
      const result = css`${css.import("/test_data/css/non-existent-file.css")}`;

      assert.deepEqual(Array.from(result.bundles.keys()), ["global"]);

      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);

      try {
        await globalBundleGetter();
        assert.fail("Expected globalBundleGetter() to throw an error due to the missing file.");
      } catch (error) {
        assert(error instanceof Error);
        assert.strictEqual(error.message, `css.import() failed to import file "${fileURLToPath(import.meta.resolve("../../test_data/css/non-existent-file.css"))}" for bundle "global".`);
        // The cause should be a lightning CSS error
        assert(error.cause instanceof Error);
        assert.strictEqual(error.cause.message, "No such file or directory (os error 2)");
      }
    });

    test("A css template with a js or html import throws an error", async () => {
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

    test("CSS template results are cached, and the bundle getters return the same result on multiple calls", async () => {
      const result = css`
        ${css.import("../../test_data/css/external-styles.css", "my-bundle")}
      `;

      assert(isCSSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["my-bundle"]);

      const myBundleGetter1 = result.bundles.get("my-bundle");
      const myBundleGetter2 = result.bundles.get("my-bundle");
      assert(myBundleGetter1);
      assert(myBundleGetter2);
      assert.strictEqual(myBundleGetter1, myBundleGetter2);

      const myBundleResult1 = await myBundleGetter1();
      const myBundleResult2 = await myBundleGetter2();
      assert.strictEqual(myBundleResult1, myBundleResult2);
      assert.deepStrictEqual(myBundleResult1, {
        bundleName: "my-bundle",
        code: textEncoder.encode(`:root {
  font-size: 100px;
}
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/css/external-styles.css")),
        ]),
      });
    });
  });

  describe("css.src()", () => {
    test("css.src() returns the expected bundle src object", () => {
      const result = css.src("my-bundle");
      assert.deepStrictEqual(result, {
        assetType: "css",
        bundleName: "my-bundle",
        [BUNDLE_TYPE]: "src",
      });
    });
  });

  describe("css.inline()", () => {
    test("css.inline() returns the expected bundle inline object", () => {
      const result = css.inline("my-bundle");
      assert.deepStrictEqual(result, {
        assetType: "css",
        bundleName: "my-bundle",
        [BUNDLE_TYPE]: "inline",
      });
    });
  });
});