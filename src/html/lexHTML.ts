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
  DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH,
  isLetterCharCode,
  isValidHTMLTagNameCharCodeArray,
  isValidHTMLTagNameCharCode,
  isWhiteSpaceCharCode,
  isValidHTMLAttributeNameCharCodeArray,
  appendToCharCodeArray
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
   * Peeks ahead in the input string without advancing the current position.
   *
   * @param  {number} [peekLength=1] - The number of characters to peek ahead.
   * @param {number} [peekOffset=0] - The number of characters to offset from the current position for the peek.
   *
   * @example
   * ```ts
   * ctx.peek(); // Peeks the next character from the current position
   * ctx.peek(5); // Peeks the next 5 characters from the current position
   * ctx.peek(2, 3); // Peeks 2 characters starting from 3 characters ahead of the current position
   * ```
   */
  peek(peekLength: number, peekOffset?: number): string;
  peekCharCode(peekOffset?: number): number;
  /**
   * Peeks ahead to check for a dynamic value placeholder and returns metadata for the corresponding dynamic value if found.
   *
   * @param {number} [peekOffset=0] - The number of characters to offset from the current position for the peek.
   * @returns The dynamic value, or NO_DYNAMIC_VALUE symbol if no dynamic value placeholder is found.
   */
  peekDynamicValue(peekOffset?: number): unknown | typeof NO_DYNAMIC_VALUE;
  advance(advanceLength?: number): void;
  isAtEnd(): boolean;
}

/**
 * A generator function that performs lexing and yields the next lexer function to execute, or null if lexing is complete.
 */
type LexerFunction<TTokenNames extends LexerTokenName> = (ctx: LexerContext) => Generator<LexerToken<typeof TOKEN_TYPE[TTokenNames]>, LexerFunction<any> | null, void>;

const lexTextContent: LexerFunction<"CHILD_CONTENT" | "ERROR"> = function* (ctx) {
  let nextLexerFunction: LexerFunction<any> | null = null;
  let textCharCodes = new Array<number>();

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

          if (ctx.peek(7, 2) === "DOCTYPE") {
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
          if (textCharCodes.length > 0) {
            // Emit any accumulated text content so dynamic values get their own tokens
            yield [TOKEN_TYPE.CHILD_CONTENT, String.fromCharCode(...textCharCodes)];
            textCharCodes.length = 0;
          }
          // Emit the raw dynamic value as a child content token; the parser can handle it from there
          // if we want to unwrap iterables, promises, inlined functions, etc
          yield [TOKEN_TYPE.CHILD_CONTENT, dynamicValue];

          // Advance past the dynamic value character sequence
          ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
          continue;
        }
      }

      // We didn't find a transition point, so just consume the next character as text content
      textCharCodes.push(nextCharCode);
      ctx.advance(1);
    }

    if (textCharCodes.length > 0) {
      // Skip text content token if empty
      yield [TOKEN_TYPE.CHILD_CONTENT, String.fromCharCode(...textCharCodes)];
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

  const commentCharCodes = new Array<number>();

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
      // Just stringify the dynamic value and include it in the comment content
      appendToCharCodeArray(commentCharCodes, String(dynamicValue));
      ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
    } else {
      commentCharCodes.push(nextCharCode);
      ctx.advance(1);
    }
  }

  yield [TOKEN_TYPE.COMMENT, String.fromCharCode(...commentCharCodes).trim()];
  return nextLexerFunction;
};

const lexDoctype: LexerFunction<"DOCTYPE" | "ERROR"> = function* (ctx) {
  // Skip the opening "<!DOCTYPE"
  ctx.advance(9);
  let nextLexerFunction: LexerFunction<any> | null = null;

  let doctypeContentCharCodes = new Array<number>();

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

    doctypeContentCharCodes.push(nextCharCode);
    ctx.advance(1);
  }

  yield [TOKEN_TYPE.DOCTYPE, String.fromCharCode(...doctypeContentCharCodes).trim()];
  return nextLexerFunction;
}

const lexOpeningTagname: LexerFunction<"OPENING_TAGNAME" | "ERROR"> = function* (ctx) {
  // Skip the opening "<"
  ctx.advance(1);

  let nextLexerFunction: LexerFunction<any> | null = null;
  let tagNameCharCodes = new Array<number>();

  while (!ctx.isAtEnd()) {
    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      if (tagNameCharCodes.length === 0 && typeof dynamicValue === "function") {
        // If the dynamic value is a function and we haven't consumed any tag name characters yet,
        // we can treat this as a component tag. 
        ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
        // We yield the function as the tag name and transition to lexing attributes and
        // the rest of the tag as normal.
        yield [TOKEN_TYPE.OPENING_TAGNAME, dynamicValue];
        return lexAttributeName;
      }

      // If we encounter a dynamic value, we treat it as the entire tag name.
      // The parser can handle it from there.
      appendToCharCodeArray(tagNameCharCodes, String(dynamicValue));
      ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
    }

    const nextCharCode = ctx.peekCharCode();

    if (
      // The first letter of a tagname has to be a letter
      (tagNameCharCodes.length === 0 && isLetterCharCode(nextCharCode)) ||
      // All following characters can be letters, digits, hyphens, or colons
      isValidHTMLTagNameCharCode(nextCharCode)
    ) {
      tagNameCharCodes.push(nextCharCode);
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

  if (!isValidHTMLTagNameCharCodeArray(tagNameCharCodes)) {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname received invalid tag name "${String.fromCharCode(...tagNameCharCodes)}".`)];
    return null;
  }

  yield [TOKEN_TYPE.OPENING_TAGNAME, String.fromCharCode(...tagNameCharCodes)];
  return nextLexerFunction;
}

const lexAttributeName: LexerFunction<"ATTR_NAME" | "SPREAD_ATTR" | "ERROR"> = function* (ctx) {
  let nextLexerFunction: LexerFunction<any> | null = null;
  let attrNameCharCodes = new Array<number>();

  while (!ctx.isAtEnd()) {
    const nextCharCode = ctx.peekCharCode();

    // Check for spread attributes (e.g., ...{object})
    if (attrNameCharCodes.length === 0 && nextCharCode === CHAR_CODE_DOT) {
      if (ctx.peekCharCode(1) === CHAR_CODE_DOT && ctx.peekCharCode(2) === CHAR_CODE_DOT) {
        // We have "..." so this could be a spread attribute. We need to check if it's followed by a dynamic value placeholder to confirm.
        // Check for dynamic value after "..."
        const dynamicValue = ctx.peekDynamicValue(3);
        if (dynamicValue !== NO_DYNAMIC_VALUE) {
          yield [TOKEN_TYPE.SPREAD_ATTR, dynamicValue];
          // Consume the "..." + dynamic value char sequence
          ctx.advance(3 + DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
          continue;
        }
      }
    }

    // Check for dynamic value as part of attribute name
    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      // Add the dynamic value to the attribute name
      appendToCharCodeArray(attrNameCharCodes, String(dynamicValue));
      ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
      continue;
    }

    // Attribute names can contain any non-terminating character.
    // Terminating characters are: whitespace, "=", ">", and "/>"
    if (nextCharCode === CHAR_CODE_EQUAL) {
      // Handle the case where there is no attribute name, just an "="
      if (attrNameCharCodes.length === 0) {
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
      // Skip whitespace
      ctx.advance(1);
      if (attrNameCharCodes.length > 0) {
        // If we have an attribute name, the whitespace indicates the end of the name.
        // Transition to a new lexAttributeName instance to look for the next attribute or tag end.
        nextLexerFunction = lexAttributeName;
        break;
      }
    } else {
      // Any non-terminating character is part of the attribute name
      attrNameCharCodes.push(nextCharCode);
      ctx.advance(1);
    }
  }

  if (attrNameCharCodes.length > 0) {
    if (!isValidHTMLAttributeNameCharCodeArray(attrNameCharCodes)) {
      yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${String.fromCharCode(...attrNameCharCodes)}"`)];
      return null;
    }
    // Only add attribute name token if we found a valid name.
    // It's okay if we didn't as long as we're not transitioning to attribute value lexing.
    yield [TOKEN_TYPE.ATTR_NAME, String.fromCharCode(...attrNameCharCodes)];
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
    ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
    yield [TOKEN_TYPE.ATTR_VALUE, dynamicValueBeforeQuote];
    return lexAttributeName;
  }

  let attrValueCharCodes = new Array<number>();
  let hasDynamicValue = false;
  let dynamicAttrValue: unknown = null;

  const quoteCharCode = ctx.peekCharCode();
  if (quoteCharCode === CHAR_CODE_DOUBLE_QUOTE || quoteCharCode === CHAR_CODE_SINGLE_QUOTE) {
    // Quoted attribute value
    ctx.advance(1); // Consume opening quote

    // Track how many backslashes we've seen in a row to determine if a quote is escaped or not.
    // An even number of backslashes means the quote is not escaped, while an odd number means it is escaped.
    let escapeDepth = 0;

    while (!ctx.isAtEnd()) {
      // Check for dynamic value inside quotes
      const dynamicValue = ctx.peekDynamicValue();
      if (dynamicValue !== NO_DYNAMIC_VALUE) {
        // If we haven't accumulated any string value yet, use the dynamic value directly.
        // Otherwise, concatenate the dynamic value to the accumulated string value.
        if (attrValueCharCodes.length === 0 && !hasDynamicValue) {
          dynamicAttrValue = dynamicValue;
          hasDynamicValue = true;
        } else {
          // Otherwise, coerce the value to a string and concatenate it with
          // any accumulated string value.
          appendToCharCodeArray(attrValueCharCodes, String(dynamicValue));
        }
        ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
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
      if (hasDynamicValue) {
        appendToCharCodeArray(attrValueCharCodes, String(nextCharCode));
        dynamicAttrValue = null;
        hasDynamicValue = false;
      }

      attrValueCharCodes.push(nextCharCode);
      ctx.advance(1);
    }
  } else {
    // Unquoted attribute value
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
      } else {
        attrValueCharCodes.push(nextCharCode);
        ctx.advance(1);
      }
    }
  }

  if (attrValueCharCodes.length > 0) {
    yield [TOKEN_TYPE.ATTR_VALUE, String.fromCharCode(...attrValueCharCodes)];
  } else if (hasDynamicValue) {
    yield [TOKEN_TYPE.ATTR_VALUE, dynamicAttrValue];
  }

  return nextLexerFunction;
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
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagEnd expected ">" or "/>" but found "${ctx.peek(2)}"`)];
    return null;
  }

  return lexTextContent;
}

const lexClosingTag: LexerFunction<"CLOSING_TAGNAME" | "ERROR"> = function* (ctx) {
  // Skip the opening "</"
  ctx.advance(2);

  let nextLexerFunction: LexerFunction<any> | null = null;
  let tagNameCharCodes = new Array<number>();
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
        if (typeof dynamicValue === "function" && tagNameCharCodes.length === 0) {
          // Component closing tag (only if we haven't started consuming a string tag name)
          dynamicComponentTagFunction = dynamicValue;
          hasFinishedConsumingTagName = true;
        } else {
          // Dynamic string tag name or part of tag name
          appendToCharCodeArray(tagNameCharCodes, String(dynamicValue));
        }

        ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
        // Continue to see if there's more to the tag name
        continue;
      }

      if (
        // First letter of a tagname must be a letter
        (tagNameCharCodes.length === 0 && isLetterCharCode(nextCharCode))
        || isValidHTMLTagNameCharCode(nextCharCode)
      ) {
        tagNameCharCodes.push(nextCharCode);
      } else {
        hasFinishedConsumingTagName = true;
      }

      ctx.advance(1);
    }
  }

  if (dynamicComponentTagFunction !== null) {
    yield [TOKEN_TYPE.CLOSING_TAGNAME, dynamicComponentTagFunction];
  } else {
    yield [TOKEN_TYPE.CLOSING_TAGNAME, String.fromCharCode(...tagNameCharCodes)];
  }

  return nextLexerFunction;
};

/**
 * Lexes HTML strings into tokens using a generator-based approach.
 *
 * Yields tuples for tokens as they are parsed, where the first item is the token type
 * and the second item is the token value (e.g., `[TOKEN_TYPE.OPENING_TAGNAME, "div"]`)
 *
 * @param htmlString - The HTML string to lex
 * @param dynamicValues - Array of dynamic values that can be referenced via placeholder character sequences in the HTML
 *
 * @example
 * ```ts
 * for (const [tokenType, tokenValue] of lexHTML('<div>Hello</div>', [])) {
 *   console.log('Token type:', tokenType, 'Value:', tokenValue);
 * }
 * ```
 */
export function* lexHTML(htmlString: string, dynamicValues: unknown[]): Generator<LexerToken, void, void> {
  const htmlStringLength = htmlString.length;

  let charIndex = 0;

  const lexerContext: LexerContext = {
    peek(peekLength = 1, peekOffset = 0) {
      const startIndex = charIndex + peekOffset;
      return htmlString.slice(startIndex, startIndex + peekLength);
    },
    peekCharCode(peekOffset = 0) {
      return htmlString.charCodeAt(charIndex + peekOffset);
    },
    peekDynamicValue(peekOffset = 0) {
      if (this.peekCharCode(peekOffset) !== CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER) {
        return NO_DYNAMIC_VALUE;
      }

      const dynamicValueIndex = htmlString.charCodeAt(charIndex + peekOffset + 1);
      const dynamicValue = dynamicValues[dynamicValueIndex];

      return dynamicValue;
    },
    advance(advanceLength = 1) {
      charIndex += advanceLength;
    },
    isAtEnd() {
      return charIndex >= htmlStringLength;
    },
  };

  let lexerFunction: LexerFunction<any> | null = lexTextContent;
  while (lexerFunction !== null) {
    lexerFunction = yield* lexerFunction(lexerContext);
  }
}