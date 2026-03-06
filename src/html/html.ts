import { getCallSites } from 'node:util';
import { fileURLToPath } from 'node:url';

import { parseHTML } from './parseHTML.ts';
import { DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH, getDynamicValuePlaceholderByteSequence } from './utils.ts';
import { textEncoder } from '../utils/textEncoder.ts';
import type { YetiRootNode } from './types.ts';
import { WILDCARD_BUNDLE_NAME, type HTMLBundleImportObject, makeBundleSrcObject, makeHTMLBundleInlineObject, makeHTMLBundleImportObject } from '../bundle/bundle.ts';
import { resolveImportPath } from '../bundle/import.ts';

// Tagged template literals reuse the same strings array reference across calls (per ECMAScript spec).
// Both caches below are keyed on that reference, so their entries are computed once per unique
// template literal in source and reused on every subsequent render.

// Caches the call site URL (avoiding a V8 stack walk on every html`` invocation).
const callSiteCache = new WeakMap<TemplateStringsArray, string | undefined>();

type CachedTemplateStatics = {
  // Pre-encoded UTF-8 bytes for each static string segment between interpolations.
  // Avoids re-encoding (and re-scanning for byte length) on every render.
  encodedStrings: ReadonlyArray<Uint8Array>;
  // Total byte length of the buffer needed: sum of encoded string lengths +
  // one 3-byte placeholder sequence per dynamic value slot.
  totalByteLength: number;
};
// Caches per-template static encoding work (byte-length calculation + UTF-8 encoding).
const templateStaticsCache = new WeakMap<TemplateStringsArray, CachedTemplateStatics>();

export const html = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<YetiRootNode> => {
  // Get the file URL of the file which called this html template tag
  // so we can use it for dependency tracking
  let parentCallSiteURL: string | undefined;
  if (callSiteCache.has(strings)) {
    parentCallSiteURL = callSiteCache.get(strings);
  } else {
    parentCallSiteURL = getCallSites()[1]?.scriptName;
    callSiteCache.set(strings, parentCallSiteURL);
  }

  let statics = templateStaticsCache.get(strings);
  if (!statics) {
    const encodedStrings = Array.from(strings, s => textEncoder.encode(s));
    const totalByteLength =
      encodedStrings.reduce((sum, b) => sum + b.byteLength, 0) +
      (strings.length - 1) * DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH;
    statics = { encodedStrings, totalByteLength };
    templateStaticsCache.set(strings, statics);
  }

  const valuesCount = values.length;
  const textCharBuffer = new Uint8Array(statics.totalByteLength);

  // Use a map to de-dupe dynamic values and assign them unique indices for placeholders
  const uniqueValuesIndexMap = new Map<unknown, number>();
  const dynamicValues = [];

  let offset = 0;

  for (let i = 0; i < statics.encodedStrings.length; i++) {
    const encodedString = statics.encodedStrings[i];
    textCharBuffer.set(encodedString, offset);
    offset += encodedString.byteLength;

    if (i < valuesCount) {
      const value = values[i];
      let valueIndex = uniqueValuesIndexMap.get(value);
      if (valueIndex === undefined) {
        valueIndex = dynamicValues.push(value) - 1;
        uniqueValuesIndexMap.set(value, valueIndex);
      }

      // Dynamic value placeholders are represented as a character sequence:
      // [CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER, valueIndex]
      textCharBuffer.set(getDynamicValuePlaceholderByteSequence(valueIndex), offset);
      offset += DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH;
    }
  }

  const parsedRoot = await parseHTML(textCharBuffer, dynamicValues);

  if (parentCallSiteURL) {
    const callerFilePath = fileURLToPath(parentCallSiteURL);
    parsedRoot.assets ??= {};
    parsedRoot.assets.html ??= {};
    parsedRoot.assets.html.dependencies ??= new Set<string>();
    parsedRoot.assets.html.dependencies.add(callerFilePath);
  }

  return parsedRoot;
};

html.import = (importPath: string, options: {
  shouldEscape?: boolean | undefined;
  bundleName?: string | undefined;
} = {}): HTMLBundleImportObject => {
  const { shouldEscape = false, bundleName } = options;

  if (bundleName !== undefined && typeof bundleName !== "string") {
    throw new Error(`html.import() expected bundleName option to be a string if provided. Received type "${typeof bundleName}".`);
  } else if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`html.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return makeHTMLBundleImportObject(resolvedFilePath, bundleName, { shouldEscape });
  } catch (err) {
    throw new Error(`html.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
};

html.inline = <TBundleName extends string>(bundleName: TBundleName, options?: { shouldEscape?: boolean }) => makeHTMLBundleInlineObject(bundleName, options);

html.src = <TBundleName extends string>(bundleName: TBundleName, transformSrc?: (src: string) => string) => makeBundleSrcObject("html", bundleName, {
  transformSrc,
});