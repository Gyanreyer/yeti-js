import {
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { lexHTML, TOKEN_TYPE, type LexerToken } from "./lexHTML.ts";
import { makeDynamicValuePlaceholder, stringToUint16CharCodeArray } from "./utils.ts";
import { YetiHTMLParsingError } from "./error.ts";

describe("lexHTML", () => {
  test("lexes empty string as expected", async () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray(""), []));
    assert.deepStrictEqual(tokens, []);
  });

  test("lexes a string with only whitespace as expected", async () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray("   \n"), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.CHILD_CONTENT, "   \n"],
    ] satisfies LexerToken[]);
  });

  test("lexes doctype declaration as expected", () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray("<!DOCTYPE html>"), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.DOCTYPE, "html"],
    ] satisfies LexerToken[]);
  });

  test("trims doctype content value as expected", () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray("<!DOCTYPE    html   >"), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.DOCTYPE, "html"],
    ] satisfies LexerToken[]);
  });

  test("lexes a single HTML element as expected", () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray("<div></div>"), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "div"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
      [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
    ] satisfies LexerToken[]);
  });

  test("lexes self-closing HTML elements as expected", () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray("<img />"), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "img"],
      [TOKEN_TYPE.OPENING_TAG_END, true],
    ] satisfies LexerToken[]);
  });

  test("lexes nested HTML elements as expected", () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray("<div><span>Hello, world!</span></div>"), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "div"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
      [TOKEN_TYPE.OPENING_TAGNAME, "span"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
      [TOKEN_TYPE.CHILD_CONTENT, "Hello, world!"],
      [TOKEN_TYPE.CLOSING_TAGNAME, "span"],
      [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
    ] satisfies LexerToken[]);
  });

  test("lexes attributes with static values as expected", () => {
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray('<input type="text" disabled>'), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "input"],
      [TOKEN_TYPE.ATTR_NAME, "type"],
      [TOKEN_TYPE.ATTR_VALUE, "text"],
      [TOKEN_TYPE.ATTR_NAME, "disabled"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
    ] satisfies LexerToken[]);
  });

  test("lexes self-closing components as expected", () => {
    const MyComponent = () => "hello";
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray(`<${makeDynamicValuePlaceholder(0)} prop1='value1' />`), [MyComponent]));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, MyComponent],
      [TOKEN_TYPE.ATTR_NAME, "prop1"],
      [TOKEN_TYPE.ATTR_VALUE, "value1"],
      [TOKEN_TYPE.OPENING_TAG_END, true],
    ] satisfies LexerToken[]);
  });

  test("lexes components with child content as expected", () => {
    const MyComponent = () => "hello";
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray(`<${makeDynamicValuePlaceholder(0)} prop1='value1'>Child content</${makeDynamicValuePlaceholder(1)}>`), [MyComponent, MyComponent]));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, MyComponent],
      [TOKEN_TYPE.ATTR_NAME, "prop1"],
      [TOKEN_TYPE.ATTR_VALUE, "value1"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
      [TOKEN_TYPE.CHILD_CONTENT, "Child content"],
      [TOKEN_TYPE.CLOSING_TAGNAME, MyComponent],
    ] satisfies LexerToken[]);
  });

  test("lexes components with shorthand closing tags as expected", () => {
    const MyComponent = () => "hello";
    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray(`<${makeDynamicValuePlaceholder(0)} prop1='value1'>Child content</>`), [MyComponent]));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, MyComponent],
      [TOKEN_TYPE.ATTR_NAME, "prop1"],
      [TOKEN_TYPE.ATTR_VALUE, "value1"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
      [TOKEN_TYPE.CHILD_CONTENT, "Child content"],
      [TOKEN_TYPE.CLOSING_TAGNAME, ""],
    ] satisfies LexerToken[]);
  });

  test("lexes dynamic values in attributes as expected", () => {
    const dynamicValue1 = "dynamicValue";
    const dynamicValue2 = 0;
    const dynamicValue3 = { foo: "bar" };

    const tokens = Array.from(lexHTML(
      stringToUint16CharCodeArray(
        `<div attr1="${makeDynamicValuePlaceholder(0)
        }" attr2=${makeDynamicValuePlaceholder(1)
        } attr3=${makeDynamicValuePlaceholder(2)
        }>`),
      [dynamicValue1, dynamicValue2, dynamicValue3],
    ));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "div"],
      [TOKEN_TYPE.ATTR_NAME, "attr1"],
      [TOKEN_TYPE.ATTR_VALUE, dynamicValue1],
      [TOKEN_TYPE.ATTR_NAME, "attr2"],
      [TOKEN_TYPE.ATTR_VALUE, dynamicValue2],
      [TOKEN_TYPE.ATTR_NAME, "attr3"],
      [TOKEN_TYPE.ATTR_VALUE, dynamicValue3],
      [TOKEN_TYPE.OPENING_TAG_END, false],
    ] satisfies LexerToken[]);
  });

  test("moves past unescaped characters in text content as expected", () => {
    const tokens = Array.from(lexHTML(
      stringToUint16CharCodeArray(
        "<div>Text with & < > \" ' characters</div>"
      ), [],
    ));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "div"],
      [TOKEN_TYPE.OPENING_TAG_END, false],
      [TOKEN_TYPE.CHILD_CONTENT, "Text with & < > \" ' characters"],
      [TOKEN_TYPE.CLOSING_TAGNAME, "div"],
    ] satisfies LexerToken[]);
  });

  test("lexes dynamic attribute names as expected", () => {
    const dynamicAttrName1 = "data-attr1";
    // Numbers are allowed as attribute names in HTML (eg, <div 1="value"> is valid HTML), so we should support them as dynamic attribute names as well.
    const dynamicAttrName2 = 1;
    const dynamicAttrPart1 = "data";
    const dynamicAttrPart2 = 3;

    const tokens = Array.from(lexHTML(
      stringToUint16CharCodeArray(
        `<div
  ${makeDynamicValuePlaceholder(0)}="value1"
  ${makeDynamicValuePlaceholder(1)}="value2"
  ${makeDynamicValuePlaceholder(2)}-part="value3"
  part-${makeDynamicValuePlaceholder(3)}="value4"
>`,
      ), [
      dynamicAttrName1,
      dynamicAttrName2,
      dynamicAttrPart1,
      dynamicAttrPart2,
    ]));
    assert.deepStrictEqual(tokens, [
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
    ] satisfies LexerToken[]);
  });

  test("returns error token for dynamic attribute names which aren't valid attribute names", () => {
    const dynamicAttrName1 = "invalid attribute name";

    const tokens = Array.from(lexHTML(
      stringToUint16CharCodeArray(
        `<div ${makeDynamicValuePlaceholder(0)}="value1">`
      ), [dynamicAttrName1],
    ));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.OPENING_TAGNAME, "div"],
      [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${dynamicAttrName1}"`)],
    ] satisfies LexerToken[]);

    const dynamicAttrName2 = { foo: "bar" };

    const tokens2 = Array.from(lexHTML(
      stringToUint16CharCodeArray(
        `<div ${makeDynamicValuePlaceholder(0)}="value1">`
      ), [dynamicAttrName2],
    ));
    assert.deepStrictEqual(tokens2, [
      [TOKEN_TYPE.OPENING_TAGNAME, "div"],
      [TOKEN_TYPE.ERROR, new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${dynamicAttrName2}"`)],
    ] satisfies LexerToken[]);
  });

  test("lexes spread attributes as expected", () => {
    const dynamicSpreadValue = { foo: "bar" };

    const tokens = Array.from(lexHTML(
      stringToUint16CharCodeArray(
        `<div attr1="value1" ...="hi" ...${makeDynamicValuePlaceholder(0)} attr2="value2">`
      ), [dynamicSpreadValue],
    ));

    assert.deepStrictEqual(tokens, [
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
    ] satisfies LexerToken[]);
  });

  test("lexes dynamic string tagnames as expected", () => {
    const dynamicTagName1 = "my-dynamic-tag";
    const dynamicTagNamePart1 = "my";
    const dynamicTagNamePart2 = 3;

    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray(`
<${makeDynamicValuePlaceholder(0)}></${makeDynamicValuePlaceholder(1)}>
<${makeDynamicValuePlaceholder(2)}-tag></${makeDynamicValuePlaceholder(3)}-tag>
<h${makeDynamicValuePlaceholder(4)}></h${makeDynamicValuePlaceholder(5)}>
`), [
      dynamicTagName1, dynamicTagName1,
      dynamicTagNamePart1, dynamicTagNamePart1,
      dynamicTagNamePart2, dynamicTagNamePart2,
    ],
    ));

    assert.deepStrictEqual(tokens, [
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
    ] satisfies LexerToken[]);
  });

  test("lexes a standard static HTML page as expected", () => {
    const html = `<!DOCTYPE html>
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

    const tokens = Array.from(lexHTML(stringToUint16CharCodeArray(html), []));
    assert.deepStrictEqual(tokens, [
      [TOKEN_TYPE.DOCTYPE, "html"],
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
    ] satisfies LexerToken[]);
  });
});