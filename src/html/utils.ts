import { YETI_NODE_TYPE, type YetiNode } from "./types.ts";

export const isPrimitiveValue = (value: unknown): value is null | string | number | boolean | bigint | symbol | undefined => {
  return (
    value === null ||
    (typeof value !== "object" &&
      typeof value !== "function")
  );
};

export const CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER = 0;
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

export const CHAR_CODE_LT = 60; // <
export const CHAR_CODE_GT = 62; // >
export const CHAR_CODE_SLASH = 47; // /
export const CHAR_CODE_BACKSLASH = 92; // \
export const CHAR_CODE_EXCLAMATION = 33; // !
export const CHAR_CODE_DASH = 45; // -
export const CHAR_CODE_EQUAL = 61; // =
export const CHAR_CODE_DOUBLE_QUOTE = 34; // "
export const CHAR_CODE_SINGLE_QUOTE = 39; // '
export const CHAR_CODE_DOT = 46; // .
export const CHAR_CODE_COLON = 58; // :
export const CHAR_CODE_SPACE = 32; // space
export const CHAR_CODE_TAB = 9; // tab
export const CHAR_CODE_NEWLINE = 10; // newline
export const CHAR_CODE_CARRIAGE_RETURN = 13; // carriage return
export const CHAR_CODE_FORM_FEED = 12; // form feed
export const CHAR_CODE_VERTICAL_TAB = 11; // vertical tab

export const isLetterCharCode = (charCode: number): boolean => {
  // Fancy bitwise trick to check if char is in [A-Za-z].
  // 1. The only difference between uppercase and lowercase letters in ASCII
  //    is the 6th bit (32). By ORing with 32, we convert uppercase letters
  //    to lowercase.
  // 2. Now that we're converted to lowercase, we can subtract 97, the code point for lowercase 'a',
  //    to normalize to so that 'a' is 0 and 'z' is 25.
  // 3. Masking with 0xFF ensures we only look at the lowest 8 bits to get rid of any negative values (ie, characters with code points < 97).
  // 4. Finally, we check if the result is less than 26 to see if it's in the range of lowercase letters.
  return (((charCode | 32) - 97) & 0xFF) < 26;
};

export const isDigitCharCode = (charCode: number): boolean => {
  return ((charCode - 48) & 0xFF) < 10; // '0' to '9'
};

export const isWhiteSpaceCharCode = (charCode: number): boolean => {
  // Check for space, tab, newline, carriage return, form feed, or vertical tab
  return (
    charCode === CHAR_CODE_SPACE ||
    charCode === CHAR_CODE_TAB ||
    charCode === CHAR_CODE_NEWLINE ||
    charCode === CHAR_CODE_CARRIAGE_RETURN ||
    charCode === CHAR_CODE_FORM_FEED ||
    charCode === CHAR_CODE_VERTICAL_TAB
  );
};


export const isValidHTMLTagNameCharCode = (charCode: number): boolean => {
  return isLetterCharCode(charCode) || (charCode >= 48 && charCode <= 57) || charCode === CHAR_CODE_DASH || charCode === CHAR_CODE_COLON;
}

export const isValidHTMLTagNameCharCodeArray = (charCodes: number[]): boolean => {
  if (charCodes.length === 0) {
    return false;
  }

  // First character must be a letter
  if (!isLetterCharCode(charCodes[0])) {
    return false;
  }

  // Subsequent characters can be letters, digits, "-", or ":"
  for (let i = 1; i < charCodes.length; i++) {
    if (!isValidHTMLTagNameCharCode(charCodes[i])) {
      return false;
    }
  }

  return true;
};

export const isValidHTMLAttributeNameCharCode = (charCode: number): boolean => {
  return !isWhiteSpaceCharCode(charCode) && charCode !== CHAR_CODE_EQUAL && charCode !== CHAR_CODE_GT && charCode !== CHAR_CODE_SLASH;
};

export const isValidHTMLAttributeNameCharCodeArray = (attrNameCharCodes: number[]): boolean => {
  if (attrNameCharCodes.length === 0) {
    return false;
  }

  for (let i = 0; i < attrNameCharCodes.length; i++) {
    if (!isValidHTMLAttributeNameCharCode(attrNameCharCodes[i])) {
      return false;
    }
  }

  return true;
};

export const appendToCharCodeArray = (charCodes: number[], str: string): void => {
  const strLen = str.length;
  for (let i = 0; i < strLen; i++) {
    charCodes.push(str.charCodeAt(i));
  }
};

export const stringToUint16CharCodeArray = (str: string): Uint16Array => {
  const strLen = str.length;
  const charCodes = new Uint16Array(strLen);
  for (let i = 0; i < strLen; i++) {
    charCodes[i] = str.charCodeAt(i);
  }
  return charCodes;
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
