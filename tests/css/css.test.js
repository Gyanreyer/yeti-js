import { describe, test } from 'node:test';

import { css, js } from '../../src/index.js';

/**
 * @import { CSSResult } from '../../src/types';
 */

describe('css tagged template function', () => {
  test('A simple string-only css template is processed as expected', ({
    assert,
  }) => {
    const result = css`
      body {
        margin: 1000px;
      }
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        global: `body {
        margin: 1000px;
      }`,
      },
      cssDependencies: new Set([]),
    }));
  });

  test("A css template with bundles specified is procesed as expected", ({ assert }) => {
    const result = css`
      ${css.bundle("my-bundle")}
      :root {
        color: rebeccapurple;
      }

      ${css.bundle("another-bundle")}
      body {
        margin: 0;
      }
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        "my-bundle": `:root {
        color: rebeccapurple;
      }`,
        "another-bundle": `body {
        margin: 0;
      }`,
      },
      cssDependencies: new Set([]),
    }));
  });

  test("A css template with imports specified is processed as expected", ({ assert }) => {
    const result = css`
      ${css.import("./reset.css")}
      ${css.import("./css-file.css", "my-bundle")}
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        global: `body {
  margin: 0;
}`,
        "my-bundle": `:root {
  font-family: "Comic Sans";
}`,
      },
      cssDependencies: new Set([
        `${import.meta.dirname}/reset.css`,
        `${import.meta.dirname}/css-file.css`,
      ]),
    }));
  });

  test("A css template mixed bundle targets is processed as expected", ({ assert }) => {
    const result = css`
      ${css.import("./reset.css")}
      ${css.import("./css-file.css", "custom-bundle")}

      :root {
        font-size: 16px;
      }

      ${css.bundle("custom-bundle")}
      h1 {
        margin: 0;
      }
      ${css.import("./css-file-2.css")}
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        global: `body {
  margin: 0;
}

:root {
        font-size: 16px;
      }`,
        "custom-bundle": `:root {
  font-family: "Comic Sans";
}
h1 {
        margin: 0;
      }
* {
  box-sizing: border-box;
}`,
      },
      cssDependencies: new Set([
        `${import.meta.dirname}/reset.css`,
        `${import.meta.dirname}/css-file.css`,
        `${import.meta.dirname}/css-file-2.css`,
      ]),
    }),
    );
  });

  test("A css template with imports for files that don't exist throws an error when processed", ({ assert }) => {
    assert.throws(
      css`${css.import("./nonexistent.css")} `,
      new Error(`css.import() failed to import file at path "${import.meta.dirname}/nonexistent.css"`),
    );
  });

  test("A css template with imports for incompatible types throws an error when processed", ({ assert }) => {
    assert.throws(
      css`${js.import("../js/js-file-1.js")} `,
      new Error('css template received an import value of incompatible type "js". Only CSS imports via css.import() are allowed.'),
    );
  });

  test("css.src() creates a placeholder src string as expected", ({ assert }) => {
    const result = css.src("my-bundle");
    assert.equal(
      result,
      "@bundle/my-bundle",
      "js.src() should return the correctly prefixed bundle src placeholder",
    );
  });

  test("css.inline() creates a comment placeholder for inlining bundles as expected", ({ assert }) => {
    const result = css.inline("my-bundle");
    assert.equal(
      result,
      "/*@--BUNDLE--my-bundle--@*/",
      "js.inline() should return the correctly formatted inline js bundle placeholder",
    );
  });
});