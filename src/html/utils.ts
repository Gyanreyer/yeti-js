import { YETI_NODE_TYPE, type YetiNode } from "./types.ts";

export const isPrimitiveValue = (value: unknown): value is null | string | number | boolean | bigint | symbol | undefined => {
  return (
    value === null ||
    (typeof value !== "object" &&
      typeof value !== "function")
  );
};

export const CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER = 0;
// 1 byte for the placeholder char code + 2 bytes for the value index
export const DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH = 3;

export const getDynamicValuePlaceholderByteSequence = (index: number): [number, number, number] => {
  const highByte = (index >> 8) & 0xFF;
  const lowByte = index & 0xFF;

  // We use a 3-byte sequence to store the full index so that we can support up to 65536
  // dynamic values in a single template instead of being limited to 256 by using only 2 bytes.
  return [CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER, highByte, lowByte];
};

export const parseDynamicValueByteSequenceIndex = (byteSequence: Uint8Array): number | null => {
  if (byteSequence.length !== 3 || byteSequence[0] !== CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER) {
    return null;
  }

  const highByte = byteSequence[1];
  const lowByte = byteSequence[2];

  return (highByte << 8) | lowByte;
};

export const createDynamicValuePlaceholderString = (index: number): string => {
  if (index < 0 || index > 0xFFFF) {
    throw new Error("Dynamic value index out of bounds (must be between 0 and 65535)");
  }

  const byteSequence = getDynamicValuePlaceholderByteSequence(index);
  return textDecoder.decode(new Uint8Array(byteSequence));
};

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export const DOCTYPE_STRING_CHAR_CODE_SEQUENCE = textEncoder.encode("DOCTYPE");

export const CHAR_CODE_LT = 60; // <
export const CHAR_CODE_GT = 62; // >
export const CHAR_CODE_SLASH = 47; // /
export const CHAR_CODE_BACKSLASH = 92; // \
export const CHAR_CODE_EXCLAMATION = 33; // !
export const CHAR_CODE_DASH = 45; // -
export const CHAR_CODE_EQUAL = 61; // =
export const CHAR_CODE_DOUBLE_QUOTE = 34; // "
export const CHAR_CODE_SINGLE_QUOTE = 39; // '
export const CHAR_CODE_BACKTICK = 96; // `
export const CHAR_CODE_DOT = 46; // .
export const CHAR_CODE_COLON = 58; // :
export const CHAR_CODE_SPACE = 32; // space
export const CHAR_CODE_TAB = 9; // tab
export const CHAR_CODE_NEWLINE = 10; // newline
export const CHAR_CODE_CARRIAGE_RETURN = 13; // carriage return
export const CHAR_CODE_FORM_FEED = 12; // form feed
export const CHAR_CODE_VERTICAL_TAB = 11; // vertical tab

export const calculateStringByteLength = (str: string): number => {
  const strLength = str.length;
  let byteLength = 0;

  for (let i = 0; i < strLength; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode < 0x80) {
      // ASCII characters take 1 byte
      byteLength += 1;
    } else if (charCode < 0x800) {
      // Characters from U+0080 to U+07FF take 2 bytes
      byteLength += 2;
    } else if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      // Surrogate pair of 2 16-bit code units representing a single Unicode code point
      // takes 4 bytes in UTF-8
      byteLength += 4;
      i++; // Skip the next code unit since it's part of the surrogate pair
    } else {
      // All other characters take 3 bytes
      byteLength += 3;
    }
  }

  return byteLength;
}

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

export const isValidHTMLTagNameString = (tagNameStr: string): boolean => {
  const strLen = tagNameStr.length;

  if (strLen === 0) {
    return false;
  }

  // First character must be a letter
  if (!isLetterCharCode(tagNameStr.charCodeAt(0))) {
    return false;
  }


  // Subsequent characters can be letters, digits, "-", or ":"
  for (let i = 1; i < strLen; i++) {
    if (!isValidHTMLTagNameCharCode(tagNameStr.charCodeAt(i))) {
      return false;
    }
  }

  return true;
};

export const isValidHTMLAttributeNameCharCode = (charCode: number): boolean => {
  return !isWhiteSpaceCharCode(charCode) && charCode !== CHAR_CODE_EQUAL && charCode !== CHAR_CODE_GT && charCode !== CHAR_CODE_SLASH;
};

export const isValidHTMLAttributeNameString = (attrNameStr: string): boolean => {
  const strLen = attrNameStr.length;
  if (strLen === 0) {
    return false;
  }

  for (let i = 0; i < strLen; i++) {
    if (i === 0 && attrNameStr.charCodeAt(i) === CHAR_CODE_EQUAL) {
      // Special case to allow "=" as the first letter in an attribute name because this is technically in the HTML spec
      continue;
    }
    if (!isValidHTMLAttributeNameCharCode(attrNameStr.charCodeAt(i))) {
      return false;
    }
  }

  return true;
};


export const doCharCodeSequencesMatch = (
  sequence1: Uint8Array,
  sequence2: Uint8Array,
): boolean => {
  debugger;
  const sequence1Length = sequence1.length;
  if (sequence1Length !== sequence2.length) {
    return false;
  }

  for (let i = 0; i < sequence1Length; i++) {
    if (sequence1[i] !== sequence2[i]) {
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

export type RawStringContentTagName = "script" | "style" | "textarea" | "title";

const RAW_STRING_CONTENTS_HTML_TAG_SET = new Set([
  "script",
  "style",
  "textarea",
  "title",
]);

export const isRawStringContentTag = (tagName: string): tagName is RawStringContentTagName => RAW_STRING_CONTENTS_HTML_TAG_SET.has(tagName.toLowerCase());

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
