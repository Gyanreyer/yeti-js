import {
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { lexHTML, TOKEN_TYPE } from "./lexHTML.ts";
import type { LexerToken } from "./lexHTML.ts";
import { calculateStringByteLength, createDynamicValuePlaceholderString, DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH, getDynamicValuePlaceholderByteSequence, textEncoder } from "./utils.ts";
import { YetiHTMLParsingError } from "./error.ts";

const htmlTokens = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<LexerToken[]> => {
  const stringsCount = strings.length;
  const valuesCount = values.length;

  // Pre-calculate the total length of the combined string with dynamic value placeholders
  // to optimize memory allocation.
  let totalByteLength = 0;
  for (let i = 0; i < stringsCount; i++) {
    totalByteLength += calculateStringByteLength(strings[i]);
    if (i < valuesCount) {
      totalByteLength += DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH;
    }
  }

  const textCharBuffer = new Uint8Array(totalByteLength);

  // Use a map to de-dupe dynamic values and assign them unique indices for placeholders
  const uniqueValuesIndexMap = new Map<unknown, number>();
  const dynamicValues = [];

  let offset = 0;

  for (let i = 0; i < stringsCount; i++) {
    const str = strings[i];

    const { written } = textEncoder.encodeInto(str, textCharBuffer.subarray(offset));
    offset += written;

    if (i < valuesCount) {
      const value = values[i];
      let valueIndex = uniqueValuesIndexMap.get(value);
      if (valueIndex === undefined) {
        valueIndex = dynamicValues.push(value) - 1;
        uniqueValuesIndexMap.set(value, valueIndex);
      }

      // Dynamic value placeholders are represented as a character sequence:
      // [CHAR_CODE_DYNAMIC_VALUE_PLACEHOLDER, valueIndex]
      textCharBuffer.set(getDynamicValuePlaceholderByteSequence(valueIndex), offset);
      offset += DYNAMIC_VALUE_CHARACTER_SEQUENCE_BYTE_LENGTH;
    }
  }

  if (offset !== totalByteLength) {
    throw new Error(`Unexpected error while encoding template strings. Expected to write ${totalByteLength} bytes, but wrote ${offset} bytes.`);
  }

  const tokens: LexerToken[] = [];
  await lexHTML(textCharBuffer, dynamicValues, async (...token) => { tokens.push(token) });
  return tokens;
};

describe("lexHTML", () => {
  describe("DOCTYPE declaration", () => {
    test("lexes doctype declaration as expected", async () => {
      const tokens = await htmlTokens`<!DOCTYPE html>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.DOCTYPE_PART, "html"],
        [TOKEN_TYPE.DOCTYPE_END, null],
      ]);
    });

    test("trims doctype content value as expected", async () => {
      const tokens = await htmlTokens`<!DOCTYPE    html   >`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.DOCTYPE_PART, "html   "],
        [TOKEN_TYPE.DOCTYPE_END, null],
      ]);
    });

    test("handles doctype declarations with no content as expected", async () => {
      const tokens = await htmlTokens`<!DOCTYPE>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.DOCTYPE_END, null],
      ]);
    });

    test("handles doctype declarations with dynamic content as expected", async () => {
      const dynamicValue = "html";
      const tokens = await htmlTokens`<!DOCTYPE ${dynamicValue}>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.DOCTYPE_PART, "html"],
        [TOKEN_TYPE.DOCTYPE_END, null],
      ]);
    });

    test("handles doctype declarations with mixed dynamic and static content", async () => {
      const dynamicValue = "tm";
      const tokens = await htmlTokens`
<!DOCTYPE h${dynamicValue}>
<!DOCTYPE h${dynamicValue}l>
`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.DOCTYPE_PART, "h"],
        [TOKEN_TYPE.DOCTYPE_PART, "tm"],
        [TOKEN_TYPE.DOCTYPE_END, null],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.DOCTYPE_PART, "h"],
        [TOKEN_TYPE.DOCTYPE_PART, "tm"],
        [TOKEN_TYPE.DOCTYPE_PART, "l"],
        [TOKEN_TYPE.DOCTYPE_END, null],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
      ]);
    });
  });

  describe("HTML comments", () => {
    test("handles simple HTML comments as expected", async () => {
      const tokens = await htmlTokens`<!-- This is a comment -->`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.COMMENT_PART, " This is a comment "],
        [TOKEN_TYPE.COMMENT_END, null],
      ]);
    });

    test("handles comments with mixed dynamic values and static content as expected", async () => {
      const dynamicValue1 = "hello";
      const dynamicValue2 = 52;
      const dynamicValue3 = { foo: "bar" };
      const tokens = await htmlTokens`<!-- Comment with ${dynamicValue1}, ${dynamicValue2}, and ${dynamicValue3} -->`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.COMMENT_PART, ` Comment with `],
        [TOKEN_TYPE.COMMENT_PART, dynamicValue1],
        [TOKEN_TYPE.COMMENT_PART, `, `],
        [TOKEN_TYPE.COMMENT_PART, dynamicValue2],
        [TOKEN_TYPE.COMMENT_PART, `, and `],
        [TOKEN_TYPE.COMMENT_PART, dynamicValue3],
        [TOKEN_TYPE.COMMENT_PART, ` `],
        [TOKEN_TYPE.COMMENT_END, null],
      ]);
    });

    test("handles comments with only one dynamic value as expected", async () => {
      const dynamicValue1 = "hello";
      const dynamicValue2 = 52;
      const tokens = await htmlTokens`<!--${dynamicValue1}-->
<!-- ${dynamicValue2} -->`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.COMMENT_PART, `hello`],
        [TOKEN_TYPE.COMMENT_END, null],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.COMMENT_PART, ` `],
        [TOKEN_TYPE.COMMENT_PART, 52],
        [TOKEN_TYPE.COMMENT_PART, ` `],
        [TOKEN_TYPE.COMMENT_END, null],
      ]);
    });

    test("handles empty comments as expected", async () => {
      const tokens = await htmlTokens`<!---->`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.COMMENT_END, null],
      ]);
    });
  });

  describe("HTML content", () => {
    test("lexes empty string as expected", async () => {
      const tokens = await htmlTokens``;
      assert.deepStrictEqual<LexerToken[]>(tokens, []);
    });

    test("lexes a string with only whitespace as expected", async () => {
      const tokens = await htmlTokens`   \n`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.CHILD_CONTENT, "   \n"],
      ]);
    });

    test("lexes a single HTML element as expected", async () => {
      const tokens = await htmlTokens`<div></div>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("lexes self-closing HTML elements as expected", async () => {
      const tokens = await htmlTokens`<img />`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "img"],
        [TOKEN_TYPE.OPENING_TAG_END, true],
      ]);
    });

    test("lexes nested HTML elements as expected", async () => {
      const tokens = await htmlTokens`<div><span>Hello, world!</span></div>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.OPENING_TAGNAME, "span"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Hello, world!"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "span"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("moves past unescaped characters in text content as expected", async () => {
      const tokens = await htmlTokens`<div>Text with & < > " ' characters</div>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Text with & < > \" ' characters"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("handles dynamic values in text content as expected", async () => {
      const dynamicValue1 = "dynamicValue";
      const dynamicValue2 = 123;

      const tokens = await htmlTokens`<div>Text with ${dynamicValue1} and ${dynamicValue2} in it</div>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, `Text with `],
        [TOKEN_TYPE.CHILD_CONTENT, dynamicValue1],
        [TOKEN_TYPE.CHILD_CONTENT, " and "],
        [TOKEN_TYPE.CHILD_CONTENT, dynamicValue2],
        [TOKEN_TYPE.CHILD_CONTENT, " in it"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("handles multi-byte characters correctly", async () => {
      const tokens = await htmlTokens`<div>Emoji: 😀, Chinese: 你好, Cyrillic: Привет</div>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Emoji: 😀, Chinese: 你好, Cyrillic: Привет"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("handles tags with raw text content correctly", async () => {
      const tokens = await htmlTokens`<script>
  const x = "<div>Not a tag</div>";
  const y = \`<script>This is not a real script</script>\`;
</script>
<style>
  .class { content: "<div>Not a tag</div>"; }
  .class2 { content: '<style>This is not a real style</style>'; }
</style>
<title>This is a title with <div>what looks like a tag</div> inside it</title>
<textarea>This is some text content with <div>what looks like a tag</div> inside it</textarea>`;

      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "script"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, '\n  const x = "<div>Not a tag</div>";\n  const y = `<script>This is not a real script</script>`;\n'],
        [TOKEN_TYPE.CLOSING_TAGNAME, "script"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, "style"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, `\n  .class { content: "<div>Not a tag</div>"; }\n  .class2 { content: '<style>This is not a real style</style>'; }\n`],
        [TOKEN_TYPE.CLOSING_TAGNAME, "style"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, "title"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "This is a title with <div>what looks like a tag</div> inside it"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "title"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, "textarea"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "This is some text content with <div>what looks like a tag</div> inside it"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "textarea"],
      ]);
    });

    test("resolves dynamic values in raw text content correctly", async () => {
      const dynamicValue1 = "dynamicValue";
      const tokens = await htmlTokens`<script>const x = "${dynamicValue1}";</script>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "script"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, 'const x = "'],
        [TOKEN_TYPE.CHILD_CONTENT, dynamicValue1],
        [TOKEN_TYPE.CHILD_CONTENT, '";'],
        [TOKEN_TYPE.CLOSING_TAGNAME, "script"],
      ]);
    });

    test("handles dynamic string tagnames as expected", async () => {
      const dynamicTagName1 = "my-dynamic-tag";
      const dynamicTagNamePart1 = "my";
      const dynamicTagNamePart2 = 3;

      const tokens = await htmlTokens`
<${dynamicTagName1}></${dynamicTagName1}>
<${dynamicTagNamePart1}-tag></${dynamicTagNamePart1}-tag>
<h${dynamicTagNamePart2}></h${dynamicTagNamePart2}>
`;

      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, dynamicTagName1],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CLOSING_TAGNAME, dynamicTagName1],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, `${dynamicTagNamePart1}-tag`],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CLOSING_TAGNAME, `${dynamicTagNamePart1}-tag`],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, `h${dynamicTagNamePart2}`],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CLOSING_TAGNAME, `h${dynamicTagNamePart2}`],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
      ]);
    });

    test("yields an error token for invalid tagnames", async () => {
      const invalidDynamicTagName = "invalid tag name";
      let tokens = await htmlTokens`<${invalidDynamicTagName}></${invalidDynamicTagName}>`;

      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname received invalid tag name "${invalidDynamicTagName}".`)],
      ]);

      tokens = await htmlTokens`<ab#$^E%><ab#$^E%>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexOpeningTagname encountered unexpected character "#". This is not a valid character for an HTML tag name.`)],
      ]);
    });

    test("lexes a standard static HTML page as expected", async () => {
      const tokens = await htmlTokens`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test Page</title>
  </head>
  <body>
    <h1>Hello, world!</h1>
    <p>This is a test page.</p>
  </body>
</html>
`;

      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.DOCTYPE_PART, "html"],
        [TOKEN_TYPE.DOCTYPE_END, null],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.OPENING_TAGNAME, "html"],
        [TOKEN_TYPE.ATTR_NAME, "lang"],
        [TOKEN_TYPE.ATTR_VALUE, "en"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "\n  "],
        [TOKEN_TYPE.OPENING_TAGNAME, "head"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "\n    "],
        [TOKEN_TYPE.OPENING_TAGNAME, "meta"],
        [TOKEN_TYPE.ATTR_NAME, "charset"],
        [TOKEN_TYPE.ATTR_VALUE, "UTF-8"],
        [TOKEN_TYPE.OPENING_TAG_END, true],
        [TOKEN_TYPE.CHILD_CONTENT, "\n    "],
        [TOKEN_TYPE.OPENING_TAGNAME, "meta"],
        [TOKEN_TYPE.ATTR_NAME, "name"],
        [TOKEN_TYPE.ATTR_VALUE, "viewport"],
        [TOKEN_TYPE.ATTR_NAME, "content"],
        [TOKEN_TYPE.ATTR_VALUE, "width=device-width, initial-scale=1.0"],
        [TOKEN_TYPE.OPENING_TAG_END, true],
        [TOKEN_TYPE.CHILD_CONTENT, "\n    "],
        [TOKEN_TYPE.OPENING_TAGNAME, "title"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Test Page"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "title"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n  "],
        [TOKEN_TYPE.CLOSING_TAGNAME, "head"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n  "],
        [TOKEN_TYPE.OPENING_TAGNAME, "body"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "\n    "],
        [TOKEN_TYPE.OPENING_TAGNAME, "h1"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Hello, world!"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "h1"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n    "],
        [TOKEN_TYPE.OPENING_TAGNAME, "p"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "This is a test page."],
        [TOKEN_TYPE.CLOSING_TAGNAME, "p"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n  "],
        [TOKEN_TYPE.CLOSING_TAGNAME, "body"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "html"],
        [TOKEN_TYPE.CHILD_CONTENT, "\n"],
      ]);
    });
  });

  describe("HTML attributes", () => {
    test("lexes attributes with static values as expected", async () => {
      const tokens = await htmlTokens`<input type="text" disabled>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "input"],
        [TOKEN_TYPE.ATTR_NAME, "type"],
        [TOKEN_TYPE.ATTR_VALUE, "text"],
        [TOKEN_TYPE.ATTR_NAME, "disabled"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("handles attribute values with a combination of static and dynamic parts correctly", async () => {
      const dynamicValuePart1 = "dynamic";
      const dynamicValuePart2 = 123;

      const tokens = await htmlTokens`<div attr="${dynamicValuePart1}-static-${dynamicValuePart2}">`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, "attr"],
        [TOKEN_TYPE.ATTR_VALUE, "dynamic"],
        [TOKEN_TYPE.ATTR_VALUE, "-static-"],
        [TOKEN_TYPE.ATTR_VALUE, 123],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("lexes dynamic values in attributes as expected", async () => {
      const dynamicValue1 = "dynamicValue";
      const dynamicValue2 = 0;
      const dynamicValue3 = { foo: "bar" };

      const tokens = await htmlTokens`<div attr1="${dynamicValue1}" attr2=${dynamicValue2} attr3=${dynamicValue3} attr4="${dynamicValue2}${dynamicValue3}" attr5="${dynamicValue2}-static">`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, "attr1"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue1],
        [TOKEN_TYPE.ATTR_NAME, "attr2"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue2],
        [TOKEN_TYPE.ATTR_NAME, "attr3"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue3],
        [TOKEN_TYPE.ATTR_NAME, "attr4"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue2],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue3],
        [TOKEN_TYPE.ATTR_NAME, "attr5"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue2],
        [TOKEN_TYPE.ATTR_VALUE, "-static"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("handles escaped quote characters in attribute values as expected", async () => {
      const tokens = await htmlTokens`<div attr="This is a \\"quoted\\" value" attr2='This \\'too\\''>`;

      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, "attr"],
        [TOKEN_TYPE.ATTR_VALUE, 'This is a \\"quoted\\" value'],
        [TOKEN_TYPE.ATTR_NAME, "attr2"],
        [TOKEN_TYPE.ATTR_VALUE, "This \\'too\\'"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("lexes dynamic attribute names as expected", async () => {
      const dynamicAttrName1 = "data-attr1";
      // Numbers are allowed as attribute names in HTML (eg, <div 1="value"> is valid HTML), so we should support them as dynamic attribute names as well.
      const dynamicAttrName2 = 1;
      const dynamicAttrPart1 = "data";
      const dynamicAttrPart2 = 3;

      const tokens = await htmlTokens`<div
  ${dynamicAttrName1}="value1"
  ${dynamicAttrName2}="value2"
  ${dynamicAttrPart1}-part="value3"
  part-${dynamicAttrPart2}="value4"
>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, dynamicAttrName1],
        [TOKEN_TYPE.ATTR_VALUE, "value1"],
        [TOKEN_TYPE.ATTR_NAME, String(dynamicAttrName2)],
        [TOKEN_TYPE.ATTR_VALUE, "value2"],
        [TOKEN_TYPE.ATTR_NAME, `${dynamicAttrPart1}-part`],
        [TOKEN_TYPE.ATTR_VALUE, "value3"],
        [TOKEN_TYPE.ATTR_NAME, `part-${dynamicAttrPart2}`],
        [TOKEN_TYPE.ATTR_VALUE, "value4"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("returns error token for dynamic attribute names which aren't valid attribute names", async () => {
      const dynamicAttrName1 = "invalid attribute name";

      const tokens = await htmlTokens`<div ${dynamicAttrName1}="value1">`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${dynamicAttrName1}"`)],
      ]);

      const dynamicAttrName2 = { foo: "bar" };

      const tokens2 = await htmlTokens`<div ${dynamicAttrName2}="value1">`;
      assert.deepStrictEqual<LexerToken[]>(tokens2, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${dynamicAttrName2}"`)],
      ]);
    });

    test("lexes spread attributes as expected", async () => {
      const dynamicSpreadValue = { foo: "bar" };

      const tokens = await htmlTokens`<div attr1="value1" ...="hi" ...${dynamicSpreadValue} attr2="value2">`;

      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, "attr1"],
        [TOKEN_TYPE.ATTR_VALUE, "value1"],
        // "..." is a valid attribute name, so it should only be treated as a spread attribute if it appears
        // at the start of an attribute and is followed by a dynamic value placeholder.
        [TOKEN_TYPE.ATTR_NAME, "..."],
        [TOKEN_TYPE.ATTR_VALUE, "hi"],
        [TOKEN_TYPE.SPREAD_ATTR, dynamicSpreadValue],
        [TOKEN_TYPE.ATTR_NAME, "attr2"],
        [TOKEN_TYPE.ATTR_VALUE, "value2"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("handles boolean attributes with no value as expected", async () => {
      const tokens = await htmlTokens`<input type>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "input"],
        [TOKEN_TYPE.ATTR_NAME, "type"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("handles attributes with unquoted values as expected", async () => {
      const tokens = await htmlTokens`<input type=text disabled=true>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "input"],
        [TOKEN_TYPE.ATTR_NAME, "type"],
        [TOKEN_TYPE.ATTR_VALUE, "text"],
        [TOKEN_TYPE.ATTR_NAME, "disabled"],
        [TOKEN_TYPE.ATTR_VALUE, "true"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("handles attibutes with spaces around the equals sign as expected", async () => {
      const tokens = await htmlTokens`<input type = "text" disabled = 
        true>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "input"],
        [TOKEN_TYPE.ATTR_NAME, "type"],
        [TOKEN_TYPE.ATTR_VALUE, "text"],
        [TOKEN_TYPE.ATTR_NAME, "disabled"],
        [TOKEN_TYPE.ATTR_VALUE, "true"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });

    test("handles an equals sign as an attribute name", async () => {
      // The HTML spec allows an equals sign to be the first character of an attribute name,
      // so we will allow this edge case
      const tokens = await htmlTokens`<div = ="value" =data-test=true></div>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, "="],
        [TOKEN_TYPE.ATTR_VALUE, "value"],
        [TOKEN_TYPE.ATTR_NAME, "=data-test"],
        [TOKEN_TYPE.ATTR_VALUE, "true"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("handles unquoted attribute value which mixes dynamic and static content", async () => {
      const dynamicValue = "dynamic";

      const tokens = await htmlTokens`<div attr=static-${dynamicValue} attr2=${dynamicValue}-static>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.ATTR_NAME, "attr"],
        [TOKEN_TYPE.ATTR_VALUE, "static-"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue],
        [TOKEN_TYPE.ATTR_NAME, "attr2"],
        [TOKEN_TYPE.ATTR_VALUE, dynamicValue],
        [TOKEN_TYPE.ATTR_VALUE, "-static"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
      ]);
    });
  });

  describe("components", () => {
    test("lexes self-closing components as expected", async () => {
      const MyComponent = () => "hello";
      const tokens = await htmlTokens`<${MyComponent} prop1='value1' />`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, MyComponent],
        [TOKEN_TYPE.ATTR_NAME, "prop1"],
        [TOKEN_TYPE.ATTR_VALUE, "value1"],
        [TOKEN_TYPE.OPENING_TAG_END, true],
      ]);
    });

    test("lexes components with child content as expected", async () => {
      const MyComponent = () => "hello";
      const tokens = await htmlTokens`<${MyComponent} prop1='value1'>Child content</${MyComponent}>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, MyComponent],
        [TOKEN_TYPE.ATTR_NAME, "prop1"],
        [TOKEN_TYPE.ATTR_VALUE, "value1"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Child content"],
        [TOKEN_TYPE.CLOSING_TAGNAME, MyComponent],
      ]);
    });

    test("lexes components with shorthand closing tags as expected", async () => {
      const MyComponent = () => "hello";
      const tokens = await htmlTokens`<${MyComponent} prop1='value1'>Child content</>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, MyComponent],
        [TOKEN_TYPE.ATTR_NAME, "prop1"],
        [TOKEN_TYPE.ATTR_VALUE, "value1"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Child content"],
        [TOKEN_TYPE.CLOSING_TAGNAME, ""],
      ]);
    });
  });

  describe("closing tags", () => {
    test("handles closing tags with trailing whitespace as expected", async () => {
      const tokens = await htmlTokens`<div>Content</div   >`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Content"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("handles closing tags with dynamic tag names as expected", async () => {
      const dynamicTagName = "div";
      const tokens = await htmlTokens`<div>Content</${dynamicTagName}>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Content"],
        [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
      ]);
    });

    test("handles closing tags with shorthand syntax as expected", async () => {
      const tokens = await htmlTokens`<div>Content</>`;
      assert.deepStrictEqual<LexerToken[]>(tokens, [
        [TOKEN_TYPE.OPENING_TAGNAME, "div"],
        [TOKEN_TYPE.OPENING_TAG_END, false],
        [TOKEN_TYPE.CHILD_CONTENT, "Content"],
        [TOKEN_TYPE.CLOSING_TAGNAME, ""],
      ]);
    });
  });

  describe("error handling", () => {
    test("throws an error if a dynamic value placeholder index doesn't map to a value in the dynamic values array", async () => {
      await assert.rejects(() =>
        lexHTML(textEncoder.encode(`<div>${createDynamicValuePlaceholderString(0)}</div>`), [], async () => { }),
        new YetiHTMLParsingError(`Invalid dynamic value index 0 encoded at position 5.`));
    });
  });
});