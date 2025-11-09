import { describe, test } from "node:test";

import { js, css } from '../../src/index.js';

/**
 * @import { JSResult } from '../../src/types.js';
 */

describe('js tagged template function', () => {
  test('A simple string-only js template is processed as expected', ({
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
      jsDependencies: new Set(),
    }));
  });

  test("A js template with bundles specified is procesed as expected", ({ assert }) => {
    const result = js`
      console.log("This is in the default bundle");

      ${js.bundle("my-bundle")}
      console.log("This is my-bundle");

      ${js.bundle("another-bundle")}
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
      jsDependencies: new Set(),
    }));
  });

  test("A js template with imports specified is processed as expected", ({ assert }) => {
    const result = js`
      ${js.import("./js-file-1.js")}
      ${js.import("./js-file-2.js")}
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
      jsDependencies: new Set([
        `${import.meta.dirname}/js-file-1.js`,
        `${import.meta.dirname}/js-file-2.js`,
      ]),
    }));
  });

  test("A js template with mixed bundle targets is processed as expected", ({ assert }) => {
    const result = js`
      console.log("In default bundle");

      ${js.import("./js-file-1.js", "my-bundle")}

      ${js.bundle("another-bundle")}
      console.log("In another-bundle");

      ${js.import("./js-file-2.js")}
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
      jsDependencies: new Set([
        `${import.meta.dirname}/js-file-1.js`,
        `${import.meta.dirname}/js-file-2.js`,
      ]),
    }));
  });

  test("A js template with imports for files that don't exist throws an error when processed", ({ assert }) => {
    assert.throws(
      js`${js.import("./non-existent-file.js")}`,
      new Error(`js.import() failed to import file at path "${import.meta.dirname}/non-existent-file.js"`),
    )
  });

  test("A js template with imports for incompatible types throws an error when processed", ({ assert }) => {
    assert.throws(
      js`${css.import("../css/css-file.css")}`,
      new Error('js template received an import value of incompatible type "css". Only JS imports via js.import() are allowed.'),
    );
  });

  test("js.src() creates a placeholder src string as expected", ({ assert }) => {
    const result = js.src("my-bundle");
    assert.equal(
      result,
      "@bundle/my-bundle",
      "js.src() should return the correctly prefixed bundle src placeholder",
    );
  });

  test("js.inline() creates a comment placeholder for inlining bundles as expected", ({ assert }) => {
    const result = js.inline("my-bundle");
    assert.equal(
      result,
      "/*@--BUNDLE--my-bundle--@*/",
      "js.inline() should return the correctly formatted inline js bundle placeholder",
    );
  });
});
