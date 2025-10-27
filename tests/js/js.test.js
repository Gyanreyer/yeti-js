import { describe, test } from "node:test";

import { bundle } from '../../src/bundle.js';
import { js } from '../../src/js.js';

/**
 * @import { JSResult } from '../../src/js.js';
 */

describe('js tagged template function', () => {
  test('A simple string-only js template is processed as expected', async ({
    assert,
  }) => {
    const result = js`
      console.log("Hello, world!");
    `();

    assert.deepEqual(result, /** @type {JSResult} */({
      jsBundles: {
        default: `{
console.log("Hello, world!");
}`,
      },
      jsDependencies: [],
    }));
  });

  test("A js template with bundles specified is procesed as expected", async ({ assert }) => {
    const result = js`
      console.log("This is in the default bundle");

      ${bundle("my-bundle")}
      console.log("This is my-bundle");

      ${bundle("another-bundle")}
      console.log("This is another-bundle");
    `();

    assert.deepEqual(result, /** @type {JSResult} */({
      jsBundles: {
        default: `{
console.log("This is in the default bundle");
}`,
        "my-bundle": `{
console.log("This is my-bundle");
}`,
        "another-bundle": `{
console.log("This is another-bundle");
}`,
      },
      jsDependencies: [],
    }));
  });

  test("A js template with imports specified is processed as expected", async ({ assert }) => {
    const result = js`
      ${bundle.import("./js-file-1.js")}
      ${bundle.import("./js-file-2.js")}
    `();

    assert.deepEqual(result, /** @type {JSResult} */({
      jsBundles: {
        default: `{
// Send an alert for js file 1
window.alert("This is js-file-1.js");

// Send an alert for js file 2
window.alert("This is js-file-2.js");
}`,
      },
      jsDependencies: [
        `${import.meta.dirname}/js-file-1.js`,
        `${import.meta.dirname}/js-file-2.js`,
      ],
    }));
  });

  test("A js template with mixed bundle targets is processed as expected", async ({ assert }) => {
    const result = js`
      console.log("In default bundle");

      ${bundle.import("./js-file-1.js", "my-bundle")}

      ${bundle("another-bundle")}
      console.log("In another-bundle");

      ${bundle.import("./js-file-2.js")}
    `();

    assert.deepEqual(result, /** @type {JSResult} */({
      jsBundles: {
        default: `{
console.log("In default bundle");
}`,
        "my-bundle": `{
// Send an alert for js file 1
window.alert("This is js-file-1.js");
}`,
        "another-bundle": `{
console.log("In another-bundle");
// Send an alert for js file 2
window.alert("This is js-file-2.js");
}`,
      },
      jsDependencies: [
        `${import.meta.dirname}/js-file-1.js`,
        `${import.meta.dirname}/js-file-2.js`,
      ],
    }));
  });

  test("A js template with imports for files that don't exist throws an error when processed", async ({ assert }) => {
    assert.throws(
      js`${bundle.import("./non-existent-file.js")}`,
      new Error(`bundle.import failed to import file at path "${import.meta.dirname}/non-existent-file.js"`),
    )
  });
});
