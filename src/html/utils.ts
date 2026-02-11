import { YETI_NODE_TYPE, type YetiNode } from "./types.ts";

export const isPrimitiveValue = (value: unknown): value is null | string | number | boolean | bigint | symbol | undefined => {
  return (
    value === null ||
    (typeof value !== "object" &&
      typeof value !== "function")
  );
};

export const DYNAMIC_VALUE_PLACEHOLDER_PREFIX = "\x00";
// 1 for the prefix and 1 for the encoded index
export const DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH = 2;

export const makeDynamicValuePlaceholder = (index: number): string => {
  if (index < 0 || index > 0xFFFF) {
    throw new Error("Dynamic value index out of bounds (must be between 0 and 65535)");
  }

  // Packing the index as a single character to keep the placeholder short.
  // NOTE: This limits us to 65536 dynamic values in a single template.
  const encodedIndex = String.fromCharCode(index);
  return `${DYNAMIC_VALUE_PLACEHOLDER_PREFIX}${encodedIndex}`;
}

export const isLetter = (char: string): boolean => {
  // Fancy bitwise trick to check if char is in [A-Za-z].
  // 1. The only difference between uppercase and lowercase letters in ASCII
  //    is the 6th bit (32). By ORing with 32, we convert uppercase letters
  //    to lowercase.
  // 2. Now that we're converted to lowercase, we can subtract 97, the code point for lowercase 'a',
  //    to normalize to so that 'a' is 0 and 'z' is 25.
  // 3. Masking with 0xFF ensures we only look at the lowest 8 bits to get rid of any negative values (ie, characters with code points < 97).
  // 4. Finally, we check if the result is less than 26 to see if it's in the range of lowercase letters.
  return (((char.charCodeAt(0) | 32) - 97) & 0xFF) < 26;
};

export const isDigit = (char: string): boolean => {
  return ((char.charCodeAt(0) - 48) & 0xFF) < 10; // '0' to '9'
};

export const isWhiteSpace = (char: string): boolean => {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v";
};

export const isValidHTMLTagNameChar = (char: string): boolean => {
  return isLetter(char) || isDigit(char) || char === "-" || char === ":";
};

export const isValidHTMLTagName = (tagName: string): boolean => {
  if (tagName.length === 0) {
    return false;
  }

  // First character must be a letter
  if (!isLetter(tagName[0])) {
    return false;
  }

  // Subsequent characters can be letters, digits, "-", or ":"
  for (let i = 1; i < tagName.length; i++) {
    const char = tagName[i];
    if (!isValidHTMLTagNameChar(char)) {
      return false;
    }
  }

  return true;
};

export const isValidHTMLAttributeNameChar = (char: string): boolean => {
  return !isWhiteSpace(char) && char !== "=" && char !== "/" && char !== ">";
};

export const isValidHTMLAttributeName = (attrName: string): boolean => {
  if (attrName.length === 0) {
    return false;
  }

  for (let i = 0; i < attrName.length; i++) {
    const char = attrName[i];
    if (!isValidHTMLAttributeNameChar(char)) {
      return false;
    }
  }

  return true;
};

const VOID_TAG_SET = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export const isVoidTag = (tagName: string) => VOID_TAG_SET.has(tagName.toLowerCase());

const sanitizedHTMLEscapeCharMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const sanitizeHTMLTextContent = (text: string): string => {
  let sanitizedText = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    sanitizedText += sanitizedHTMLEscapeCharMap[char] ?? char;
  }
  return sanitizedText;
};

const yetiNodeTypes = new Set<number>(Object.values(YETI_NODE_TYPE));

export const isYetiNode = (value: unknown): value is YetiNode => {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "number" && yetiNodeTypes.has(value.type);
}