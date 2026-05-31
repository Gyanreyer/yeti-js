import {
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";

import { makeBundleVersionPlaceholder, makePageBundleVersionPlaceholder } from "./bundleVersionPlaceholder.ts";

describe("bundleVersionPlaceholder", () => {
  test("makeBundleVersionPlaceholder produces a URL-safe token containing a hash of the bundle name", () => {
    const placeholder = makeBundleVersionPlaceholder("css", "global");
    // The placeholder must contain only URL-safe chars so URLSearchParams.set won't rewrite
    // it in the rendered HTML — otherwise the bundleContentHashes substitution lookup fails.
    assert.match(placeholder, /^--YETI__css__[a-f0-9]{16}--$/);
  });

  test("makeBundleVersionPlaceholder produces stable output for the same bundle name", () => {
    const a = makeBundleVersionPlaceholder("css", "global");
    const b = makeBundleVersionPlaceholder("css", "global");
    assert.strictEqual(a, b);
  });

  test("makeBundleVersionPlaceholder differs between distinct bundle names", () => {
    const a = makeBundleVersionPlaceholder("css", "global");
    const b = makeBundleVersionPlaceholder("css", "critical");
    assert.notStrictEqual(a, b);
  });

  test("makeBundleVersionPlaceholder differs between asset types", () => {
    const cssPlaceholder = makeBundleVersionPlaceholder("css", "global");
    const jsPlaceholder = makeBundleVersionPlaceholder("js", "global");
    assert.notStrictEqual(cssPlaceholder, jsPlaceholder);
  });

  test("makeBundleVersionPlaceholder output survives URLSearchParams round-trip unchanged for exotic bundle names", () => {
    // Bundle names with characters that URLSearchParams.set would percent-encode if embedded
    // raw — spaces, `&`, `?`, `#`, `%`. The hashed placeholder must survive unchanged so the
    // substitution pass in eleventy.after can locate it in the rendered HTML.
    for (const name of ["my bundle", "a&b", "weird?name", "with#hash", "100%"]) {
      const placeholder = makeBundleVersionPlaceholder("css", name);
      const url = new URL("http://y/css/foo.css");
      url.searchParams.set("v", placeholder);
      assert(
        url.search.includes(placeholder),
        `expected URL search "${url.search}" to contain placeholder "${placeholder}" for bundle name "${name}"`,
      );
    }
  });

  test("placeholder tokens are replaced by replaceAll in rendered HTML", () => {
    const placeholder = makeBundleVersionPlaceholder("js", "global");

    const html = `<script src="/js/global.js?v=${placeholder}"></script>`;
    const result = html.replaceAll(placeholder, "a1b2c3d4");
    assert.strictEqual(result, `<script src="/js/global.js?v=a1b2c3d4"></script>`);
  });

  test("placeholders only appear in attribute values, not in text content", () => {
    const placeholder = makeBundleVersionPlaceholder("css", "global");

    // The placeholder is only inserted by processPageComponent into bundle src attributes.
    // Text content like <p>"/css/global.css"</p> will never contain a placeholder
    // because it doesn't go through the BundleSrcObject code path.
    const textContent = '<p>The bundle will be written to "/css/global.css"</p>';
    const result = textContent.replaceAll(placeholder, "a1b2c3d4");
    assert.strictEqual(result, textContent);
  });

  test("makePageBundleVersionPlaceholder produces a URL-safe token containing a hash of the inputPath", () => {
    const placeholder = makePageBundleVersionPlaceholder("css", "./test_data/blog/post.page.ts");
    // The placeholder must contain only URL-safe chars so URLSearchParams.set won't rewrite
    // it in the rendered HTML — otherwise the bundleContentHashes substitution lookup fails.
    assert.match(placeholder, /^--YETI__page__css__[a-f0-9]{16}--$/);
  });

  test("makePageBundleVersionPlaceholder produces stable output for the same inputPath", () => {
    const a = makePageBundleVersionPlaceholder("css", "./test_data/blog/post.page.ts");
    const b = makePageBundleVersionPlaceholder("css", "./test_data/blog/post.page.ts");
    assert.strictEqual(a, b);
  });

  test("makePageBundleVersionPlaceholder differs between distinct inputPaths", () => {
    const a = makePageBundleVersionPlaceholder("css", "./blog/post-a.page.ts");
    const b = makePageBundleVersionPlaceholder("css", "./blog/post-b.page.ts");
    assert.notStrictEqual(a, b);
  });

  test("makePageBundleVersionPlaceholder differs between asset types", () => {
    const cssPlaceholder = makePageBundleVersionPlaceholder("css", "./blog/post.page.ts");
    const jsPlaceholder = makePageBundleVersionPlaceholder("js", "./blog/post.page.ts");
    assert.notStrictEqual(cssPlaceholder, jsPlaceholder);
  });

  test("makePageBundleVersionPlaceholder output survives URLSearchParams round-trip unchanged", () => {
    const placeholder = makePageBundleVersionPlaceholder("css", "./test_data/blog/post.page.ts");
    const url = new URL("http://y/css/_pages/blog/post.css");
    url.searchParams.set("v", placeholder);
    // The placeholder must appear in the URL exactly as the factory produced it — that is the
    // load-bearing invariant for the bundleContentHashes substitution pass.
    assert(url.search.includes(placeholder), `expected URL search "${url.search}" to contain placeholder "${placeholder}"`);
  });
});
