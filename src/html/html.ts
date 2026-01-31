import { parseHTML } from './parseHTML.ts';
import { isPrimitiveValue, makeDynamicValuePlaceholder } from './utils.ts';
import { YetiNode } from './types.ts';

export const html = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<YetiNode[]> => {
  let htmlString = "";
  for (let i = 0; i < strings.length; i++) {
    htmlString += strings[i];
    if (i < values.length) {
      htmlString += makeDynamicValuePlaceholder(i);
    }
  }

  return parseHTML(htmlString, values);
};