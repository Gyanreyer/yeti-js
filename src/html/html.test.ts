import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { html } from "./html.ts";
import { YETI_NODE_TYPE, } from "./types.ts";
import type { YetiChildNode, YetiRootNode } from './types.ts';
import { YetiHTMLParsingError } from "./error.ts";

describe("html", () => {
  test("parses simple HTML with dynamic values", async () => {
    const name = "Alice";
    const age = 30;
    const result = await html`<div>Name: ${name}, Age: ${age}</div>`;

    assert.deepStrictEqual<YetiRootNode>(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Name: Alice, Age: 30",
            },
          ],
        },
      ],
    });
  });

  test("handles components as expected", async () => {
    const Component = ({ children }: { children: YetiChildNode[] }) => {
      return html`<span>${children}</span>`;
    };

    const AsyncComponent = async ({ children }: { children: YetiChildNode[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async work
      return html`<strong>${children}</strong>`;
    }

    const Page = ({ title }: { title: string }) => html`<!DOCTYPE html>
<html lang="en">
  <head>
    <title>${title}</title>
  </head>
  <body>
    <h1>${title}</h1>
    <${Component}>
      <p>Nested content in component</p>
    </${Component}>
    <${AsyncComponent}>Hello from async component</${AsyncComponent}>
  </body>
</html>`;

    const result = await Page({ title: "Test Page" });

    assert.deepStrictEqual<YetiRootNode>(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.DOCTYPE,
          content: "html",
        },
        {
          type: YETI_NODE_TYPE.TEXT,
          content: "\n",
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "html",
          attributes: { lang: "en" },
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "\n  ",
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "head",
              attributes: {},
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "title",
                  attributes: {},
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "Test Page",
                    },
                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n  ",
                },
              ],
            },
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "\n  ",
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "body",
              attributes: {},
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "h1",
                  attributes: {},
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "Test Page",
                    },
                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "span",
                  attributes: {},
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      ",
                    },
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: "p",
                      attributes: {},
                      children: [
                        {
                          type: YETI_NODE_TYPE.TEXT,
                          content: "Nested content in component",
                        },
                      ],
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n    ",
                    },

                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "strong",
                  attributes: {},
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "Hello from async component",
                    },
                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n  ",
                },
              ],
            },
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "\n",
            },
          ],
        },
      ],
    });
  });

  test("handles multi-byte characters correctly", async () => {
    const result = await html`<div>Emoji: 😀, Chinese: 你好, Cyrillic: Привет</div>`;
    assert.deepStrictEqual<YetiRootNode>(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Emoji: 😀, Chinese: 你好, Cyrillic: Привет",
            },
          ],
        },
      ],
    });
  });

  describe("HTML attributes", async () => {
    test("handles attributes with static values", async () => {
      const result = await html`<input type="text" disabled value='Hello' data-test=value />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "input",
            attributes: {
              type: "text",
              disabled: true,
              value: "Hello",
              "data-test": "value",
            },
            children: [],
          },
        ],
      });
    });

    test("handles attributes with dynamic values", async () => {
      const myObj = { key: "value" };
      const result = await html`<div
data-unquoted-dynamic=${myObj}
data-unquoted-dynamic-then-static=${myObj}-static
data-unquoted-static-then-dynamic=static-${myObj}
data-unquoted-static-then-dynamic-then-static=static-${myObj}-static

data-quoted-dynamic="${myObj}"
data-quoted-dynamic-then-static="${myObj}-static"
data-quoted-static-then-dynamic="static-${myObj}"
data-quoted-static-then-dynamic-then-static="static-${myObj}-static"
>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {
              "data-unquoted-dynamic": myObj,
              "data-unquoted-dynamic-then-static": "[object Object]-static",
              "data-unquoted-static-then-dynamic": `static-[object Object]`,
              "data-unquoted-static-then-dynamic-then-static": `static-[object Object]-static`,
              "data-quoted-dynamic": myObj,
              "data-quoted-dynamic-then-static": "[object Object]-static",
              "data-quoted-static-then-dynamic": `static-[object Object]`,
              "data-quoted-static-then-dynamic-then-static": `static-[object Object]-static`,
            },
            children: [],
          },
        ],
      });
    });

    test("handles boolean attributes terminated in different ways", async () => {
      // Boolean attributes terminated by another attribute, a spread operator, or the end
      // of the tag should all be treated as true
      const result = await html`<input checked type="checkbox" disabled ...${{
        "data-test": "value",
      }} readonly />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "input",
            attributes: {
              checked: true,
              type: "checkbox",
              disabled: true,
              "data-test": "value",
              readonly: true,
            },
            children: [],
          },
        ],
      });
    });

    test("handles escaped quote characters in attribute values", async () => {
      const result = await html`<div
        data-dq="Value with an escaped double-quote: \\" and more text"
        data-sq='Value with an escaped single-quote: \\' and more text'
        data-ends-with-backslash="Value that ends with a backslash: \\\\"
        >Content</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {
              "data-dq": 'Value with an escaped double-quote: \\" and more text',
              "data-sq": "Value with an escaped single-quote: \\' and more text",
              // The value for data-ends-with-backslash should end with a single backslash, but we have to escape it in the test string, so we use two backslashes here to represent a single backslash in the actual attribute value
              "data-ends-with-backslash": "Value that ends with a backslash: \\\\",
            },
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
            ],
          },
        ],
      });
    });

    test("handles dynamic attribute names", async () => {
      const dynamicAttrName = "invalid attribute name";

      await assert.rejects(() => html`<div ${dynamicAttrName}="value">Content</div>`,
        new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "${dynamicAttrName}"`)
      );
    });

    test("handles spread operators in attributes", async () => {
      const dynamicAttrs1 = {
        "data-dynamic": "firstValue",
        "aria-label": "Override label",
        "type": "submit",
      };
      const dynamicAttrs2 = {
        "data-dynamic": "secondValue",
      };
      const result = await html`<button aria-label="Hi" ...${dynamicAttrs1} type="button" ...${dynamicAttrs2}>Click me</button>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "button",
            attributes: {
              // aria-label from spreading dynamicAttrs1 should win
              "aria-label": "Override label",
              // data-dynamic from dynamicAttrs2 should win since it comes last
              "data-dynamic": "secondValue",
              // type should be "button" since the static attribute comes after spreading dynamicAttrs1
              type: "button",
            },
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Click me",
              },
            ],
          },
        ],
      });
    });

    test("handles whitespace around attribute equals signs", async () => {
      const result = await html`<input type = "text" disabled value=
      'Hello' data-test =value />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "input",
            attributes: {
              type: "text",
              disabled: true,
              value: "Hello",
              "data-test": "value",
            },
            children: [],
          },
        ],
      });
    });

    test("handles an equals sign as an attribute name", async () => {
      // This is an odd edge case, but the HTML spec seems to allow an equals sign to be used in an attribute name
      // as long as it's the first character.
      const result = await html`<div =="value" =data-test="test">Content</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {
              "=": "value",
              "=data-test": "test",
            },
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
            ],
          },
        ],
      });
    });
  });

  describe("opening tags", async () => { });

  describe("closing tags", async () => { });

  describe("child content", async () => { });

  describe("components", async () => { });

  describe("comments", async () => { });

  describe("DOCTYPE", async () => {
    test("parses standard DOCTYPE declarations", async () => {
      const result = await html`<!DOCTYPE html><div>Content</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {},
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
            ],
          },
        ],
      });
    });

    test("parses DOCTYPE declarations with extra whitespace", async () => {
      const result = await html`<!DOCTYPE    html   ><div>Content</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {},
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
            ],
          },
        ],
      });
    });

    test("parses DOCTYPE declaration with no content", async () => {
      const result = await html`<!DOCTYPE><div>Content</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {},
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
            ],
          },
        ],
      });
    });

    test("parses DOCTYPE declaration with dynamic content", async () => {
      const doctypeContent = "html";
      const result = await html`<!DOCTYPE ${doctypeContent}><div>Content</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {},
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
            ],
          },
        ],
      });
    });
  });
});