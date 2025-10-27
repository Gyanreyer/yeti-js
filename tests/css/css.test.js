import { describe, test } from 'node:test';

import { bundle } from '../../src/bundle.js';
import { css } from '../../src/css.js';

/**
 * @import { CSSResult } from '../../src/css.js';
 */

describe('css tagged template function', () => {
  test('A simple string-only css template is processed as expected', async ({
    assert,
  }) => {
    const result = css`
      body {
        margin: 1000px;
      }
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        default: `body {
        margin: 1000px;
      }`,
      },
      cssDependencies: [],
    }));
  });

  test("A css template with bundles specified is procesed as expected", async ({ assert }) => {
    const result = css`
      ${bundle("my-bundle")}
      :root {
        color: rebeccapurple;
      }

      ${bundle("another-bundle")}
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
      cssDependencies: [],
    }));
  });

  test("A css template with imports specified is processed as expected", async ({ assert }) => {
    const result = css`
      ${bundle.import("./reset.css")}
      ${bundle.import("./css-file.css", "my-bundle")}
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        default: `body {
  margin: 0;
}`,
        "my-bundle": `:root {
  font-family: "Comic Sans";
}`,
      },
      cssDependencies: [
        `${import.meta.dirname}/reset.css`,
        `${import.meta.dirname}/css-file.css`,
      ],
    }));
  });

  test("A css template mixed bundle targets is processed as expected", async ({ assert }) => {
    const result = css`
      ${bundle.import("./reset.css")}
      ${bundle.import("./css-file.css", "custom-bundle")}

      :root {
        font-size: 16px;
      }

      ${bundle("custom-bundle")}
      h1 {
        margin: 0;
      }
      ${bundle.import("./css-file-2.css")}
    `();

    assert.deepEqual(result, /** @type {CSSResult} */({
      cssBundles: {
        default: `body {
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
      cssDependencies: [
        `${import.meta.dirname}/reset.css`,
        `${import.meta.dirname}/css-file.css`,
        `${import.meta.dirname}/css-file-2.css`,
      ],
    }),
    );
  });

  test("A css template with imports for files that don't exist throws an error when processed", async ({ assert }) => {
    assert.throws(
      css`${bundle.import("./nonexistent.css")} `,
      new Error(`bundle.import failed to import file at path "${import.meta.dirname}/nonexistent.css"`),
    );
  });
});