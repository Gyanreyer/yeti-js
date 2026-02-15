import {
  CHAR_CODE_BACKSLASH,
  CHAR_CODE_DASH,
  CHAR_CODE_DOT,
  CHAR_CODE_DOUBLE_QUOTE,
  CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER,
  CHAR_CODE_EQUAL,
  CHAR_CODE_EXCLAMATION,
  CHAR_CODE_GT,
  CHAR_CODE_LT,
  CHAR_CODE_SINGLE_QUOTE,
  CHAR_CODE_SLASH,
  isLetterCharCode,
  isValidHTMLTagNameCharCode,
  isWhiteSpaceCharCode,
  isValidHTMLTagNameString,
  isValidHTMLAttributeNameString,
  doCharCodeSequencesMatch,
  DOCTYPE_STRING_CHAR_CODE_SEQUENCE,
  textDecoder,
  parseDynamicValueByteSequenceIndex,
  DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH,
  isRawStringContentTag,
  type RawStringContentTagName,
  CHAR_CODE_BACKTICK,
} from "./utils.ts";
import { YetiHTMLParsingError } from "./error.ts";

export const TOKEN_TYPE = {
  ERROR: 0,
  CHILD_CONTENT: 10,
  OPENING_TAGNAME: 20,
  OPENING_TAG_END: 21,
  CLOSING_TAGNAME: 26,
  ATTR_NAME: 30,
  ATTR_VALUE: 31,
  SPREAD_ATTR: 32,
  COMMENT: 40,
  DOCTYPE: 50,
} as const satisfies Record<string, number>;

type LexerTokenName = keyof typeof TOKEN_TYPE;
type LexerTokenType = typeof TOKEN_TYPE[LexerTokenName];

type LexerTokenValueTypeMap = {
  [TOKEN_TYPE.ERROR]: YetiHTMLParsingError;
  [TOKEN_TYPE.CHILD_CONTENT]: unknown; // Can be a string or a raw dynamic value
  [TOKEN_TYPE.OPENING_TAG_END]: boolean; // Whether the opening tag is self-closing or not (i.e., whether we lexed a "/>" or a ">")
  [TOKEN_TYPE.OPENING_TAGNAME]: string | Function; // A tag name can be a string or a function placeholder for components
  [TOKEN_TYPE.CLOSING_TAGNAME]: string | Function; // A tag name can be a string or a function placeholder for components
  [TOKEN_TYPE.ATTR_NAME]: string; // Should be a string, but we allow dynamic values that resolve to strings
  [TOKEN_TYPE.ATTR_VALUE]: unknown; // Can be a string or a raw dynamic value
  [TOKEN_TYPE.SPREAD_ATTR]: unknown; // A raw dynamic value representing the object to spread
  [TOKEN_TYPE.COMMENT]: string; // Should be a string, but we allow dynamic values that resolve to strings
  [TOKEN_TYPE.DOCTYPE]: string;
};

// Using a distributive conditional type to create a union of properly typed tuples where the
// first item is a token type and the second item is the corresponding value type for that token.
export type LexerToken<T extends LexerTokenType = LexerTokenType> = T extends T ? [T, LexerTokenValueTypeMap[T]] : never;

const NO_DYNAMIC_VALUE = Symbol("NO_DYNAMIC_VALUE");

type LexerContext = {
  /**
   * Peeks ahead to a single char code in the input string without advancing the current position.
   *
   * @param {number} [peekOffset=0] - The number of characters to offset from the current position for the peek.
   *
   * @example
   * ```ts
   * ctx.peekCharCode(); // Peeks the next character from the current position
   * ctx.peekCharCode(5); // Peeks the character 5 characters from the current position
   * ```
   */
  peekCharCode(peekOffset?: number): number;
  getIndex(): number;
  getSubarray(startIndex: number, length: number): Uint8Array;
  getSubstring(startIndex: number, length: number): string;
  /**
   * Peeks ahead to check for a dynamic value placeholder and returns metadata for the corresponding dynamic value if found.
   *
   * @param {number} [peekOffset=0] - The number of characters to offset from the current position for the peek.
   * @returns The dynamic value, or NO_DYNAMIC_VALUE symbol if no dynamic value placeholder is found.
   */
  peekDynamicValue(peekOffset?: number): unknown | typeof NO_DYNAMIC_VALUE;
  /**
   * Advances the current position index by a given length.
   * Returns the new position index.
   */
  advance(advanceLength?: number): number;
  isAtEnd(): boolean;
  // We need to track whether we're lexing inside a raw text element (e.g., <script>, <style>, <textarea>) so that we know to ignore tag-like syntax and just treat everything as text content until we reach the closing tag for that element.
  setCurrentRawTextElementTagName(value: RawStringContentTagName | null): void;
  getCurrentRawTextElementTagName(): RawStringContentTagName | null;
}

/**
 * A generator function that performs lexing and yields the next lexer function to execute, or null if lexing is complete.
 */
type LexerFunction<TTokenNames extends LexerTokenName> = (ctx: LexerContext) => Generator<LexerToken<typeof TOKEN_TYPE[TTokenNames]>, LexerFunction<any> | null, void>;

const lexTextContent: LexerFunction<"CHILD_CONTENT" | "ERROR"> = function* (ctx) {
  let nextLexerFunction: LexerFunction<any> | null = null;
  let currentChunkStartIndex = ctx.getIndex();
  let currentChunkLength = 0;

  try {
    while (!ctx.isAtEnd()) {
      // Check if we need to transition to a new lexer state. Transition options:
      // 1. Opening tag: "<" + letter
      // 2. Component tag: "<" + FUNCTION_PLACEHOLDER_PREFIX (3 characters long)
      // 3. Closing tag: "</"
      // 4. Comment: "<!--"
      // 5. Doctype: "<!DOCTYPE"
      const nextCharCode = ctx.peekCharCode();
      if (nextCharCode === CHAR_CODE_LT) {
        const followingCharCode = ctx.peekCharCode(1);
        // We need to peek up to 8 characters ahead to test if we're matching a doctype tag
        if (followingCharCode === CHAR_CODE_EXCLAMATION) {
          if (ctx.peekCharCode(2) === CHAR_CODE_DASH && ctx.peekCharCode(3) === CHAR_CODE_DASH) {
            // Matches "<!--", transition to comment
            nextLexerFunction = lexComment;
            break;
          }

          if (
            // Test if next 6 chars after "<!" match "DOCTYPE"
            doCharCodeSequencesMatch(ctx.getSubarray(2, 7), DOCTYPE_STRING_CHAR_CODE_SEQUENCE)) {
            // Matches "<!DOCTYPE", transition to doctype
            nextLexerFunction = lexDoctype;
            break;
          }
        } else {
          if (followingCharCode === CHAR_CODE_SLASH) {
            // Matches "</", transition to closing tag
            nextLexerFunction = lexClosingTag;
            break;
          }

          if (isLetterCharCode(followingCharCode)) {
            // Matches "<" + letter, transition to opening tag
            nextLexerFunction = lexOpeningTagname;
            break;
          }

          if (followingCharCode === CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER) {
            // We hit a dynamic value placeholder after "<", which could be either a component tag
            // (if the dynamic value is a function) or an element tag with a dynamic string tag name
            // (if the dynamic value is a string that starts with a letter).
            // In either case, we can transition to lexOpeningTagname and let that lexer function handle it from there.
            const dynamicValue = ctx.peekDynamicValue(1);
            if (
              // `<${function}` => component tag
              typeof dynamicValue === "function" ||
              // `<${string}` => element tag with dynamic string tag name (unless the string is empty or starts with a non-letter,
              // in which case we can just proceed and treat it as text content)
              (typeof dynamicValue === "string" && dynamicValue.length > 0 && isLetterCharCode(dynamicValue.charCodeAt(0)))
            ) {
              // Transition to lex opening tagname; the lexer will consume the dynamic value.
              // If the dynamic value is a function, the token will just be `{ ty: OPENING_TAGNAME, v: [Function] }`,
              // and the parser can handle it from there.
              nextLexerFunction = lexOpeningTagname;
              break;
            }
          }
        }
      } else {
        const dynamicValue = ctx.peekDynamicValue();
        if (dynamicValue !== NO_DYNAMIC_VALUE) {
          if (currentChunkLength > 0) {
            // If we have accumulated any text content before this dynamic value,
            // we need to resolve that character chunk and yield it before yielding the dynamic value.
            yield [TOKEN_TYPE.CHILD_CONTENT, ctx.getSubstring(
              currentChunkStartIndex,
              currentChunkLength,
            )];
          }
          // Emit the raw dynamic value as a child content token; the parser can handle it from there
          // if we want to unwrap iterables, promises, inlined functions, etc
          yield [TOKEN_TYPE.CHILD_CONTENT, dynamicValue];

          // Advance past the dynamic value character sequence
          currentChunkStartIndex = ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
          currentChunkLength = 0;
          continue;
        }
      }

      // We didn't find a transition point, so just consume the next character as text content
      currentChunkLength++;
      ctx.advance(1);
    }

    if (currentChunkLength > 0) {
      // Skip text content token if empty
      yield [TOKEN_TYPE.CHILD_CONTENT, ctx.getSubstring(
        currentChunkStartIndex,
        currentChunkLength,
      )];
    }

    return nextLexerFunction;
  } catch (e) {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError("Encountered an unexpected error while parsing html", e instanceof Error ? {
      cause: e,
    } : undefined)];
    return null;
  }
}

const lexComment: LexerFunction<"COMMENT" | "ERROR"> = function* (ctx) {
  // Skip the opening "<!--"
  ctx.advance(4);
  let nextLexerFunction: LexerFunction<any> | null = null;

  let chunkStartIndex = ctx.getIndex();
  let chunkLength = 0;
  let stringParts: string[] | null = null;

  while (!ctx.isAtEnd()) {
    const nextCharCode = ctx.peekCharCode();
    if (nextCharCode === CHAR_CODE_DASH && ctx.peekCharCode(1) === CHAR_CODE_DASH && ctx.peekCharCode(2) === CHAR_CODE_GT) {
      nextLexerFunction = lexTextContent;
      // Consume the closing "-->"
      ctx.advance(3);
      break;
    }

    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      stringParts ??= [];
      // Flush current chunk before adding dynamic value
      if (chunkLength > 0) {
        stringParts.push(ctx.getSubstring(chunkStartIndex, chunkLength));
      }
      // Just stringify the dynamic value and include it in the comment content
      stringParts.push(String(dynamicValue));
      chunkStartIndex = ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
      chunkLength = 0;
    } else {
      chunkLength++;
      ctx.advance(1);
    }
  }

  let commentContent: string;

  // Flush final chunk
  if (chunkLength > 0) {
    const finalChunk = ctx.getSubstring(chunkStartIndex, chunkLength);
    if (stringParts === null) {
      commentContent = finalChunk;
    } else {
      stringParts.push(finalChunk);
      commentContent = stringParts.join('');
    }
  } else if (stringParts) {
    commentContent = stringParts.join('');
  } else {
    commentContent = "";
  }

  yield [TOKEN_TYPE.COMMENT, commentContent.trim()];

  return nextLexerFunction;
};

const lexDoctype: LexerFunction<"DOCTYPE" | "ERROR"> = function* (ctx) {
  // Skip the opening "<!DOCTYPE"
  ctx.advance(9);
  let nextLexerFunction: LexerFunction<any> | null = null;

  let chunkStartIndex = ctx.getIndex();
  let chunkLength = 0;
  let lastNonWhitespaceLength = 0;

  while (!ctx.isAtEnd()) {
    const nextCharCode = ctx.peekCharCode();
    if (nextCharCode === CHAR_CODE_GT) {
      nextLexerFunction = lexTextContent;
      // Consume the closing ">"
      ctx.advance(1);
      break;
    }

    if (ctx.peekDynamicValue() !== NO_DYNAMIC_VALUE) {
      yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`Dynamic values are not allowed inside DOCTYPE declarations.`)];
      return null;
    }

    if (isWhiteSpaceCharCode(nextCharCode)) {
      if (chunkLength === 0) {
        // Skip leading whitespace and shift up the chunk start index
        chunkStartIndex = ctx.advance(1);
      } else {
        // We already have some content so just keep moving but don't update
        // lastNonWhitespaceLength until we hit a non-whitespace character
        chunkLength++;
        ctx.advance(1);
      }
    } else {
      // We have a non-whitespace character, so we can update lastNonWhitespaceLength
      // to include any preceding whitespace as well
      chunkLength++;
      lastNonWhitespaceLength = chunkLength;
      ctx.advance(1);
    }
  }

  yield [TOKEN_TYPE.DOCTYPE, ctx.getSubstring(chunkStartIndex, lastNonWhitespaceLength)];
  return nextLexerFunction;
}

const lexOpeningTagname: LexerFunction<"OPENING_TAGNAME" | "ERROR"> = function* (ctx) {
  // Skip the opening "<"
  ctx.advance(1);

  let nextLexerFunction: LexerFunction<any> | null = null;
  let currentChunkStartIndex = ctx.getIndex();
  let currentChunkLength = 0;
  let stringParts: string[] | null = null;

  while (!ctx.isAtEnd()) {
    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      if (currentChunkLength === 0 && !stringParts && typeof dynamicValue === "function") {
        // If the dynamic value is a function and we haven't consumed any tag name characters yet,
        // we can treat this as a component tag. 
        ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
        // We yield the function as the tag name and transition to lexing attributes and
        // the rest of the tag as normal.
        yield [TOKEN_TYPE.OPENING_TAGNAME, dynamicValue];
        return lexAttributeName;
      }

      // If it's not a component function, we'll just coerce to a string and append it to the tag name.
      stringParts ??= [];
      if (currentChunkLength > 0) {
        // Flush current chunk before adding dynamic value
        stringParts.push(ctx.getSubstring(currentChunkStartIndex, currentChunkLength));
      }
      // If we encounter a dynamic value, we treat it as the entire tag name.
      // The parser can handle it from there.
      stringParts.push(String(dynamicValue));
      currentChunkStartIndex = ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
      currentChunkLength = 0;
    }

    const nextCharCode = ctx.peekCharCode();

    if (
      // The first letter of a tagname has to be a letter
      (currentChunkLength === 0 && !stringParts && isLetterCharCode(nextCharCode)) ||
      // All following characters can be letters, digits, hyphens, or colons
      isValidHTMLTagNameCharCode(nextCharCode)
    ) {
      currentChunkLength++;
      ctx.advance(1);
    } else if (isWhiteSpaceCharCode(nextCharCode)) {
      // Consume whitespace and transition to attribute lexing
      ctx.advance(1);
      nextLexerFunction = lexAttributeName;
      break;
    } else if (nextCharCode === CHAR_CODE_GT || (nextCharCode === CHAR_CODE_SLASH && ctx.peekCharCode(1) === CHAR_CODE_GT)) {
      // Lex the end of the opening tag and transition back to text content lexing
      nextLexerFunction = lexOpeningTagEnd;
      break;
    }
  }

  let tagName: string;

  // Flush final chunk
  if (currentChunkLength > 0) {
    const currentChunk = ctx.getSubstring(currentChunkStartIndex, currentChunkLength);
    if (!stringParts) {
      tagName = currentChunk;
    } else {
      stringParts.push(currentChunk);
      tagName = stringParts.join('');
    }
  } else if (stringParts) {
    tagName = stringParts.join('');
  } else {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname did not find any valid tag name characters.`)];
    return null;
  }

  if (!isValidHTMLTagNameString(tagName)) {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname received invalid tag name "${tagName}".`)];
    return null;
  }

  if (isRawStringContentTag(tagName)) {
    // If this tagname indicates we have an element which contains raw string content (e.g., <script>, <style>, <textarea>),
    // we need to set that in the context so we don't try to parse any child content of this element for tags.
    ctx.setCurrentRawTextElementTagName(tagName);
  }

  yield [TOKEN_TYPE.OPENING_TAGNAME, tagName];
  return nextLexerFunction;
}

const lexAttributeName: LexerFunction<"ATTR_NAME" | "SPREAD_ATTR" | "ERROR"> = function* (ctx) {
  let nextLexerFunction: LexerFunction<any> | null = null;
  let chunkStartIndex = ctx.getIndex();
  let chunkLength = 0;
  let stringParts: string[] | null = null;

  while (!ctx.isAtEnd()) {
    const nextCharCode = ctx.peekCharCode();

    // Check for spread attributes (e.g., ...{object})
    if (chunkLength === 0 && !stringParts && nextCharCode === CHAR_CODE_DOT) {
      if (ctx.peekCharCode(1) === CHAR_CODE_DOT && ctx.peekCharCode(2) === CHAR_CODE_DOT) {
        // We have "..." so this could be a spread attribute. We need to check if it's followed by a dynamic value placeholder to confirm.
        // Check for dynamic value after "..."
        const dynamicValue = ctx.peekDynamicValue(3);
        if (dynamicValue !== NO_DYNAMIC_VALUE) {
          yield [TOKEN_TYPE.SPREAD_ATTR, dynamicValue];
          // Consume the "..." + dynamic value char sequence
          chunkStartIndex = ctx.advance(3 + DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
          continue;
        }
      }
    }

    // Check for dynamic value as part of attribute name
    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      // Flush current chunk before adding dynamic value
      stringParts ??= [];

      if (chunkLength > 0) {
        stringParts.push(ctx.getSubstring(chunkStartIndex, chunkLength));
      }
      // Add the dynamic value to the attribute name
      stringParts.push(String(dynamicValue));
      chunkStartIndex = ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
      chunkLength = 0;
      continue;
    }

    // Attribute names can contain any non-terminating character.
    // Terminating characters are: whitespace, "=", ">", and "/>"
    if (nextCharCode === CHAR_CODE_EQUAL) {
      // Handle the case where there is no attribute name, just an "="
      if (chunkLength === 0 && !stringParts) {
        yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName encountered an "=" character before finding a valid attribute name.`)];
        return null;
      }

      nextLexerFunction = lexAttributeValue;
      break;
    } else if (
      // ">" indicates end of a non-self-closing tag
      nextCharCode === CHAR_CODE_GT ||
      // "/>" indicates end of a self-closing tag
      (nextCharCode === CHAR_CODE_SLASH && ctx.peekCharCode(1) === CHAR_CODE_GT)
    ) {
      // Lex the end of the opening tag and transition back to text content lexing
      nextLexerFunction = lexOpeningTagEnd;
      break;
    } else if (isWhiteSpaceCharCode(nextCharCode)) {
      if (chunkLength > 0 || stringParts) {
        // If we have an attribute name, the whitespace indicates the end of the name.
        // Transition to a new lexAttributeName instance to look for the next attribute or tag end.
        nextLexerFunction = lexAttributeName;
        break;
      }
      chunkStartIndex = ctx.advance(1);
    } else {
      // Any non-terminating character is part of the attribute name
      chunkLength++;
      ctx.advance(1);
    }
  }

  let attrName: string | null = null;
  // Flush final chunk
  if (chunkLength > 0) {
    if (!stringParts) {
      attrName = ctx.getSubstring(chunkStartIndex, chunkLength);
    } else {
      stringParts.push(ctx.getSubstring(chunkStartIndex, chunkLength));
      attrName = stringParts.join('');
    }
  } else if (stringParts) {
    attrName = stringParts.join('');
  }

  if (attrName) {
    if (!isValidHTMLAttributeNameString(attrName)) {
      yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${attrName}"`)];
      return null;
    }
    // Only add attribute name token if we found a valid name.
    // It's okay if we didn't as long as we're not transitioning to attribute value lexing.
    yield [TOKEN_TYPE.ATTR_NAME, attrName];
  }

  return nextLexerFunction;
}

const lexAttributeValue: LexerFunction<"ATTR_VALUE" | "ERROR"> = function* (ctx) {
  // Skip the equals sign
  ctx.advance(1);

  let nextLexerFunction: LexerFunction<any> | null = null;

  // Consume leading whitespace
  while (!ctx.isAtEnd() && isWhiteSpaceCharCode(ctx.peekCharCode())) {
    ctx.advance(1);
  }

  // Check for unquoted dynamic value
  const dynamicValueBeforeQuote = ctx.peekDynamicValue();
  if (dynamicValueBeforeQuote !== NO_DYNAMIC_VALUE) {
    // This is an unquoted dynamic value (e.g., attr={value})
    ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
    yield [TOKEN_TYPE.ATTR_VALUE, dynamicValueBeforeQuote];
    return lexAttributeName;
  }


  const quoteCharCode = ctx.peekCharCode();
  // Quoted attribute value starting with either " or '
  if (quoteCharCode === CHAR_CODE_DOUBLE_QUOTE || quoteCharCode === CHAR_CODE_SINGLE_QUOTE) {
    // Consume opening quote
    let currentChunkStartIndex = ctx.advance(1);
    let currentChunkLength = 0;
    let attrValueStringParts: string[] | null = null;

    let hasDynamicValueOnly = false;
    let currentDynamicAttrValue: unknown = null;

    // Track how many backslashes we've seen in a row to determine if a quote is escaped or not.
    // An even number of backslashes means the quote is not escaped, while an odd number means it is escaped.
    let escapeDepth = 0;

    while (!ctx.isAtEnd()) {
      // Check for dynamic value inside quotes
      const dynamicValue = ctx.peekDynamicValue();
      if (dynamicValue !== NO_DYNAMIC_VALUE) {
        if (currentChunkLength > 0) {
          // Flush current chunk before adding dynamic value
          attrValueStringParts ??= [];
          attrValueStringParts.push(ctx.getSubstring(currentChunkStartIndex, currentChunkLength));
          currentChunkLength = 0;
        }

        // If we haven't accumulated any string parts yet, use the dynamic value directly.
        // Otherwise, concatenate the dynamic value to the accumulated string value.
        if (!attrValueStringParts && !hasDynamicValueOnly) {
          currentDynamicAttrValue = dynamicValue;
          hasDynamicValueOnly = true;
        } else {
          attrValueStringParts ??= [];
          if (hasDynamicValueOnly) {
            // If we already have a dynamic value, we need to convert it to a string and concatenate
            // it before adding the next dynamic value.
            attrValueStringParts.push(String(currentDynamicAttrValue));
            currentDynamicAttrValue = null;
            hasDynamicValueOnly = false;
          }
          // Coerce the value to a string and concatenate it with
          // any accumulated string value.
          attrValueStringParts.push(String(dynamicValue));
        }

        currentChunkStartIndex = ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
        continue;
      }

      // Make sure to handle escaped quotes in attribute values
      const nextCharCode = ctx.peekCharCode();
      if (nextCharCode === CHAR_CODE_BACKSLASH) {
        escapeDepth++;
      } else if (
        // If our escape depth is 0 or an even number, the next quote char is not escaped and can
        // be treated as a closing quote.
        nextCharCode === quoteCharCode && escapeDepth % 2 === 0
      ) {
        // Closing quote found
        ctx.advance(1); // Consume closing quote
        nextLexerFunction = lexAttributeName; // Transition back to attribute name lexing
        break;
      } else {
        escapeDepth = 0;
      }

      // We have a normal character to append to the attribute value.
      // If we previously encountered a dynamic value, we need to convert that into char codes
      // and append it to the char code array before appending any subsequent characters.
      if (hasDynamicValueOnly) {
        attrValueStringParts ??= [];
        attrValueStringParts.push(String(currentDynamicAttrValue))
        currentDynamicAttrValue = null;
        hasDynamicValueOnly = false;
      }

      ctx.advance(1);
      currentChunkLength++;
    }

    if (currentChunkLength > 0) {
      const currentChunk = ctx.getSubstring(currentChunkStartIndex, currentChunkLength);
      if (attrValueStringParts) {
        // If we have already accumulated some string parts, we need to append the current chunk to that array.
        attrValueStringParts.push(currentChunk);
      } else {
        yield [TOKEN_TYPE.ATTR_VALUE, currentChunk];
        return nextLexerFunction;
      }
    }

    if (attrValueStringParts) {
      yield [TOKEN_TYPE.ATTR_VALUE, attrValueStringParts.join('')];
    } else if (hasDynamicValueOnly) {
      yield [TOKEN_TYPE.ATTR_VALUE, currentDynamicAttrValue];
    }

    return nextLexerFunction;
  } else {
    // Unquoted attribute value
    const unquotedStartIndex = ctx.getIndex();
    let unquotedLength = 0;

    while (!ctx.isAtEnd()) {
      const nextCharCode = ctx.peekCharCode();
      if (
        // Unquoted attribute values are terminated by whitespace, ">", or "/>".
        isWhiteSpaceCharCode(nextCharCode)
        || nextCharCode === CHAR_CODE_GT
        || (nextCharCode === CHAR_CODE_SLASH && ctx.peekCharCode(1) === CHAR_CODE_GT)
      ) {
        // End of unquoted attribute value
        nextLexerFunction = lexAttributeName; // Transition back to attribute name lexing
        break;
      } else if (ctx.peekDynamicValue() !== NO_DYNAMIC_VALUE) {
        // Unquoted dynamic value in the middle of an unquoted attribute string value is not valid syntax, yield error
        yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`Dynamic values are not allowed in the middle of unquoted attribute values.`)];
        return null;
      } else {
        unquotedLength++;
        ctx.advance(1);
      }
    }

    if (unquotedLength > 0) {
      yield [TOKEN_TYPE.ATTR_VALUE, ctx.getSubstring(unquotedStartIndex, unquotedLength)];
    }

    return nextLexerFunction;
  }


}

const lexOpeningTagEnd: LexerFunction<"OPENING_TAG_END" | "ERROR"> = function* (ctx) {
  // This lexer function is just responsible for consuming the closing ">" or "/>" of an opening tag and yielding the appropriate token.
  const nextCharCode = ctx.peekCharCode();
  if (nextCharCode === CHAR_CODE_GT) {
    // Normal opening tag end
    yield [TOKEN_TYPE.OPENING_TAG_END, false];
    ctx.advance(1);
  } else if (nextCharCode === CHAR_CODE_SLASH && ctx.peekCharCode(1) === CHAR_CODE_GT) {
    // If we see a "/>" here, it means we have a self-closing tag. We should yield an OPENING_TAG_END token with a value of true to indicate this,
    // and then transition to lexSelfClosingTagEnd to consume the "/>" and transition back to text content lexing.
    yield [TOKEN_TYPE.OPENING_TAG_END, true];
    ctx.advance(2); // Consume the "/>"
  } else {
    // We should never get here because lexOpeningTagname should only transition to this lexer function if it sees a ">" or "/>" character, but we'll include an error case just in case.
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagEnd expected ">" or "/>" but found "${String.fromCharCode(nextCharCode)}".`)];
    return null;
  }

  if (ctx.getCurrentRawTextElementTagName()) {
    // If we're lexing the opening tag of a raw text element (e.g., <script>, <style>, <textarea>), we need to transition to a special lexer function that will just consume everything as text content until it finds the closing tag for that element, at which point it can transition back to the normal lexTextContent lexer function.
    return lexRawTextElementContent;
  }

  return lexTextContent;
}

const lexRawTextElementContent: LexerFunction<"CHILD_CONTENT" | "ERROR"> = function* (ctx) {
  let nextLexerFunction: LexerFunction<any> | null = null;
  const currentChunkStartIndex = ctx.getIndex();
  let currentChunkLength = 0;

  const rawTextElementTagName = ctx.getCurrentRawTextElementTagName();
  if (!rawTextElementTagName) {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexRawTextElementContent was entered without a current raw text element tag name set in the context.`)];
    return null;
  }

  // Script and style tags can have quoted strings inside them that may potentially contain a closing tag that shouldn't be treated
  // as an actual closing tag. In those cases, we'll need to track whether we're currently inside a quoted string and ignore any
  // closing tags until the string is closed.
  const doesRawContentHaveQuotedValues = rawTextElementTagName === "script" || rawTextElementTagName === "style";
  let currentOpenQuoteStartCharCode: number | null = null;

  while (!ctx.isAtEnd()) {
    const nextCharCode = ctx.peekCharCode();

    if (doesRawContentHaveQuotedValues) {
      if (currentOpenQuoteStartCharCode !== null) {
        // We're currently inside a quoted string, so we need to look for the closing quote character that matches the one that opened this string.
        if (nextCharCode === currentOpenQuoteStartCharCode) {
          // We found the closing quote for the current string, so we can exit out of string mode and continue lexing for the raw text element closing tag.
          currentOpenQuoteStartCharCode = null;
        }
      } else if (
        nextCharCode === CHAR_CODE_DOUBLE_QUOTE || nextCharCode === CHAR_CODE_SINGLE_QUOTE ||
        // Scripts also have backtick-quoted template literals, so we need to check for backticks as well if this is a script tag
        (rawTextElementTagName === "script" && nextCharCode === CHAR_CODE_BACKTICK)
      ) {
        // We found an opening quote character, so we need to enter string mode and ignore any tag-like syntax until we find the matching closing quote.
        currentOpenQuoteStartCharCode = nextCharCode;
      }
    }

    if (currentOpenQuoteStartCharCode === null && nextCharCode === CHAR_CODE_LT) {
      if (ctx.peekCharCode(1) === CHAR_CODE_SLASH) {
        // We may have found the closing tag for this raw text element. We need to peek ahead to see if the tag name matches the raw text element we're currently in.
        if (rawTextElementTagName === ctx.getSubstring(ctx.getIndex() + 2, rawTextElementTagName.length)) {
          // We have found the closing tag for this raw text element, so we should transition back to
          // lexing normal text content after we yield any remaining text content before the closing tag.
          nextLexerFunction = lexClosingTag;
          break;
        }
      }
    }

    ctx.advance();
    currentChunkLength++;
  }

  if (currentChunkLength > 0) {
    yield [TOKEN_TYPE.CHILD_CONTENT, ctx.getSubstring(currentChunkStartIndex, currentChunkLength)];
  }

  // Clear the current raw text element tag name from the context since we're exiting that element after this lexer function
  ctx.setCurrentRawTextElementTagName(null);

  return nextLexerFunction;
}

const lexClosingTag: LexerFunction<"CLOSING_TAGNAME" | "ERROR"> = function* (ctx) {
  // Skip the opening "</"
  ctx.advance(2);

  let nextLexerFunction: LexerFunction<any> | null = null;
  let stringParts: string[] | null = null;
  let currentChunkStartIndex = ctx.getIndex();
  let currentChunkLength = 0;
  let dynamicComponentTagFunction: Function | null = null;

  let hasFinishedConsumingTagName = false;

  while (!ctx.isAtEnd()) {
    const nextCharCode = ctx.peekCharCode();

    if (nextCharCode === CHAR_CODE_GT) {
      // Consume the closing ">" and transition back to text content lexing
      ctx.advance(1);
      nextLexerFunction = lexTextContent;
      break;
    } else {
      if (hasFinishedConsumingTagName) {
        ctx.advance(1);
        continue;
      }

      // Check for dynamic value
      const dynamicValue = ctx.peekDynamicValue();
      if (dynamicValue !== NO_DYNAMIC_VALUE) {
        if (typeof dynamicValue === "function" && currentChunkLength === 0 && !stringParts) {
          // Component closing tag (only if we haven't started consuming a string tag name)
          dynamicComponentTagFunction = dynamicValue;
          hasFinishedConsumingTagName = true;
        } else {
          stringParts ??= [];
          // Flush current chunk before adding dynamic value
          if (currentChunkLength > 0) {
            stringParts.push(ctx.getSubstring(currentChunkStartIndex, currentChunkLength));
            currentChunkLength = 0;
          }
          // Dynamic string tag name or part of tag name
          stringParts.push(String(dynamicValue));
        }

        currentChunkStartIndex = ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH);
        // Continue to see if there's more to the tag name
        continue;
      }

      if (
        // First letter of a tagname must be a letter
        (currentChunkLength === 0 && !stringParts && isLetterCharCode(nextCharCode))
        || isValidHTMLTagNameCharCode(nextCharCode)
      ) {
        currentChunkLength++;
      } else {
        hasFinishedConsumingTagName = true;
      }

      ctx.advance(1);
    }
  }

  if (dynamicComponentTagFunction !== null) {
    yield [TOKEN_TYPE.CLOSING_TAGNAME, dynamicComponentTagFunction];
  } else {
    let closingTagName: string;

    // Flush final chunk
    if (currentChunkLength > 0) {
      const currentChunk = ctx.getSubstring(currentChunkStartIndex, currentChunkLength);
      if (!stringParts) {
        closingTagName = currentChunk;
      } else {
        stringParts.push(currentChunk);
        closingTagName = stringParts.join('');
      }
    } else if (stringParts) {
      closingTagName = stringParts.join('');
    } else {
      closingTagName = '';
    }

    yield [TOKEN_TYPE.CLOSING_TAGNAME, closingTagName];
  }

  return nextLexerFunction;
};

/**
 * Lexes HTML strings into tokens using a generator-based approach.
 *
 * Yields tuples for tokens as they are parsed, where the first item is the token type
 * and the second item is the token value (e.g., `[TOKEN_TYPE.OPENING_TAGNAME, "div"]`)
 *
 * @param htmlStringChars - The HTML string to lex
 * @param dynamicValues - Array of dynamic values that can be referenced via placeholder character sequences in the HTML
 *
 * @example
 * ```ts
 * for (const [tokenType, tokenValue] of lexHTML('<div>Hello</div>', [])) {
 *   console.log('Token type:', tokenType, 'Value:', tokenValue);
 * }
 * ```
 */
export function* lexHTML(htmlStringChars: Uint8Array, dynamicValues: unknown[]): Generator<LexerToken, void, void> {
  const htmlStringLength = htmlStringChars.length;

  let charIndex = 0;
  let currentRawTextElementTagName: RawStringContentTagName | null = null;

  const lexerContext: LexerContext = {
    getIndex() {
      return charIndex;
    },
    getSubarray(startIndex: number, length: number) {
      return htmlStringChars.subarray(startIndex, startIndex + length);
    },
    getSubstring(startIndex: number, length: number) {
      return textDecoder.decode(this.getSubarray(startIndex, length));
    },
    peekCharCode(peekOffset = 0) {
      return htmlStringChars[charIndex + peekOffset];
    },
    peekDynamicValue(peekOffset = 0) {
      const dynamicValueIndex = parseDynamicValueByteSequenceIndex(
        this.getSubarray(charIndex + peekOffset, DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH)
      );

      if (dynamicValueIndex === null) {
        return NO_DYNAMIC_VALUE;
      }

      if (dynamicValueIndex < 0 || dynamicValueIndex >= dynamicValues.length) {
        throw new YetiHTMLParsingError(`Invalid dynamic value index ${dynamicValueIndex} encoded at position ${charIndex + peekOffset}.`);
      }
      return dynamicValues[dynamicValueIndex];
    },
    advance(advanceLength = 1) {
      charIndex += advanceLength;
      return charIndex;
    },
    isAtEnd() {
      return charIndex >= htmlStringLength;
    },
    getCurrentRawTextElementTagName() {
      return currentRawTextElementTagName;
    },
    setCurrentRawTextElementTagName(value) {
      currentRawTextElementTagName = value;
    },
  };

  let lexerFunction: LexerFunction<any> | null = lexTextContent;
  while (lexerFunction !== null) {
    lexerFunction = yield* lexerFunction(lexerContext);
  }
}