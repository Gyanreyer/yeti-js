import {
  DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH,
  DYNAMIC_VALUE_PLACEHOLDER_PREFIX,
  isLetter,
  isValidHTMLAttributeName,
  isValidHTMLTagName,
  isValidHTMLTagNameChar,
  isWhiteSpace
} from "./utils.ts";
import { YetiHTMLParsingError } from "./error.ts";

// TODO:
// - Handle component tags (tags where the tag name is a function placeholder)
// - Resolve dynamic value placeholders; a dynamic value can appear anywhere so all lexer functions need to be aware of them.
//   - A util for matching and extracting dynamic value placeholders would be helpful here.
//   - Need to be able to unwrap iterables, promises, etc
// - Ensure all error cases are handled gracefully and produce useful error messages.

export const TOKEN_TYPE = {
  ERROR: 0,
  CHILD_CONTENT: 10,
  OPENING_TAGNAME: 20,
  SELF_CLOSING_TAG_END: 25,
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
  [TOKEN_TYPE.OPENING_TAGNAME]: string | Function; // A tag name can be a string or a function placeholder for components
  [TOKEN_TYPE.SELF_CLOSING_TAG_END]: null;
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
  peek(peekLength?: number, peekOffset?: number): string;
  /**
   * Peeks ahead to see if the next characters match a given string.
   *
   * @param {string} matchString - The string to match against the upcoming characters.
   * @param {number} [peekOffset=0] - The number of characters to offset from the current position for the match.
   */
  peekMatch(matchString: string, peekOffset?: number): boolean;
  /**
   * Peeks ahead to check for a dynamic value placeholder and returns metadata for the corresponding dynamic value if found.
   *
   * @param {number} [peekOffset=0] - The number of characters to offset from the current position for the peek.
   * @returns The dynamic value, or NO_DYNAMIC_VALUE symbol if no dynamic value placeholder is found.
   */
  peekDynamicValue(peekOffset?: number): unknown | typeof NO_DYNAMIC_VALUE;
  advance(advanceLength?: number): string;
  isAtEnd(): boolean;
}

/**
 * A generator function that performs lexing and yields the next lexer function to execute, or null if lexing is complete.
 */
type LexerFunction<TTokenNames extends LexerTokenName> = (ctx: LexerContext) => Generator<LexerToken<typeof TOKEN_TYPE[TTokenNames]>, LexerFunction<any> | null, void>;

const lexTextContent: LexerFunction<"CHILD_CONTENT" | "ERROR"> = function* (ctx) {
  let textContent = "";
  let nextLexerFunction: LexerFunction<any> | null = null;

  try {
    while (!ctx.isAtEnd()) {
      // Check if we need to transition to a new lexer state. Transition options:
      // 1. Opening tag: "<" + letter
      // 2. Component tag: "<" + FUNCTION_PLACEHOLDER_PREFIX (3 characters long)
      // 3. Closing tag: "</"
      // 4. Comment: "<!--"
      // 5. Doctype: "<!DOCTYPE"
      if (ctx.peekMatch("<")) {
        const secondChar = ctx.peek(1, 1);
        if (isLetter(secondChar)) {
          // TRANSITION TO OPENING TAG
          nextLexerFunction = lexOpeningTagname;
          break;
        }

        if (ctx.peekMatch("/", 1)) {
          // TRANSITION TO CLOSING TAG
          nextLexerFunction = lexClosingTag;
          break;
        }

        if (ctx.peekMatch("!--", 1)) {
          // TRANSITION TO COMMENT
          nextLexerFunction = lexComment;
          break;
        }

        if (ctx.peekMatch("!DOCTYPE", 1)) {
          // TRANSITION TO DOCTYPE
          nextLexerFunction = lexDoctype;
          break;
        }

        const dynamicValue = ctx.peekDynamicValue(1);
        if (
          // `<${function}` => component tag
          typeof dynamicValue === "function" ||
          // `<${string}` => element tag with dynamic string tag name (unless the string is empty or starts with a non-letter,
          // in which case we can just proceed and treat it as text content)
          (typeof dynamicValue === "string" && dynamicValue.length > 0 && isLetter(dynamicValue[0]))
        ) {
          // Transition to lex opening tagname; the lexer will consume the dynamic value.
          // If the dynamic value is a function, the token will just be `{ ty: OPENING_TAGNAME, v: [Function] }`,
          // and the parser can handle it from there.
          nextLexerFunction = lexOpeningTagname;
          break;
        }
      } else {
        const dynamicValue = ctx.peekDynamicValue();
        if (dynamicValue !== NO_DYNAMIC_VALUE) {
          if (typeof dynamicValue === "string") {
            // If the dynamic value is a string, we can roll it into the text content
            textContent += dynamicValue;
          } else {
            if (textContent.length > 0) {
              // Emit any accumulated text content before transitioning
              yield [TOKEN_TYPE.CHILD_CONTENT, textContent];
              textContent = "";
            }
            // Emit the raw dynamic value as a child content token; the parser can handle it from there
            // if we want to unwrap iterables, promises, inlined functions, etc
            yield [TOKEN_TYPE.CHILD_CONTENT, dynamicValue];
          }

          // Advance past the dynamic value character sequence
          ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
          continue;
        }

        // We didn't find a transition point, so just consume the next character as text content
        textContent += ctx.advance(1);
      }
    }

    if (textContent.length > 0) {
      // Skip text content token if empty
      yield [TOKEN_TYPE.CHILD_CONTENT, textContent];
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
  const skipped = ctx.advance(4);
  if (skipped !== "<!--") {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexComment received invalid comment opening sequence "${skipped}"`)];
    return null;
  }
  let nextLexerFunction: LexerFunction<any> | null = null;

  let commentContent = "";
  while (!ctx.isAtEnd()) {
    if (ctx.peekMatch("-->")) {
      nextLexerFunction = lexTextContent;
      // Consume the closing "-->"
      ctx.advance(3);
      break;
    }

    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      // Just stringify the dynamic value and include it in the comment content
      commentContent += String(dynamicValue);
      ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
    } else {
      commentContent += ctx.advance(1);
    }
  }

  yield [TOKEN_TYPE.COMMENT, commentContent];
  return nextLexerFunction;
};

const lexDoctype: LexerFunction<"DOCTYPE" | "ERROR"> = function* (ctx) {
  // Skip the opening "<!DOCTYPE"
  const skipped = ctx.advance(9);
  if (skipped !== "<!DOCTYPE") {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexDoctype received invalid doctype opening sequence "${skipped}"`)];
    return null;
  }
  let nextLexerFunction: LexerFunction<any> | null = null;

  let doctypeContent = "";
  while (!ctx.isAtEnd()) {
    if (ctx.peekMatch(">")) {
      nextLexerFunction = lexTextContent;
      // Consume the closing ">"
      ctx.advance(1);
      break;
    }

    if (ctx.peekDynamicValue() !== NO_DYNAMIC_VALUE) {
      yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`Dynamic values are not allowed inside DOCTYPE declarations.`)];
      return null;
    }

    doctypeContent += ctx.advance(1);
  }

  yield [TOKEN_TYPE.DOCTYPE, doctypeContent.trim()];
  return nextLexerFunction;
}

const lexOpeningTagname: LexerFunction<"OPENING_TAGNAME" | "ERROR"> = function* (ctx) {
  // Skip the opening "<"
  const skipped = ctx.advance(1);
  if (skipped !== "<") {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname received invalid opening tag opening sequence "${skipped}"`)];
    return null;
  }

  let nextLexerFunction: LexerFunction<any> | null = null;
  let tagName: string | Function = "";

  while (!ctx.isAtEnd()) {
    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      if (!tagName && typeof dynamicValue === "function") {
        // If the dynamic value is a function and we haven't consumed any tag name characters yet,
        // we can treat this as a component tag.
        tagName = dynamicValue;
        ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
        nextLexerFunction = lexAttributeName;
        break;
      }

      // If we encounter a dynamic value, we treat it as the entire tag name.
      // The parser can handle it from there.
      tagName += String(dynamicValue);
      ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
    }

    const nextChar = ctx.peek();

    if (
      (tagName.length === 0 && isLetter(nextChar)) ||
      isValidHTMLTagNameChar(nextChar)
    ) {
      tagName += ctx.advance(1);
    } else if (isWhiteSpace(nextChar)) {
      // Consume whitespace and transition to attribute lexing
      ctx.advance(1);
      nextLexerFunction = lexAttributeName;
      break;
    } else if (nextChar === ">") {
      // Consume the closing ">" and transition back to text content lexing
      ctx.advance(1);
      nextLexerFunction = lexTextContent;
      break;
    } else if (nextChar === "/" && ctx.peekMatch("/>", 0)) {
      // Consume the self-closing "/>" and transition back to text content lexing
      ctx.advance(2);
      nextLexerFunction = lexSelfClosingTagEnd;
      break;
    }
  }

  if (typeof tagName === "string" && !isValidHTMLTagName(tagName)) {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname received invalid tag name "${tagName}".`)];
    return null;
  }

  yield [TOKEN_TYPE.OPENING_TAGNAME, tagName];
  return nextLexerFunction;
}

const lexAttributeName: LexerFunction<"ATTR_NAME" | "SPREAD_ATTR" | "ERROR"> = function* (ctx) {
  let nextLexerFunction: LexerFunction<any> | null = null;
  let attrName = "";

  while (!ctx.isAtEnd()) {
    // Check for spread attributes (e.g., ...{object})
    if (!attrName && ctx.peekMatch("...")) {
      // Check for dynamic value after "..."
      const dynamicValue = ctx.peekDynamicValue(3);
      if (dynamicValue !== NO_DYNAMIC_VALUE) {
        yield [TOKEN_TYPE.SPREAD_ATTR, dynamicValue];
        // Consume the "..." + dynamic value char sequence
        ctx.advance(3 + DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
        return yield* lexAttributeName(ctx);
      }
    }

    // Check for dynamic value as part of attribute name
    const dynamicValue = ctx.peekDynamicValue();
    if (dynamicValue !== NO_DYNAMIC_VALUE) {
      // Add the dynamic value to the attribute name
      const dynamicStr = String(dynamicValue);
      attrName += dynamicStr;
      ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
      continue;
    }

    const nextChar = ctx.peek();

    // Attribute names can contain any non-terminating character.
    // Terminating characters are: whitespace, "=", ">", and "/>"
    if (nextChar === "=") {
      // Handle the case where there is no attribute name, just an "="
      if (!attrName) {
        yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName did not find a valid attribute name.`)];
        return null;
      }

      nextLexerFunction = lexAttributeValue;
      break;
    } else if (nextChar === ">") {
      // Consume the closing ">" and transition back to text content lexing
      ctx.advance(1);
      nextLexerFunction = lexTextContent;
      break;
    } else if (nextChar === "/" && ctx.peekMatch("/>")) {
      nextLexerFunction = lexSelfClosingTagEnd;
      break;
    } else if (isWhiteSpace(nextChar)) {
      // Skip whitespace
      ctx.advance(1);
      if (attrName) {
        // If we have an attribute name, the whitespace indicates the end of the name.
        // Transition to a new lexAttributeName instance to look for the next attribute or tag end.
        nextLexerFunction = lexAttributeName;
        break;
      }
    } else {
      // Any non-terminating character is part of the attribute name
      attrName += ctx.advance(1);
    }
  }


  if (attrName) {
    if (!isValidHTMLAttributeName(attrName)) {
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
  const skipped = ctx.advance(1);
  if (skipped !== "=") {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeValue expected "=" but found "${skipped}"`)];
    return null;
  }

  let nextLexerFunction: LexerFunction<any> | null = null;
  let attrValue: unknown = "";

  // Consume leading whitespace
  while (!ctx.isAtEnd() && isWhiteSpace(ctx.peek())) {
    ctx.advance(1);
  }

  // Check for unquoted dynamic value
  const dynamicValueBeforeQuote = ctx.peekDynamicValue();
  if (dynamicValueBeforeQuote !== NO_DYNAMIC_VALUE) {
    // This is an unquoted dynamic value (e.g., attr={value})
    attrValue = dynamicValueBeforeQuote;
    ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
    yield [TOKEN_TYPE.ATTR_VALUE, attrValue];
    return lexAttributeName;
  }

  const quoteChar = ctx.peek();
  if (quoteChar === `"` || quoteChar === `'`) {
    // Quoted attribute value
    ctx.advance(1); // Consume opening quote

    let escapeDepth = 0;
    let stringValue = "";

    while (!ctx.isAtEnd()) {
      // Check for dynamic value inside quotes
      const dynamicValue = ctx.peekDynamicValue();
      if (dynamicValue !== NO_DYNAMIC_VALUE) {
        // If we haven't accumulated any string value yet, use the dynamic value directly
        if (stringValue === "") {
          attrValue = dynamicValue;
        } else {
          // If we have accumulated string value, concatenate
          stringValue += String(dynamicValue);
          attrValue = stringValue;
        }
        ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
        continue;
      }

      // Make sure to handle escaped quotes in attribute values
      const nextChar = ctx.peek();
      if (nextChar === `\\`) {
        escapeDepth++;
      } else {
        // If our escape depth is 0 or an even number, the next quote char is not escaped and can
        // be treated as a closing quote.
        if (nextChar === quoteChar && escapeDepth % 2 === 0) {
          // Closing quote found
          ctx.advance(1); // Consume closing quote
          nextLexerFunction = lexAttributeName; // Transition back to attribute name lexing
          break;
        }

        escapeDepth = 0;
      }

      stringValue += ctx.advance(1);
      if (typeof attrValue === "string") {
        attrValue = stringValue;
      }
    }
  } else {
    // Unquoted attribute value
    let stringValue = "";
    while (!ctx.isAtEnd()) {
      const nextChar = ctx.peek();
      if (isWhiteSpace(nextChar) || nextChar === ">" || (nextChar === "/" && ctx.peekMatch("/>", 0))) {
        // End of unquoted attribute value
        nextLexerFunction = lexAttributeName; // Transition back to attribute name lexing
        break;
      } else {
        stringValue += ctx.advance(1);
      }
    }
    attrValue = stringValue;
  }

  if (attrValue !== "") {
    yield [TOKEN_TYPE.ATTR_VALUE, attrValue];
  }

  return nextLexerFunction;
}

const lexSelfClosingTagEnd: LexerFunction<"SELF_CLOSING_TAG_END" | "ERROR"> = function* (ctx) {
  // Skip the opening "/>"
  const skipped = ctx.advance(2);
  if (skipped !== "/>") {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexSelfClosingTagEnd received invalid self-closing tag end sequence "${skipped}"`)];
    return null;
  }

  yield [TOKEN_TYPE.SELF_CLOSING_TAG_END, null];
  return lexTextContent;
};

const lexClosingTag: LexerFunction<"CLOSING_TAGNAME" | "ERROR"> = function* (ctx) {
  // Skip the opening "</"
  const skipped = ctx.advance(2);
  if (skipped !== "</") {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexClosingTag received invalid closing tag opening sequence "${skipped}"`)];
    return null;
  }

  let nextLexerFunction: LexerFunction<any> | null = null;
  let tagName: string | Function = "";
  let hasFinishedConsumingTagName = false;

  while (!ctx.isAtEnd()) {
    const nextChar = ctx.peek();

    if (nextChar === ">") {
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
        if (typeof dynamicValue === "function" && tagName === "") {
          // Component closing tag (only if we haven't started consuming a string tag name)
          tagName = dynamicValue;
          ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
          hasFinishedConsumingTagName = true;
          continue;
        } else {
          // Dynamic string tag name or part of tag name
          tagName += String(dynamicValue);
          ctx.advance(DYNAMIC_VALUE_CHARACTER_SEQUENCE_LENGTH);
          // Continue to see if there's more to the tag name
          continue;
        }
      }

      if (tagName.length === 0 && isLetter(nextChar) || isValidHTMLTagNameChar(nextChar)) {
        tagName += ctx.advance(1);
      } else {
        hasFinishedConsumingTagName = true;
        ctx.advance(1);
      }
    }
  }

  if (
    typeof tagName === "string" &&
    tagName !== "" &&
    !isValidHTMLTagName(tagName)
  ) {
    yield [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexClosingTag received invalid tag name "${tagName}".`)];
    return null;
  }

  yield [TOKEN_TYPE.CLOSING_TAGNAME, tagName];
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
      const endIndex = startIndex + peekLength;

      return htmlString.slice(startIndex, Math.min(endIndex, htmlStringLength));
    },
    peekMatch(matchString: string, peekOffset = 0) {
      const peekedString = this.peek(matchString.length, peekOffset);
      return peekedString === matchString;
    },
    peekDynamicValue(peekOffset = 0) {
      if (!this.peekMatch(DYNAMIC_VALUE_PLACEHOLDER_PREFIX, peekOffset)) {
        return NO_DYNAMIC_VALUE;
      }

      const dynamicValueIndex = htmlString.charCodeAt(charIndex + peekOffset + 1);
      const dynamicValue = dynamicValues[dynamicValueIndex];

      return dynamicValue;
    },
    advance(advanceLength = 1) {
      return htmlString.slice(charIndex, (charIndex = Math.min(charIndex + advanceLength, htmlStringLength)));
    },
    isAtEnd() {
      return charIndex >= htmlString.length;
    },
  };

  let lexerFunction: LexerFunction<any> | null = lexTextContent;
  while (lexerFunction !== null) {
    lexerFunction = yield* lexerFunction(lexerContext);
  }
}