import {
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { lexHTML, TOKEN_TYPE } from "./lexHTML.ts";
import { makeDynamicValuePlaceholder } from "./utils.ts";

describe("lexHTML", () => {
  test("lexes empty string as expected", async () => {
    const tokens = await lexHTML("", []);
    assert.deepStrictEqual(tokens, []);
  });

  test("lexes a string with only whitespace as expected", async () => {
    const tokens = await lexHTML("   \n", []);
    assert.deepStrictEqual(tokens, [{
      ty: TOKEN_TYPE.CHILD_CONTENT,
      value: "   \n",
    }]);
  });

  test("lexes doctype declaration as expected", () => {
    const tokens = lexHTML("<!DOCTYPE html>", []);
    assert.deepStrictEqual(tokens, [{
      ty: TOKEN_TYPE.DOCTYPE,
      value: "html",
    }]);
  });

  test("lexes a single HTML element as expected", () => {
    const tokens = lexHTML("<div></div>", []);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "div",
      },
    ]);
  });

  test("lexes self-closing HTML elements as expected", () => {
    const tokens = lexHTML("<img />", []);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "img",
      },
      {
        ty: TOKEN_TYPE.SELF_CLOSING_TAG_END,
      },
    ]);
  });

  test("lexes nested HTML elements as expected", () => {
    const tokens = lexHTML("<div><span>Hello, world!</span></div>", []);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "span",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "Hello, world!",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "span",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "div",
      },
    ]);
  });

  test("lexes attributes with static values as expected", () => {
    const tokens = lexHTML('<input type="text" disabled>', []);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "input",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "type",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "text",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "disabled",
      },
    ]);
  });

  test("lexes self-closing components as expected", () => {
    const MyComponent = () => "hello";
    const tokens = lexHTML(`<${makeDynamicValuePlaceholder(0)} prop1='value1' />`, [MyComponent]);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: MyComponent,
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "prop1",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value1",
      },
      {
        ty: TOKEN_TYPE.SELF_CLOSING_TAG_END,
      },
    ]);
  });

  test("lexes components with child content as expected", () => {
    const MyComponent = () => "hello";
    const tokens = lexHTML(`<${makeDynamicValuePlaceholder(0)} prop1='value1'>Child content</${makeDynamicValuePlaceholder(1)}>`, [MyComponent, MyComponent]);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: MyComponent,
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "prop1",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value1",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "Child content",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: MyComponent,
      },
    ]);
  });

  test.only("lexes components with shorthand closing tags as expected", () => {
    const MyComponent = () => "hello";
    const tokens = lexHTML(`<${makeDynamicValuePlaceholder(0)} prop1='value1'>Child content</>`, [MyComponent]);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: MyComponent,
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "prop1",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value1",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "Child content",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "",
      },
    ]);
  });

  test("lexes dynamic values in attributes as expected", () => {
    const dynamicValue1 = "dynamicValue";
    const dynamicValue2 = 0;
    const dynamicValue3 = { foo: "bar" };

    const tokens = lexHTML(`<div attr1="${makeDynamicValuePlaceholder(0)}" attr2=${makeDynamicValuePlaceholder(1)} attr3=${makeDynamicValuePlaceholder(2)}>`, [dynamicValue1, dynamicValue2, dynamicValue3]);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "attr1",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: dynamicValue1,
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "attr2",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: dynamicValue2,
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "attr3",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: dynamicValue3,
      },
    ]);
  });

  test("lexes dynamic attribute names as expected", () => {
    const dynamicAttrName1 = "data-attr1";
    // Numbers are allowed as attribute names in HTML (eg, <div 1="value"> is valid HTML), so we should support them as dynamic attribute names as well.
    const dynamicAttrName2 = 1;

    const tokens = lexHTML(`<div ${makeDynamicValuePlaceholder(0)}="value1" ${makeDynamicValuePlaceholder(1)}="value2">`, [dynamicAttrName1, dynamicAttrName2]);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: dynamicAttrName1,
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value1",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: String(dynamicAttrName2),
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value2",
      },
    ]);
  });

  test("returns error token for dynamic attribute names which aren't valid attribute names", () => {
    const dynamicAttrName1 = "invalid attribute name";

    const tokens = lexHTML(`<div ${makeDynamicValuePlaceholder(0)}="value1">`, [dynamicAttrName1]);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.ERROR,
        value: `Invalid dynamic attribute name: "${dynamicAttrName1}"`,
      },
    ]);

    const dynamicAttrName2 = { foo: "bar" };

    const tokens2 = lexHTML(`<div ${makeDynamicValuePlaceholder(0)}="value1">`, [dynamicAttrName2]);
    assert.deepStrictEqual(tokens2, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.ERROR,
        value: `Invalid dynamic attribute name: "${String(dynamicAttrName2)}"`,
      },
    ]);
  });

  test("lexes spread attributes as expected", () => {
    const dynamicSpreadValue = { foo: "bar" };

    const tokens = lexHTML(`<div attr1="value1" ...${makeDynamicValuePlaceholder(0)} attr2="value2">`, [dynamicSpreadValue]);

    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "div",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "attr1",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value1",
      },
      {
        ty: TOKEN_TYPE.SPREAD_ATTR,
        value: dynamicSpreadValue,
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "attr2",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "value2",
      },
    ]);
  });

  test("lexes dynamic string tagnames as expected", () => {
    const dynamicTagName1 = "my-dynamic-tag";
    const dynamicTagNamePart1 = "my";
    const dynamicTagNamePart2 = 3;

    const tokens = lexHTML(`
<${makeDynamicValuePlaceholder(0)}></${makeDynamicValuePlaceholder(1)}>
<${makeDynamicValuePlaceholder(2)}-tag></${makeDynamicValuePlaceholder(3)}-tag>
<h${makeDynamicValuePlaceholder(4)}></h${makeDynamicValuePlaceholder(5)}>
`, [
      dynamicTagName1, dynamicTagName1,
      dynamicTagNamePart1, dynamicTagNamePart1,
      dynamicTagNamePart2, dynamicTagNamePart2,
    ]);

    assert.deepStrictEqual(tokens, [
      { ty: TOKEN_TYPE.CHILD_CONTENT, value: "\n" },
      { ty: TOKEN_TYPE.OPENING_TAGNAME, value: dynamicTagName1 },
      { ty: TOKEN_TYPE.CLOSING_TAGNAME, value: dynamicTagName1 },
      { ty: TOKEN_TYPE.CHILD_CONTENT, value: "\n" },
      { ty: TOKEN_TYPE.OPENING_TAGNAME, value: `${dynamicTagNamePart1}-tag` },
      { ty: TOKEN_TYPE.CLOSING_TAGNAME, value: `${dynamicTagNamePart1}-tag` },
      { ty: TOKEN_TYPE.CHILD_CONTENT, value: "\n" },
      { ty: TOKEN_TYPE.OPENING_TAGNAME, value: `h${dynamicTagNamePart2}` },
      { ty: TOKEN_TYPE.CLOSING_TAGNAME, value: `h${dynamicTagNamePart2}` },
      { ty: TOKEN_TYPE.CHILD_CONTENT, value: "\n" },
    ]);
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

    const tokens = lexHTML(html, []);
    assert.deepStrictEqual(tokens, [
      {
        ty: TOKEN_TYPE.DOCTYPE,
        value: "html",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "html",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "lang",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "en",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n  ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "head",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n    ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "meta",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "charset",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "UTF-8",
      },
      {
        ty: TOKEN_TYPE.SELF_CLOSING_TAG_END,
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n    ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "meta",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "name",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "viewport",
      },
      {
        ty: TOKEN_TYPE.ATTR_NAME,
        value: "content",
      },
      {
        ty: TOKEN_TYPE.ATTR_VALUE,
        value: "width=device-width, initial-scale=1.0",
      },
      {
        ty: TOKEN_TYPE.SELF_CLOSING_TAG_END,
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n    ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "title",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "Test Page",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "title",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n  ",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "head",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n  ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "body",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n    ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "h1",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "Hello, world!",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "h1",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n    ",
      },
      {
        ty: TOKEN_TYPE.OPENING_TAGNAME,
        value: "p",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "This is a test page.",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "p",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n  ",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "body",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n",
      },
      {
        ty: TOKEN_TYPE.CLOSING_TAGNAME,
        value: "html",
      },
      {
        ty: TOKEN_TYPE.CHILD_CONTENT,
        value: "\n",
      },
    ]);
  });
});