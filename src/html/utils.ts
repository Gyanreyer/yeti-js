import { YETI_NODE_TYPE, type YetiElementNode, type YetiRootNode, type YetiNode } from "./types.ts";
import { textEncoder } from "../utils/textEncoder.ts";

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
export const CHAR_CODE_AMPERSAND = 38; // &
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

  // Must be at least one character and the first character must be a letter
  if (strLen === 0 || !isLetterCharCode(tagNameStr.charCodeAt(0))) {
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
  // Buffer.compare returns 0 if the sequences are equal
  return Buffer.compare(sequence1, sequence2) === 0;
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

const PRESERVE_WHITESPACE_TAGNAMES = new Set(["pre", "textarea"]);

export const isPreserveWhitespaceTag = (tagName: string): boolean => PRESERVE_WHITESPACE_TAGNAMES.has(tagName.toLowerCase());

const sanitizedHTMLEscapeCharMap: Record<number, string> = {
  [CHAR_CODE_AMPERSAND]: "&amp;",
  [CHAR_CODE_LT]: "&lt;",
  [CHAR_CODE_GT]: "&gt;",
  [CHAR_CODE_DOUBLE_QUOTE]: "&quot;",
  [CHAR_CODE_SINGLE_QUOTE]: "&#39;",
};


export const sanitizeHTMLTextContent = (text: string): string => {
  let sanitizedText = "";
  let lastIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charCode = char.charCodeAt(0);
    if (charCode in sanitizedHTMLEscapeCharMap) {
      sanitizedText += text.slice(lastIndex, i) + sanitizedHTMLEscapeCharMap[charCode];
      lastIndex = i + 1;
    }
  }
  if (lastIndex === 0) {
    return text;
  }

  return `${sanitizedText}${text.slice(lastIndex)}`;
};

const yetiNodeTypes = new Set(Object.values(YETI_NODE_TYPE));

export const isYetiNode = (value: unknown): value is YetiNode => {
  return typeof value === "object" && value !== null && "type" in value && yetiNodeTypes.has(value.type as any);
}

/**
 * Collapses consecutive whitespace characters in a string into a single character.
 * If the consecutive whitespace includes a newline character, it collapses to a single newline character.
 * Otherwise, it collapses to a single space character.
 * 
 * @example
 * collapseWhitespace("Hello   World") // returns "Hello World"
 * collapseWhitespace("Line 1\n\nLine 2") // returns "Line 1\nLine 2"
 * collapseWhitespace("   Leading and trailing whitespace   ") // returns " Leading and trailing whitespace "
 */
export const collapseWhitespace = (str: string): string => {
  let result = "";
  let currentChunkStartIndex = 0;
  let currentChunkLength = 0;

  let isInWhitespace = false;
  let doesWhitespaceIncludeNewlines = false;

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (isWhiteSpaceCharCode(charCode)) {
      isInWhitespace = true;
      if (charCode === CHAR_CODE_NEWLINE) {
        doesWhitespaceIncludeNewlines = true;
      }

      if (currentChunkLength > 0) {
        result += str.slice(currentChunkStartIndex, currentChunkStartIndex + currentChunkLength);
        currentChunkLength = 0;
      }

      currentChunkStartIndex = i + 1;
    } else {
      if (isInWhitespace) {
        // If we were in whitespace and encounter a non-whitespace character, add a single space before the
        // next chunk of non-whitespace characters
        result += doesWhitespaceIncludeNewlines ? "\n" : " ";
        isInWhitespace = false;
        doesWhitespaceIncludeNewlines = false;
      }
      currentChunkLength++;
    }
  }

  if (currentChunkLength > 0) {
    result += str.slice(currentChunkStartIndex, currentChunkStartIndex + currentChunkLength);
  } else if (isInWhitespace) {
    // If the string ends with whitespace, add a single space at the end
    result += doesWhitespaceIncludeNewlines ? "\n" : " ";
  }

  return result;
};

/**
 * Cleans up whitespace in a node's children.
 * 1. Collapses whitespace sequences into a single character.
 * 2. Trims leading and trailing whitespace between an element node's opening/closing tags and its children.
 * 3. Removes empty text nodes that may be left over after trimming.
 */
export const cleanUpChildWhitespace = (node: YetiRootNode | YetiElementNode): void => {
  if (!node.children) {
    return;
  }

  const isElementNode = node.type === YETI_NODE_TYPE.ELEMENT;

  // Leading and trailing whitespace can be trimmed as long as the parent isn't a whitespace-significant tag like <pre> or <textarea>.
  const canTrimWhiteSpace = !isElementNode || !isPreserveWhitespaceTag(node.tagName);
  // Intermediate whitespace can be collapsed to a single space/line break as long as the parent isn't a whitespace-significant tag like <pre> or <textarea>,
  // and also isn't a raw text content tag like <script> or <style> where whitespace should be preserved but leading/trailing whitespace can still be trimmed.
  const shouldCollapseWhiteSpace = canTrimWhiteSpace && (!isElementNode || !isRawStringContentTag(node.tagName));

  let childCount = node.children.length;
  for (let i = 0; i < childCount; i++) {
    const child = node.children[i];
    if (child.type !== YETI_NODE_TYPE.TEXT) {
      // Skip non-text nodes
      continue;
    }

    if (canTrimWhiteSpace) {
      if (i === 0) {
        child.content = child.content.trimStart();
      }
      if (i === childCount - 1) {
        child.content = child.content.trimEnd();
      }
    }

    if (shouldCollapseWhiteSpace) {
      child.content = collapseWhitespace(child.content);
    }

    if (child.content === "" || child.content === "\n") {
      // If the text node is now empty after trimming, remove it from the children array to
      // avoid unnecessary empty text nodes in the tree
      node.children.splice(i, 1);
      i--;
      childCount--;
      continue;
    }
  }

  if (isElementNode && node.children?.length === 0) {
    // Delete the children array if it's empty now
    delete node.children;
  }
};

export const sanitizeAttributeValue = (value: unknown): string => {
  const stringValue = typeof value === "string" ? value : String(value);
  return sanitizeHTMLTextContent(stringValue);
};