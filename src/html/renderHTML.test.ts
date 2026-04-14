import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { html } from "./html.ts";
import { renderHTML } from "./renderHTML.ts";

describe("renderHTML", () => {
  test("renders a simple HTML structure", async () => {
    const htmlRoot = await html`<div>
  <h1>Hello, World!</h1>
  <p>This is a test.</p>
</div>`;
    const result = renderHTML(htmlRoot);

    assert.strictEqual(
      result,
      `<div><h1>Hello, World!</h1><p>This is a test.</p></div>`
    );
  });

  test("renders HTML with attributes", async () => {
    const htmlRoot = await html`<a href="https://example.com" target="_blank">Example</a>`;
    const result = renderHTML(htmlRoot);

    assert.strictEqual(
      result,
      `<a href="https://example.com" target="_blank">Example</a>`
    );
  });

  test("renders HTML with comments and doctype", async () => {
    const htmlRoot = await html`<!DOCTYPE html>
<!-- This is a comment -->
<div>Content</div>`;
    const result = renderHTML(htmlRoot, { shouldStripComments: false });

    assert.strictEqual(
      result,
      `<!DOCTYPE html><!-- This is a comment --><div>Content</div>`
    );
  });

  test("escapes text content properly", async () => {
    const htmlRoot = await html`<p>This is "double quotes", 'single quotes', & a ${"<tag>"} inside text.</p>`;
    const result = renderHTML(htmlRoot);

    assert.strictEqual(
      result,
      `<p>This is &quot;double quotes&quot;, &#39;single quotes&#39;, &amp; a &lt;tag&gt; inside text.</p>`
    );
  });

  test("escapes attribute values properly", async () => {
    const htmlRoot = await html`<input type="text" value='This is a "quote"'>`;
    const result = renderHTML(htmlRoot);
    assert.strictEqual(
      result,
      `<input type="text" value="This is a &quot;quote&quot;">`
    );
  });

  test("escapes special characters in dynamic attribute values", async () => {
    const malicious = `"><script>alert('xss')</script>`;
    const htmlRoot = await html`<div data-value="${malicious}"></div>`;
    const result = renderHTML(htmlRoot);
    assert.strictEqual(
      result,
      `<div data-value="&quot;&gt;&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"></div>`
    );
  });

  test("preserves HTML entity references in text content", async () => {
    const htmlRoot = await html`<p>Hello&nbsp;world &amp; goodbye&mdash;friends &#169; &#x1F600;</p>`;
    const result = renderHTML(htmlRoot);
    assert.strictEqual(
      result,
      `<p>Hello&nbsp;world &amp; goodbye&mdash;friends &#169; &#x1F600;</p>`
    );
  });

  test("escapes bare ampersands but preserves entity references", async () => {
    const htmlRoot = await html`<p>A&B &nbsp; C&amp;D</p>`;
    const result = renderHTML(htmlRoot);
    assert.strictEqual(
      result,
      `<p>A&amp;B &nbsp; C&amp;D</p>`
    );
  });

  test("escapes ampersands in attribute values", async () => {
    const htmlRoot = await html`<a href=${"https://example.com?a=1&b=2"}></a>`;
    const result = renderHTML(htmlRoot);
    assert.strictEqual(
      result,
      `<a href="https://example.com?a=1&amp;b=2"></a>`
    );
  });

  describe("minification", () => {
    test("minifies whitespace and strips comments", async () => {
      const htmlRoot = await html`<!DOCTYPE html>
<div>
  <span>Hello</span>
  <span>World</span>
  <!-- This is a comment -->
</div>`;
      const result = renderHTML(htmlRoot, { indentation: null });

      assert.strictEqual(
        result,
        `<!DOCTYPE html><div><span>Hello</span><span>World</span></div>`
      );
    });

    test("preserves whitespace in <pre> tags even when minifying", async () => {
      const htmlRoot = await html`<div>
  <pre>
    This is    preformatted   text.
    It should preserve   whitespace.
  </pre>
</div>`;
      const result = renderHTML(htmlRoot, { indentation: null });

      assert.strictEqual(
        result,
        `<div><pre>
    This is    preformatted   text.
    It should preserve   whitespace.
  </pre></div>`
      );
    });
  });

  describe("pretty printing", () => {
    test("does not add line breaks around inline elements mixed with text", async () => {
      const htmlRoot = await html`<div>
  <p>Hello <strong>world</strong> and <em>everyone</em>!</p>
</div>`;
      const result = renderHTML(htmlRoot, { indentation: "  " });

      assert.strictEqual(
        result,
        `<div>\n  <p>Hello <strong>world</strong> and <em>everyone</em>!</p>\n</div>`
      );
    });

    test("adds line breaks if the first child is an element", async () => {
      const htmlRoot = await html`<p><a href="/about">About <span>us</span></a></p>`;
      const result = renderHTML(htmlRoot, { indentation: "  " });

      assert.strictEqual(
        result,
        "<p>\n  <a href=\"/about\">About <span>us</span></a>\n</p>"
      );
    });

    test("renders with indentation and newlines", async () => {
      const htmlRoot = await html`<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
    <meta charset="UTF-8">
  </head>
  <body>
    <h1>Hello, World!</h1>
    <p>This is a test.</p>
  </body>
</html>`;

      const result = renderHTML(htmlRoot, { indentation: "  " });

      assert.strictEqual(
        result,
        `<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
    <meta charset="UTF-8">
  </head>
  <body>
    <h1>Hello, World!</h1>
    <p>This is a test.</p>
  </body>
</html>`
      );
    });
  });
});