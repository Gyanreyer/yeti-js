import { describe, test } from "node:test";

describe('ensureHTMLHasDoctype utility function', () => {
  test('It adds a doctype to HTML strings that lack one', async ({ assert }) => {
    const { ensureHTMLHasDoctype } = await import('../src/utils/ensureHTMLHasDoctype.js');

    const htmlWithoutDoctype = `<html>
  <head>
    <title>Test</title>
  </head>
  <body>
    <h1>Hello, world!</h1>
  </body>
</html>`;

    const result = ensureHTMLHasDoctype(htmlWithoutDoctype);

    assert.equal(`<!DOCTYPE html>
${htmlWithoutDoctype}`, result);
  });

  test("It does not modify HTML strings that already have a doctype", async ({ assert }) => {
    const { ensureHTMLHasDoctype } = await import('../src/utils/ensureHTMLHasDoctype.js');

    const htmlWithDoctype = `<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
  </head>
  <body>
    <h1>Hello, world!</h1>
  </body>
</html>`;

    const result = ensureHTMLHasDoctype(htmlWithDoctype);

    assert.equal(htmlWithDoctype, result);
  });
});