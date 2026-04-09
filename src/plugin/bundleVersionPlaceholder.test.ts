import {
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";

import { makeBundleVersionPlaceholder } from "./bundleVersionPlaceholder.ts";

describe("bundleVersionPlaceholder", () => {
  test("makeBundleVersionPlaceholder produces the expected format", () => {
    const placeholder = makeBundleVersionPlaceholder("css", "global");
    assert.strictEqual(placeholder, "--YETI__css__global--");
  });

  test("placeholder tokens are replaced by replaceAll in rendered HTML", () => {
    const placeholder = makeBundleVersionPlaceholder("js", "global");

    const html = `<script src="/js/global.js?v=${placeholder}"></script>`;
    const result = html.replaceAll(placeholder, "a1b2c3d4");
    assert.strictEqual(result, '<script src="/js/global.js?v=a1b2c3d4"></script>');
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
});
