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
      `<div>
  <h1>Hello, World!</h1>
  <p>This is a test.</p>
</div>`
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
    const result = renderHTML(htmlRoot);

    assert.strictEqual(
      result,
      `<!DOCTYPE html>
<!-- This is a comment -->
<div>Content</div>`
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

  describe("minification", () => {
    test("minifies whitespace and strips comments", async () => {
      const htmlRoot = await html`<!DOCTYPE html>
<div>
  <span>Hello</span>
  <span>World</span>
  <!-- This is a comment -->
</div>`;
      const result = renderHTML(htmlRoot, { minify: true });

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
      const result = renderHTML(htmlRoot, { minify: true });

      assert.strictEqual(
        result,
        `<div><pre>
    This is    preformatted   text.
    It should preserve   whitespace.
  </pre></div>`
      );
    });
  });
});