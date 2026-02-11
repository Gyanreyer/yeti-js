import { parseHTML } from './parseHTML.ts';
import { makeDynamicValuePlaceholder } from './utils.ts';
import { YetiRootNode } from './types.ts';

export const html = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<YetiRootNode> => {
  let htmlString = "";
  // Use a map to de-dupe dynamic values and assign them unique indices for placeholders
  const uniqueValuesIndexMap = new Map<unknown, number>();
  const dynamicValues = [];

  for (let i = 0; i < strings.length; i++) {
    htmlString += strings[i];
    if (i < values.length) {
      const value = values[i];
      let valueIndex = uniqueValuesIndexMap.get(value);
      if (valueIndex === undefined) {
        valueIndex = dynamicValues.push(value) - 1;
        uniqueValuesIndexMap.set(value, valueIndex);
      }

      htmlString += makeDynamicValuePlaceholder(valueIndex);
    }
  }

  return parseHTML(htmlString, dynamicValues);
};