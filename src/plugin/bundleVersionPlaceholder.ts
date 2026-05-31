import { createHash } from "node:crypto";

/**
 * Creates a placeholder token for a bundle's version query param.
 * These placeholders are inserted into bundle src attribute values during page compilation,
 * then replaced with the actual content hash in the eleventy.after hook.
 *
 * The placeholder must be byte-identical to what ends up in the rendered HTML, since the
 * substitution pass uses `indexOf` to locate it. Because bundle names are arbitrary
 * user-supplied strings that may contain characters that `URLSearchParams.set` would
 * percent-encode (spaces, `&`, `?`, `#`, `%`, etc.), the placeholder embeds a SHA-1 hash of
 * the bundle name rather than the raw name. The hash is URL-safe hex, so the rendered
 * placeholder survives `URLSearchParams.set` unchanged regardless of what the user named
 * their bundle.
 *
 * Format: --YETI__{assetType}__{16-hex-char-hash}--
 */
export const makeBundleVersionPlaceholder = (assetType: string, bundleName: string): string => {
  const bundleNameHash = createHash("sha1").update(bundleName).digest("hex").slice(0, 16);
  return `--YETI__${assetType}__${bundleNameHash}--`;
};

/**
 * Creates a placeholder token for a page-scoped bundle's version query param. The placeholder
 * embeds a hash of the page's `inputPath` so that pages with the same input path (pagination
 * variants of the same template) share a placeholder, while pages from different templates do
 * not collide. We hash rather than embedding the inputPath directly because real inputPaths
 * contain `/` (and possibly other non-URL-safe chars) — embedding them raw would force
 * `URLSearchParams.set` to URL-encode the value at render time, producing an HTML string
 * that no longer matches the unencoded placeholder used as the `bundleContentHashes` lookup
 * key. Hashing sidesteps that entirely.
 *
 * Format: --YETI__page__{assetType}__{16-hex-char-hash}--
 */
export const makePageBundleVersionPlaceholder = (assetType: string, inputPath: string): string => {
  const inputPathHash = createHash("sha1").update(inputPath).digest("hex").slice(0, 16);
  return `--YETI__page__${assetType}__${inputPathHash}--`;
};
