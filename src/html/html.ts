import { parseHTML } from './parseHTML.ts';
import { calculateStringByteLength, DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH, getDynamicValuePlaceholderByteSequence, textEncoder } from './utils.ts';
import type { YetiRootNode } from './types.ts';
import {
  assetTypeSymbol,
  bundleNameSymbol,
  bundleTypeSymbol,
  importFilePathSymbol,
  inlinedBundleContentTypeSymbol,
  resolveImportPath,
  shouldEscapeHTMLSymbol,
  WILDCARD_BUNDLE_NAME,
} from '../bundle.js';
import type { HTMLImportObject, InlinedHTMLBundleContentObject } from '../types.ts';

export const html = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<YetiRootNode> => {
  const stringsCount = strings.length;
  const valuesCount = values.length;

  // Pre-calculate the total length of the combined string with dynamic value placeholders
  // to optimize memory allocation.
  let totalByteLength = 0;
  for (let i = 0; i < stringsCount; i++) {
    totalByteLength += calculateStringByteLength(strings[i]);
    if (i < valuesCount) {
      totalByteLength += DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH;
    }
  }

  const textCharBuffer = new Uint8Array(totalByteLength);

  // Use a map to de-dupe dynamic values and assign them unique indices for placeholders
  const uniqueValuesIndexMap = new Map<unknown, number>();
  const dynamicValues = [];

  let offset = 0;

  for (let i = 0; i < stringsCount; i++) {
    const str = strings[i];

    const { written } = textEncoder.encodeInto(str, textCharBuffer.subarray(offset));
    offset += written;

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

  return parseHTML(textCharBuffer, dynamicValues);
};

html.import = (importPath: string, options: {
  escape?: boolean | undefined;
  bundleName?: string | undefined;
} = {}): HTMLImportObject => {
  const { escape = false, bundleName } = options;

  if (bundleName !== undefined && typeof bundleName !== "string") {
    throw new Error(`html.import() expected bundleName option to be a string if provided. Received type "${typeof bundleName}".`);
  } else if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`html.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  try {
    const resolvedFilePath = resolveImportPath(importPath);
    return {
      [importFilePathSymbol]: resolvedFilePath,
      [shouldEscapeHTMLSymbol]: escape,
      [assetTypeSymbol]: "html",
      [bundleTypeSymbol]: "import",
      [bundleNameSymbol]: bundleName,
    };
  } catch (err) {
    throw new Error(`html.import() failed to resolve path to file at "${importPath}"`, {
      cause: err,
    });
  }
}

html.inline = <TBundleName extends string>(bundleName: TBundleName): InlinedHTMLBundleContentObject<TBundleName> => ({
  [inlinedBundleContentTypeSymbol]: "html",
  [bundleNameSymbol]: bundleName,
});