/**
 * Creates a placeholder token for a bundle's version query param.
 * These placeholders are inserted into bundle src attribute values during page compilation,
 * then replaced with the actual content hash in the eleventy.after hook.
 *
 * Format: --YETI__{assetType}__{bundleName}--
 */
export const makeBundleVersionPlaceholder = (assetType: string, bundleName: string): string =>
  encodeURIComponent(`--YETI__${assetType}__${bundleName}--`);
