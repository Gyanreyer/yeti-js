import { parseHTML } from './parseHTML.ts';
import { CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER } from './utils.ts';
import type { YetiRootNode } from './types.ts';

export const html = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<YetiRootNode> => {
  const stringsCount = strings.length;
  const valuesCount = values.length;

  // Pre-calculate the total length of the combined string with dynamic value placeholders
  // to optimize memory allocation.
  let totalLength = 0;
  for (let i = 0; i < stringsCount; i++) {
    totalLength += strings[i].length;
    if (i < valuesCount) {
      // Each dynamic value placeholder is represented by 2 char codes
      totalLength += 2;
    }
  }

  const htmlStringChars = new Uint16Array(totalLength);

  // Use a map to de-dupe dynamic values and assign them unique indices for placeholders
  const uniqueValuesIndexMap = new Map<unknown, number>();
  const dynamicValues = [];

  let offset = 0;

  for (let i = 0; i < stringsCount; i++) {
    const str = strings[i];
    const strLen = str.length;

    for (let charIndex = 0; charIndex < strLen; charIndex++) {
      htmlStringChars[offset++] = str.charCodeAt(charIndex);
    }
    if (i < valuesCount) {
      const value = values[i];
      let valueIndex = uniqueValuesIndexMap.get(value);
      if (valueIndex === undefined) {
        valueIndex = dynamicValues.push(value) - 1;
        uniqueValuesIndexMap.set(value, valueIndex);
      }

      // Dynamic value placeholders are represented as a character sequence:
      // [CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER, valueIndex]
      htmlStringChars[offset++] = CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER;
      htmlStringChars[offset++] = valueIndex;
    }
  }

  return parseHTML(htmlStringChars, dynamicValues);
};