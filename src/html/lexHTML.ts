import { DYNAMIC_VALUE_PLACEHOLDER_PREFIX, DYNAMIC_VALUE_PLACEHOLDER_SUFFIX, isLetter, isWhiteSpace } from "./utils.ts";

// TODO:
// - Handle component tags (tags where the tag name is a function placeholder)
// - Resolve dynamic value placeholders; a dynamic value can appear anywhere so all lexer functions need to be aware of them.
//   - A util for matching and extracting dynamic value placeholders would be helpful here.
// - Ensure all error cases are handled gracefully and produce useful error messages.

const TOKEN_TYPE = {
  ERROR: 0,
  TEXT: 10,
  OPENING_TAGNAME: 20,
  OPENING_TAG_END: 21,
  SELF_CLOSING_TAG_END: 22,
  CLOSING_TAGNAME: 23,
  ATTR_NAME: 30,
  ATTR_VALUE: 31,
  COMMENT: 40,
  DOCTYPE: 50,
} as const satisfies Record<string, number>;

type LexerTokenName = keyof typeof TOKEN_TYPE;
type LexerTokenType = typeof TOKEN_TYPE[LexerTokenName];

type LexerTokenTypesWithNoValue = typeof TOKEN_TYPE.OPENING_TAG_END | typeof TOKEN_TYPE.SELF_CLOSING_TAG_END;
type LexerTokensWithValue = Exclude<LexerTokenType, LexerTokenTypesWithNoValue>;

type LexerToken = {
  ty: LexerTokenType;
  v?: string;
} & ({
  ty: LexerTokensWithValue;
  v: string;
} | {
  ty: LexerTokenTypesWithNoValue;
  v?: never;
});

type LexerContext<TTokenNames extends LexerTokenName = LexerTokenName> = {
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
  advance(advanceLength?: number): string;
  isAtEnd(): boolean;
  getDynamicValue(index: number): unknown;
  addToken(tokenType: Extract<LexerTokenTypesWithNoValue, typeof TOKEN_TYPE[TTokenNames]>, value?: never): void;
  addToken(tokenType: Extract<LexerTokensWithValue, typeof TOKEN_TYPE[TTokenNames]>, value: string): void;
}

/**
 * A function that performs lexing and returns the next lexer function to execute, or null if lexing is complete.
 */
type LexerFunction<TTokenNames extends LexerTokenName> = (ctx: LexerContext<TTokenNames>) => Promise<LexerFunction<any> | null>;

const lexTextContent: LexerFunction<"TEXT" | "ERROR"> = async (ctx) => {
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

        if (ctx.peekMatch(DYNAMIC_VALUE_PLACEHOLDER_PREFIX, 1)) {
          // If we find a dynamic value placeholder after the "<" and it maps to a function,
          // we treat it as a component tag.
          let peekOffset = 1 + DYNAMIC_VALUE_PLACEHOLDER_PREFIX.length;
          let indexChars = "";
          while (!ctx.peekMatch(DYNAMIC_VALUE_PLACEHOLDER_SUFFIX, peekOffset)) {
            indexChars += ctx.peek(1, peekOffset);
            peekOffset++;
          }
          const dynamicValueIndex = parseInt(indexChars, 10);
          const dynamicValue = ctx.getDynamicValue(dynamicValueIndex);
          if (typeof dynamicValue === "function") {
            // TRANSITION TO COMPONENT TAG
            // nextLexerFunction = lexComponentTag;
            break;
          }
        }
      }

      // We didn't find a transition point, so just consume the next character as text content
      textContent += ctx.advance(1);
    }

    if (textContent.length > 0) {
      // Skip text content token if empty
      ctx.addToken(TOKEN_TYPE.TEXT, textContent);
    }

    return nextLexerFunction;
  } catch (e) {
    ctx.addToken(TOKEN_TYPE.ERROR, (e instanceof Error) ? e.message : `Unknown lexing error: ${e}`);
    return null;
  }
}

const lexComment: LexerFunction<"COMMENT" | "ERROR"> = async (ctx) => {
  // Skip the opening "<!--"
  const skipped = ctx.advance(4);
  if (skipped !== "<!--") {
    ctx.addToken(TOKEN_TYPE.ERROR, `lexComment received invalid comment opening sequence "${skipped}"`);
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
    commentContent += ctx.advance(1);
  }

  ctx.addToken(TOKEN_TYPE.COMMENT, commentContent);
  return nextLexerFunction;
};

const lexDoctype: LexerFunction<"DOCTYPE" | "ERROR"> = async (ctx) => {
  // Skip the opening "<!DOCTYPE"
  const skipped = ctx.advance(9);
  if (skipped !== "<!DOCTYPE") {
    ctx.addToken(TOKEN_TYPE.ERROR, `lexDoctype received invalid doctype opening sequence "${skipped}"`);
    return null;
  }
  let nextLexerFunction: LexerFunction<any> | null = null;

  let doctypeContent = "";
  while (!ctx.isAtEnd()) {
    const nextChar = ctx.peek();
    if (nextChar === ">") {
      nextLexerFunction = lexTextContent;
      // Consume the closing ">"
      ctx.advance(1);
      break;
    }
    doctypeContent += ctx.advance(1);
  }

  ctx.addToken(TOKEN_TYPE.DOCTYPE, doctypeContent.trim());
  return nextLexerFunction;
}

const lexOpeningTagname: LexerFunction<"OPENING_TAGNAME" | "ERROR"> = async (ctx) => {
  // Skip the opening "<"
  const skipped = ctx.advance(1);
  if (skipped !== "<") {
    ctx.addToken(TOKEN_TYPE.ERROR, `lexOpeningTagname received invalid opening tag opening sequence "${skipped}"`);
    return null;
  }

  let nextLexerFunction: LexerFunction<any> | null = null;
  let tagName = "";

  while (!ctx.isAtEnd()) {
    const nextChar = ctx.peek();

    if (isLetter(nextChar)) {
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

  if (!tagName) {
    ctx.addToken(TOKEN_TYPE.ERROR, `lexOpeningTagname did not find a valid tag name.`);
    return null;
  }

  ctx.addToken(TOKEN_TYPE.OPENING_TAGNAME, tagName);
  return nextLexerFunction;
}

const lexAttributeName: LexerFunction<"ATTR_NAME" | "ERROR"> = async (ctx) => {
  let nextLexerFunction: LexerFunction<any> | null = null;
  let attrName = "";

  while (!ctx.isAtEnd()) {
    const nextChar = ctx.peek();

    // Attribute names can contain any non-terminating character.
    // Terminating characters are: whitespace, "=", ">", and "/>"
    if (nextChar === "=") {
      // Handle the case where there is no attribute name, just an "="
      if (!attrName) {
        ctx.addToken(TOKEN_TYPE.ERROR, `lexAttributeName did not find a valid attribute name.`);
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
    // Only add attribute name token if we found a valid name.
    // It's okay if we didn't as long as we're not transitioning to attribute value lexing.
    ctx.addToken(TOKEN_TYPE.ATTR_NAME, attrName);
  }

  return nextLexerFunction;
}

const lexAttributeValue: LexerFunction<"ATTR_VALUE" | "ERROR"> = async (ctx) => {
  const skipped = ctx.advance(1);
  if (skipped !== "=") {
    ctx.addToken(TOKEN_TYPE.ERROR, `lexAttributeValue expected "=" but found "${skipped}"`);
    return null;
  }

  let nextLexerFunction: LexerFunction<any> | null = null;
  let attrValue = "";

  // Consume leading whitespace
  while (!ctx.isAtEnd() && isWhiteSpace(ctx.peek())) {
    ctx.advance(1);
  }

  const quoteChar = ctx.peek();
  if (quoteChar === `"` || quoteChar === `'`) {
    // Quoted attribute value
    ctx.advance(1); // Consume opening quote

    let escapeDepth = 0;

    while (!ctx.isAtEnd()) {
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

      attrValue += ctx.advance(1);
    }
  } else {
    // Unquoted attribute value
    while (!ctx.isAtEnd()) {
      const nextChar = ctx.peek();
      if (isWhiteSpace(nextChar) || nextChar === ">" || (nextChar === "/" && ctx.peekMatch("/>", 0))) {
        // End of unquoted attribute value
        nextLexerFunction = lexAttributeName; // Transition back to attribute name lexing
        break;
      } else {
        attrValue += ctx.advance(1);
      }
    }
  }

  if (attrValue) {
    ctx.addToken(TOKEN_TYPE.ATTR_VALUE, attrValue);
  }

  return nextLexerFunction;
}

const lexSelfClosingTagEnd: LexerFunction<"SELF_CLOSING_TAG_END" | "ERROR"> = async (ctx) => {
  // Skip the opening "/>"
  const skipped = ctx.advance(2);
  if (skipped !== "/>") {
    ctx.addToken(TOKEN_TYPE.ERROR, `lextSelfClosingTagEnd received invalid self-closing tag end sequence "${skipped}"`);
    return null;
  }

  ctx.addToken(TOKEN_TYPE.SELF_CLOSING_TAG_END);
  return lexTextContent;
};

const lexClosingTag: LexerFunction<"CLOSING_TAGNAME" | "ERROR"> = async (ctx) => {
  // Skip the opening "</"
  const skipped = ctx.advance(2);
  if (skipped !== "</") {
    ctx.addToken(TOKEN_TYPE.ERROR, `lexClosingTag received invalid closing tag opening sequence "${skipped}"`);
    return null;
  }

  let nextLexerFunction: LexerFunction<any> | null = null;
  let tagName = "";
  let hasFinishedConsumingTagName = false;

  while (!ctx.isAtEnd()) {
    const nextChar = ctx.peek();

    if (nextChar === ">") {
      // Consume the closing ">" and transition back to text content lexing
      ctx.advance(1);
      nextLexerFunction = lexTextContent;
      break;
    } else if (isLetter(nextChar)) {
      if (!hasFinishedConsumingTagName) {
        tagName += ctx.advance(1);
      }
    } else if (isWhiteSpace(nextChar)) {
      // If we encounter whitespace, that means the tag name is complete.
      // We can keep going until we hit the closing ">" but any more characters
      // we encounter will be ignored.
      hasFinishedConsumingTagName = true;
      ctx.advance(1);
      continue;
    }
  }

  ctx.addToken(TOKEN_TYPE.CLOSING_TAGNAME, tagName);
  return nextLexerFunction;
};

export const lexHTML = async (htmlString: string, dynamicValues: unknown[]): Promise<LexerToken[]> => {
  const htmlStringLength = htmlString.length;

  let charIndex = 0;

  const tokens = new Array<LexerToken>();

  const lexerContext: LexerContext = {
    peek(peekLength = 1, peekOffset = 0): string {
      const startIndex = charIndex + peekOffset;
      const endIndex = startIndex + peekLength;

      // Otherwise, just use the length from the current index
      return htmlString.slice(startIndex, Math.min(endIndex, htmlStringLength));
    },
    peekMatch(matchString: string, peekOffset = 0): boolean {
      const peekedString = this.peek(matchString.length, peekOffset);
      return peekedString === matchString;
    },
    advance(advanceLength: number = 1): string {
      return htmlString.slice(charIndex, (charIndex = Math.min(charIndex + advanceLength, htmlStringLength)));
    },
    isAtEnd(): boolean {
      return charIndex >= htmlString.length;
    },
    getDynamicValue(index: number): unknown {
      return dynamicValues[index];
    },
    addToken(tokenType, value) {
      if (value === undefined) {
        tokens.push({ ty: tokenType as LexerTokenTypesWithNoValue });
      } else {
        tokens.push({ ty: tokenType as LexerTokensWithValue, v: value });
      }
    }
  };

  let lexerFunction: LexerFunction<any> | null = lexTextContent;
  while (lexerFunction !== null) {
    lexerFunction = await lexerFunction(lexerContext);
  }

  return tokens;
}