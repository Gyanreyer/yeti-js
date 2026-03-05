import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { isJSTemplateResult, js } from "./js.ts";
import { css } from '../css/css.ts';
import { html } from '../html/html.ts';
import { textEncoder } from '../utils/textEncoder.ts';
import { BundleError } from '../error.ts';
import { BUNDLE_TYPE, type BundleSrcObject, type BundleInlineObject } from '../bundle/bundle.ts';

describe("js", () => {
  describe("js templates", () => {
    test("A simple string-only js template is processed as expected", async () => {
      const result = js`
      console.log("Hello, world!");
    `;
      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["global"]);
      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);
      const globalBundleResult = await globalBundleGetter();

      assert.deepStrictEqual(globalBundleResult, {
        bundleName: "global",
        code: textEncoder.encode(`\n      console.log("Hello, world!");\n    `),
        dependencies: new Set([import.meta.filename]),
      });
    });

    test("A js template with bundles specified using js.bundle() is processed as expected", async () => {
      const result = js`
      console.log("This is the global bundle.");
      ${js.bundle("bundle1")}
      console.log("This is bundle 1.");
      ${js.bundle("bundle2")}
      console.log("This is bundle 2.");
    `;

      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["global", "bundle1", "bundle2"]);

      const globalBundleGetter = result.bundles.get("global");
      const bundle1Getter = result.bundles.get("bundle1");
      const bundle2Getter = result.bundles.get("bundle2");
      assert(globalBundleGetter);
      assert(bundle1Getter);
      assert(bundle2Getter);

      const globalBundleResult = await globalBundleGetter();
      const bundle1Result = await bundle1Getter();
      const bundle2Result = await bundle2Getter();

      assert.deepStrictEqual(globalBundleResult, {
        bundleName: "global",
        code: textEncoder.encode(`\n      console.log("This is the global bundle.");\n      `),
        dependencies: new Set([import.meta.filename]),
      });

      assert.deepStrictEqual(bundle1Result, {
        bundleName: "bundle1",
        code: textEncoder.encode(`\n      console.log("This is bundle 1.");\n      `),
        dependencies: new Set([import.meta.filename]),
      });

      assert.deepStrictEqual(bundle2Result, {
        bundleName: "bundle2",
        code: textEncoder.encode(`\n      console.log("This is bundle 2.");\n    `),
        dependencies: new Set([import.meta.filename]),
      });
    });

    test("A js template with imports specified using js.import() is processed as expected", async () => {
      const result = js`
      ${js.import("../../test_data/js/external-script.js", "bundle1")}
      ${js.import("/test_data/js/external-script-2.js", "bundle2")}
    `;

      assert.deepEqual(Array.from(result.bundles.keys()), ["bundle1", "bundle2"]);

      const bundle1Getter = result.bundles.get("bundle1");
      const bundle2Getter = result.bundles.get("bundle2");
      assert(bundle1Getter);
      assert(bundle2Getter);

      const bundle1Result = await bundle1Getter();
      const bundle2Result = await bundle2Getter();

      assert.deepStrictEqual(bundle1Result, {
        bundleName: "bundle1",
        code: textEncoder.encode(`// test_data/js/external-script.js
console.log("Hello, world!");
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js")),
        ]),
      });

      assert.deepStrictEqual(bundle2Result, {
        bundleName: "bundle2",
        code: textEncoder.encode(`// test_data/js/external-script-2.js
window.alert("This is external-script-2.js");
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/js/external-script-2.js")),
        ]),
      });
    });

    test("A js template with mixed bundle targets is processed as expected", async () => {
      const result = js`
      console.log("This is the global bundle.");

      ${js.import("/test_data/js/external-script.js", "my-bundle")}

      ${js.bundle("another-bundle")}
      console.log("Another bundle.");

      ${js.import("/test_data/js/external-script-2.js")}
    `;

      assert.deepEqual(Array.from(result.bundles.keys()), ["global", "my-bundle", "another-bundle"]);

      const myBundleGetter = result.bundles.get("my-bundle");
      const anotherBundleGetter = result.bundles.get("another-bundle");
      const globalBundleGetter = result.bundles.get("global");
      assert(myBundleGetter);
      assert(anotherBundleGetter);
      assert(globalBundleGetter);

      const myBundleResult = await myBundleGetter();
      const anotherBundleResult = await anotherBundleGetter();

      assert.deepStrictEqual(myBundleResult, {
        bundleName: "my-bundle",
        code: textEncoder.encode(`// test_data/js/external-script.js
console.log("Hello, world!");
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js")),
        ]),
      });

      assert.deepStrictEqual(anotherBundleResult, {
        bundleName: "another-bundle",
        code: textEncoder.encode(`// test_data/js/external-script-2.js
window.alert("This is external-script-2.js");

      console.log("Another bundle.");\n\n      \n    `),
        dependencies: new Set([
          import.meta.filename,
          fileURLToPath(import.meta.resolve("../../test_data/js/external-script-2.js")),
        ]),
      });

      const globalBundleResult = await globalBundleGetter();
      assert.deepStrictEqual(globalBundleResult, {
        bundleName: "global",
        // Global bundle just has the whitespace and newlines around the imports and bundles
        code: textEncoder.encode(`
      console.log("This is the global bundle.");\n\n      \n\n      `),
        dependencies: new Set([import.meta.filename]),
      });
    });

    test("A js template with imports for a file with sub-dependencies is bundled as expected", async () => {
      const result = js`${js.import("/test_data/js/file-with-import.js", "bundle1")}`;

      assert.deepEqual(Array.from(result.bundles.keys()), ["bundle1"]);

      const bundle1Getter = result.bundles.get("bundle1");
      assert(bundle1Getter);

      const bundle1Result = await bundle1Getter();

      assert.deepStrictEqual(bundle1Result, {
        bundleName: "bundle1",
        code: textEncoder.encode(`// test_data/js/imported-file.ts
var sayHello = (name) => {
  console.log(\`Hello, \${name}, from the imported file!\`);
};

// test_data/js/file-with-import.js
sayHello("Alice");
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/js/file-with-import.js")),
          fileURLToPath(import.meta.resolve("../../test_data/js/imported-file.ts")),
        ]),
      });
    });

    test("Bundles with imports are kept even if raw content is only whitespace", async () => {
      const result = js`
        ${js.import("/test_data/js/external-script.js", "my-bundle")}
        ${js.bundle("my-bundle")}


      `;

      assert(isJSTemplateResult(result));
      assert.deepStrictEqual(Array.from(result.bundles.keys()), ["my-bundle"]);

      const myBundleGetter = result.bundles.get("my-bundle");
      assert(myBundleGetter);

      const myBundleResult = await myBundleGetter();

      assert.deepStrictEqual(myBundleResult, {
        bundleName: "my-bundle",
        code: textEncoder.encode(`// test_data/js/external-script.js
console.log("Hello, world!");
`),
        dependencies: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/js/external-script.js")),
          // The caller file is not a dependency since we dropped the whitespace-only content
        ]),
      });
    });

    test("A js template with imports for files that don't exist throws an error", async () => {
      const result = js`${js.import("/test_data/js/nonexistent-file.js")}`;

      assert.deepEqual(Array.from(result.bundles.keys()), ["global"]);

      const globalBundleGetter = result.bundles.get("global");
      assert(globalBundleGetter);

      try {
        await globalBundleGetter();
        assert.fail("Expected globalBundleGetter() to throw an error for nonexistent file import, but it did not throw.");
      } catch (err) {
        assert(err instanceof BundleError);
        assert.strictEqual(err.message, `js.import() failed to import files for bundle "global".`);
        // The cause should be an esbuild BuildFailure error with details about the error
        assert(err.cause instanceof Error);
        assert.strictEqual((err.cause as any).errors[0].text, `Could not resolve "/Users/ryangeyer/Projects/yeti-js/test_data/js/nonexistent-file.js"`);
      }
    });

    test("A js template with a css or html import throws an error", async () => {
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

    test("JS template results are cached, and the bundle getters return the same results on multiple calls", async () => {
      const result = js`${js.import("../../test_data/js/external-script.js", "bundle1")}`;

      assert(isJSTemplateResult(result));
      const bundle1Getter = result.bundles.get("bundle1");
      assert(bundle1Getter);

      const bundle1Result1 = await bundle1Getter();
      const bundle1Result2 = await bundle1Getter();

      assert.strictEqual(bundle1Result1, bundle1Result2);
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