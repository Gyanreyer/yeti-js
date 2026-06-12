import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { html } from "./html.ts";
import { YETI_NODE_TYPE, } from "./types.ts";
import type { DocumentBundleAssets, YetiChildNode, YetiRootNode } from './types.ts';
import { YetiHTMLParsingError } from "../error.ts";
import { css } from "../css/css.ts";
import { js } from '../js/js.ts';

const makeBasicAssetsObject = (): DocumentBundleAssets => ({
  html: {
    dependencies: new Set([fileURLToPath(import.meta.url)]),
  }
});

describe("html", () => {
  describe("HTML attributes", async () => {
    test("handles attributes with static values", async () => {
      const result = await html`<input type="text" disabled value='Hello' data-test=value />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
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
        assets: makeBasicAssetsObject(),
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
        assets: makeBasicAssetsObject(),
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
        assets: makeBasicAssetsObject(),
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
        assets: makeBasicAssetsObject(),
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

    test("ignores spread operator with null or undefined value", async () => {
      const result = await html`<div ...${null} ...${undefined}></div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
          },
        ],
      });
    });

    test("throws an error if a spread operator is used with a non-object value", async () => {
      await assert.rejects(() => html`<div ...${"not an object"}>Content</div>`,
        new YetiHTMLParsingError(`Received invalid non-object value to spread operator in HTML: "not an object"`)
      );

      await assert.rejects(() => html`<div ...${42}>Content</div>`,
        new YetiHTMLParsingError(`Received invalid non-object value to spread operator in HTML: 42`)
      );
    });

    test("handles whitespace around attribute equals signs", async () => {
      const result = await html`<input type = "text" disabled value=
      'Hello' data-test =value />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
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
        assets: makeBasicAssetsObject(),
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

    test("passes a standalone symbol attribute through to a component as a prop key", async () => {
      const specialAttr = Symbol("special-attr");

      const MyComponent = ({ [specialAttr]: mySpecialAttrValue }: Record<symbol, string>) =>
        html`<div>Special Attr Value: ${mySpecialAttrValue}</div>`;

      const result = await html`<${MyComponent} ${specialAttr}="hello, world!" />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Special Attr Value: hello, world!",
              },
            ],
          },
        ],
      });
    });

    test("preserves a standalone symbol attribute name on a real element's attributes", async () => {
      const symbolAttr = Symbol("dropped");

      // The symbol survives parsing onto the element's attributes object just like on a component.
      // It only gets dropped later, at render time (see renderHTML.test.ts), since a Symbol is not
      // a valid HTML attribute name. The adjacent string attribute confirms normal attributes are
      // unaffected.
      const result = await html`<div ${symbolAttr}="ignored" data-keep="kept">Content</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {
              [symbolAttr]: "ignored",
              "data-keep": "kept",
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

  describe("opening tags", async () => {
    test("handles dynamic string tagnames", async () => {
      const dynamicTagName = "section";
      const result = await html`<${dynamicTagName}>Content</${dynamicTagName}>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "section",

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

    test("handles tagnames with mixed static and dynamic parts", async () => {
      const headingLevel = 3;
      const componentPrefix = "my-";
      const result = await html`<h${headingLevel}>Heading</h${headingLevel}><${componentPrefix}component>Component content</${componentPrefix}component>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "h3",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Heading",
              },
            ],
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "my-component",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Component content",
              },
            ],
          },
        ],
      });
    });

    test("handles content that looks like a tag name but doesn't start with a letter as text content", async () => {
      const dynamicTagNameStartingWithNumber = "123invalid";

      const result = await html`<${dynamicTagNameStartingWithNumber}>Content</${dynamicTagNameStartingWithNumber}><#tag>Not a tag</#tag>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            // Following HTML spec, the closing tags are stripped because they only need to start with "</" without
            // concern for whether the following tagname is valid or not.
            content: `<123invalid>Content<#tag>Not a tag`,
          },
        ],
      });
    });

    test("throws an error for invalid tagnames", async () => {
      const invalidTagName = "invalid tag";
      await assert.rejects(() => html`<${invalidTagName}>Content</${invalidTagName}>`,
        new YetiHTMLParsingError(`lexOpeningTagname received invalid tag name "${invalidTagName}".`)
      );

      await assert.rejects(() => html`<my-#$&>Content</my-#$&>`,
        new YetiHTMLParsingError(`lexOpeningTagname encountered unexpected character "#". This is not a valid character for an HTML tag name.`)
      );
    });

    test("handles void tags without a self-closing slash", async () => {
      const result = await html`<area><base><br><col><embed><hr><img><input><link><meta><param><source><track><wbr>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "area" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "base" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "br" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "col" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "embed" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "hr" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "img" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "input" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "link" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "meta" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "param" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "source" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "track" },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "wbr" },
        ],
      });
    });

    test("handles self-closing tags", async () => {
      const result = await html`<div />Content<br />More content<img src="image.jpg" />`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",


          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Content",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "br",


          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "More content",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "img",
            attributes: { src: "image.jpg" },

          },
        ]
      });
    });
  });

  describe("closing tags", async () => {
    test("a mismatched closing tag closes up to its first matching opening tag", async () => {
      const result = await html`<div><div><span>Content<section>Hello from section</div>In top div</div>In root`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "div",
                children: [
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "span",

                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "Content",
                      },
                      {
                        type: YETI_NODE_TYPE.ELEMENT,
                        tagName: "section",
                        children: [
                          {
                            type: YETI_NODE_TYPE.TEXT,
                            content: "Hello from section",
                          },
                        ],
                      }
                    ],
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "In top div",
              },
            ],
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "In root",
          }
        ],
      });
    });

    test("a mismatched closing tag that doesn't have a matching opening tag is ignored", async () => {
      const result = await html`<div>Content</span> More content</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content More content",
              },
            ],
          },
        ],
      });
    });

    test("an empty shorthand closing tag (</>) closes the most recently opened tag", async () => {
      const result = await html`<div><span><section>In section</>In span</>In div</>In root`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",
                children: [
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "section",
                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "In section",
                      }
                    ],
                  },
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "In span",
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "In div",
              },
            ],
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "In root",
          },
        ],
      });
    });

    test("a mismatched closing component tag closes up to its first matching opening tag", async () => {
      const Component = ({ children }: { children: YetiChildNode[] }) => html`<div>Hello from component ${children}</div>`;
      const result = await html`<${Component}>One<${Component}>Two<span>Hello world</${Component}>Back to one</${Component}>Root`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Hello from component One",
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "div",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Hello from component Two",
                  },
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "span",
                    children: [{ type: YETI_NODE_TYPE.TEXT, content: "Hello world" }],
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Back to one",
              },
            ],
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Root",
          },
        ],
      });
    });
  });

  describe("child content", async () => {
    test("handles empty template", async () => {
      const result = await html``;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [],
      });
    });

    test("handles template with only whitespace", async () => {
      const result = await html`   \n  \t  `;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [],
      });
    });

    test("handles a single HTML element with no children", async () => {
      const result = await html`<div></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",


          },
        ],
      });
    });

    test("handles multiple root elements", async () => {
      const result = await html`<div>First</div><div>Second</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "First",
              },
            ],
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Second",
              },
            ],
          },
        ],
      });
    });

    test("parses simple HTML with dynamic values", async () => {
      const name = "Alice";
      const age = 30;
      const result = await html`<div>Name: ${name}, Age: ${age}</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

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

    test("handles multi-byte characters correctly", async () => {
      const result = await html`<div>Emoji: 😀, Chinese: 你好, Cyrillic: Привет</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

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

    test("drops null, undefined, and empty-string dynamic values from output", async () => {
      const result = await html`<div id="null">${null}</div><div id="undefined">${undefined}</div><div id="empty-string">${""}</div><div id="zero">${0}</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: { id: "null" },
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: { id: "undefined" },
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: { id: "empty-string" },
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: { id: "zero" },
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                // Zero should not be dropped since it's a meaningful value, even though it's falsy
                content: "0",
              },
            ],
          },
        ],
      });
    });

    test("inlined html templates are resolved as children", async () => {
      const result = await html`<div>${html`<span>Nested content</span>`}</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",

                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Nested content",
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    test("unwraps inlined callbacks in HTML templates", async () => {
      const result = await html`<div>${() => html`<span>Nested content from callback 1 and ${async () => 2}</span>`}</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",

                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Nested content from callback 1 and 2",
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    test("throws error if an error is thrown while unwrapping inlined callbacks in HTML templates", async () => {
      const err = new Error("Error from callback");

      await assert.rejects(() => html`<div>${() => { throw err; }}</div>`, new YetiHTMLParsingError("An error occurred while executing an inlined function in HTML", {
        cause: err
      }));
    });

    test("unwraps inlined promises in HTML templates", async () => {
      const result = await html`<div>${new Promise((resolve) => {
        setTimeout(() => resolve("Hello from promise"), 10);
      })}</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Hello from promise",
              },
            ],
          },
        ],
      });
    });

    test("unwraps inlined sync iterators in HTML templates", async () => {
      const result = await html`<ul>${function* () {
        yield html`<li>Item 1</li>`;
        yield html`<li>Item 2</li>`;
        yield html`<li>Item 3</li>`;
      }}</ul>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "ul",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 1" }],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 2" }],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 3" }],
              },
            ],
          },
        ],
      });
    });

    test("unwraps inlined async iterators in HTML templates", async () => {
      const result = await html`<ul>${async function* () {
        yield html`<li>Async Item 1</li>`;
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield html`<li>Async Item 2</li>`;
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield html`<li>Async Item 3</li>`;
      }}</ul>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "ul",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Async Item 1" }],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Async Item 2" }],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Async Item 3" }],
              },
            ],
          },
        ],
      });
    });

    test("unwraps inlined arrays in HTML templates", async () => {
      const result = await html`<ul>${[1, 2, 3].map(num => html`<li>Item ${num}</li>`)}</ul>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "ul",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 1" }],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 2" }],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "li",
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 3" }],
              },
            ],
          },
        ],
      });
    });

    describe("raw text content tags", () => {
      test("raw text content is preserved as-is inside <script> tags", async () => {
        const result = await html`<script>const str1 = "</script>"; const str2 = '<div>Hello</div>'; const str3 = \`<span>Bye</span>\`;</script>`;
        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "script",

              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: 'const str1 = "</script>"; const str2 = \'<div>Hello</div>\'; const str3 = `<span>Bye</span>`;',
                },
              ],
            },
          ],
        });
      });

      test("raw text content is preserved as-is inside <style> tags", async () => {
        const result = await html`<style>
          .my-class { content: "</style>"; }
          .my-class-2 { content: '</style>'; }
          .my-class-3 { content: "<div>Hello</div>"; }
</style>`;
        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "style",

              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `.my-class { content: "</style>"; }
          .my-class-2 { content: '</style>'; }
          .my-class-3 { content: "<div>Hello</div>"; }`,
                },
              ],
            },
          ],
        });
      });

      test("raw text content is preserved as-is inside <textarea> tags", async () => {
        const result = await html`<textarea>Line 1
Line 2 with a <div> tag
Line 3 with a <span> tag
</textarea>`;
        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "textarea",

              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `Line 1
Line 2 with a <div> tag
Line 3 with a <span> tag
`,
                },
              ],
            },
          ],
        });
      });

      test("raw text content is preserved as-is inside <title> tags", async () => {
        const result = await html`<title>This is a title with a <div> tag</title>`;
        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "title",

              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `This is a title with a <div> tag`,
                },
              ],
            },
          ],
        });
      });

      test("resolves dynamic values in raw text content tags", async () => {
        const dynamicValue = "<div>Dynamic content</div>";
        const result = await html`<script>const dynamicValue = "${dynamicValue}";</script>`;
        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "script",

              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `const dynamicValue = "<div>Dynamic content</div>";`,
                },
              ],
            },
          ],
        });
      });
    });

    describe("whitespace-significant content tags", () => {
      test("preserves whitespace in content inside <pre> tags", async () => {
        const result = await html`<pre>  Line 1
    Line 2 with extra indentation   <span>and a tag</span>
Line 3 with no indentation
   </pre>`;
        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "pre",
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `  Line 1
    Line 2 with extra indentation   `,
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "span",
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "and a tag",
                    },
                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `
Line 3 with no indentation
   `,
                },
              ],
            },
          ],
        });
      });

      test("preserves whitespace in content inside <textarea> tags", async () => {
        const result = await html`<textarea>  Line 1
    Line 2 with extra indentation   <span>and a tag</span>
Line 3 with no indentation  
    </textarea>`;

        assert.deepStrictEqual<YetiRootNode>(result, {
          type: YETI_NODE_TYPE.ROOT,
          assets: makeBasicAssetsObject(),
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "textarea",
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: `  Line 1
    Line 2 with extra indentation   <span>and a tag</span>
Line 3 with no indentation  
    `,
                }
              ]
            },
          ],
        });
      });
    });

    test("flattens whitespace in between child nodes", async () => {
      const result = await html`<div>   <span>Child 1</span>    <span>Child 2</span>   
          <span>Child 3</span>
    </div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Child 1",
                  },
                ],
              },
              // Whitespace between the nodes should be flattened to a single space
              {
                type: YETI_NODE_TYPE.TEXT,
                content: " ",
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Child 2",
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Child 3",
                  },
                ],
              }
            ],
          },
        ],
      });
    });
  });

  describe("components", () => {
    test("handles non-HTML content returned from a component", async () => {
      const Component = () => "This is not HTML";
      const result = await html`<div><${Component} /></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "This is not HTML",
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
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "html",
            attributes: { lang: "en" },
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "head",
                children: [
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "title",
                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "Test Page",
                      },
                    ],
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "body",
                children: [
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "h1",
                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "Test Page",
                      },
                    ],
                  },
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "span",
                    children: [
                      {
                        type: YETI_NODE_TYPE.ELEMENT,
                        tagName: "p",
                        children: [
                          {
                            type: YETI_NODE_TYPE.TEXT,
                            content: "Nested content in component",
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "strong",
                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "Hello from async component",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  describe("comments", () => {
    test("handles simple comments", async () => {
      const result = await html`<div>Content<!-- This is a comment --></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
              {
                type: YETI_NODE_TYPE.COMMENT,
                content: "This is a comment",
              },
            ],
          },
        ],
      });
    });

    test("handles comments with dynamic content", async () => {
      const commentContent = 1234;
      const result = await html`<div>Content<!-- ${commentContent} --></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
              {
                type: YETI_NODE_TYPE.COMMENT,
                content: `1234`,
              },
            ],
          },
        ],
      });
    });

    test("handles empty comments", async () => {
      const result = await html`<div>Content<!----></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content",
              },
              {
                type: YETI_NODE_TYPE.COMMENT,
                content: "",
              },
            ],
          },
        ],
      });
    });
  });

  describe("DOCTYPE", () => {
    test("parses standard DOCTYPE declarations", async () => {
      const result = await html`<!DOCTYPE html><div>Content</div>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

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
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

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
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

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
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

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

    test("parses DOCTYPE declaration with mixed static and dynamic content", async () => {
      const doctypeContent1 = "t";
      const doctypeContent2 = "l";
      const result = await html`<!DOCTYPE h${doctypeContent1}m${doctypeContent2}>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: "html",
          },
        ]
      });
    });
  });

  describe("inlined asset bundles", () => {
    test("handles inlined HTML bundles as expected", async () => {
      const bundle = await html`<div>${html.inline("my-bundle")}</div>`;
      assert.deepStrictEqual<YetiRootNode>(bundle, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "---INLINED-BUNDLE---",
                attributes: {
                  bundleName: "my-bundle",
                  assetType: "html",
                },
              },
            ],
          },
        ],
      });
    });

    test("handles inlined CSS bundles as expected", async () => {
      const bundle = await html`<style>${css.inline("my-css-bundle")}</style>`;
      assert.deepStrictEqual<YetiRootNode>(bundle, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "style",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "---INLINED-BUNDLE---",
                attributes: {
                  bundleName: "my-css-bundle",
                  assetType: "css",
                },
              },
            ],
          },
        ],
      });
    });

    test("handles inlined JS bundles as expected", async () => {
      const bundle = await html`<script>${js.inline("my-js-bundle")}</script>`;
      assert.deepStrictEqual<YetiRootNode>(bundle, {
        type: YETI_NODE_TYPE.ROOT,
        assets: makeBasicAssetsObject(),
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "script",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "---INLINED-BUNDLE---",
                attributes: {
                  bundleName: "my-js-bundle",
                  assetType: "js",
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe("html imports", () => {
    test("handles html imports", async () => {
      const result = await html`<div>Content from import: "${html.import("../../test_data/external-html.html")}"</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            dependencies: new Set([
              import.meta.filename,
              fileURLToPath(import.meta.resolve("../../test_data/external-html.html")),
            ]),
          },
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: 'Content from import: "',
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "p",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "This is an ",
                  },
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "em",
                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "HTML",
                      },
                    ],
                  },
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: " snippet.",
                  }
                ],
              },
              {
                type: YETI_NODE_TYPE.TEXT,
                content: '"',
              },
            ],
          },
        ],
      });
    });

    test("handles escaped html imports", async () => {
      const result = await html`<div>Content from escaped import: "${html.import("../../test_data/external-text.txt", {
        shouldEscape: true,
      })}"</div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            dependencies: new Set([
              fileURLToPath(import.meta.resolve("../../test_data/external-text.txt")),
              import.meta.filename,
            ]),
          },
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: 'Content from escaped import: "Hello, world! I am an external text file. My contents will be escaped, so <bold>this</bold> will not be bold."',
              },
            ],
          },
        ],
      });
    });

    test("handles bundled html imports", async () => {
      const result = await html`<div>Content from bundled import...? ${html.import("../../test_data/external-svg.svg", {
        bundleName: "icons"
      })}</div>`;

      const svgImportPath = fileURLToPath(import.meta.resolve("../../test_data/external-svg.svg"));

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            bundleImportPaths: new Map([
              ["icons", new Set([svgImportPath])],
            ]),
            dependencies: new Set([
              svgImportPath,
              import.meta.filename,
            ]),
          },
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",

            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: "Content from bundled import...?",
              },
            ],
          },
        ],
      });
    });

    test("imports are passed up from nested components", async () => {
      const NestedComponent = () => html`<div>Nested import: ${html.import("../../test_data/external-html.html")}</div>`;
      const result = await html`<main><${NestedComponent} /></main>`;
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            dependencies: new Set([
              import.meta.filename,
              fileURLToPath(import.meta.resolve("../../test_data/external-html.html")),
            ]),
          },
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "main",

            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "div",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Nested import: ",
                  },
                  {
                    type: YETI_NODE_TYPE.ELEMENT,
                    tagName: "p",
                    children: [
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: "This is an ",
                      },
                      {
                        type: YETI_NODE_TYPE.ELEMENT,
                        tagName: "em",
                        children: [
                          {
                            type: YETI_NODE_TYPE.TEXT,
                            content: "HTML",
                          },
                        ],
                      },
                      {
                        type: YETI_NODE_TYPE.TEXT,
                        content: " snippet.",
                      }
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    test("bundled html imports are passed up from nested components", async () => {
      const NestedComponent = () => html`<div>Nested bundled import: ${html.import("../../test_data/external-svg.svg", {
        bundleName: "icons"
      })}</div>`;
      const result = await html`<main><${NestedComponent} /></main>`;

      const svgImportPath = fileURLToPath(import.meta.resolve("../../test_data/external-svg.svg"));

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            dependencies: new Set([
              import.meta.filename,
              svgImportPath,
            ]),
            bundleImportPaths: new Map([
              ["icons", new Set([svgImportPath])],
            ]),
          },
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "main",

            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "div",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Nested bundled import:",
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  describe("component css and js assets", () => {
    test("component css asset bundles are gathered up into the root node", async () => {
      const Component1 = () => html`<my-component-1>Hello, world!</my-component-1>`;
      Component1.css = css`
        :root {
          color: red;
        }

        ${css.bundle("component-styles")};
        my-component-1 {
          font-weight: bold;
          color: blue;
        }

        ${css.import("../../test_data/css/external-styles.css", "other-bundle")};
      `;

      const Component2 = () => html`<my-component-2>Goodbye, world!</my-component-2>`;
      Component2.css = css`
        ${css.bundle("component-styles")};
        my-component-2 {
          font-style: italic;
          color: green;
        }
      `;

      const result = await html`<div><${Component1} /><${Component2} /></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            dependencies: new Set([import.meta.filename]),
          },
          css: new Map([
            ["component-styles", new Set([Component1.css.bundles.get("component-styles")!, Component2.css.bundles.get("component-styles")!])],
            ["other-bundle", new Set([Component1.css.bundles.get("other-bundle")!])],
            ["@page", new Set([Component1.css.bundles.get("@page")!])],
          ]),
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "my-component-1",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Hello, world!",
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "my-component-2",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Goodbye, world!",
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    test("component js asset bundles are gathered up into the root node", async () => {
      const Component1 = () => html`<my-component-1>Hello, world!</my-component-1>`;
      Component1.js = js`
        console.log("Hello from default bundle");

        ${js.bundle("component-scripts")};
        console.log("Hello from component 1");

        ${js.import("../../test_data/js/external-script.js", "other-bundle")};
      `;

      const Component2 = () => html`<my-component-2>Goodbye, world!</my-component-2>`;
      Component2.js = js`
        ${js.bundle("component-scripts")};
        console.log("Hello from component 2");

        ${js.import("../../test_data/js/external-script.js")};
      `;

      const result = await html`<div><${Component1} /><${Component2} /></div>`;

      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        assets: {
          html: {
            dependencies: new Set([import.meta.filename]),
          },
          js: new Map([
            ["component-scripts", new Set([Component1.js.bundles.get("component-scripts")!, Component2.js.bundles.get("component-scripts")!])],
            ["other-bundle", new Set([Component1.js.bundles.get("other-bundle")!])],
            ["@page", new Set([Component1.js.bundles.get("@page")!])],
          ]),
        },
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            children: [
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "my-component-1",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Hello, world!",
                  },
                ],
              },
              {
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "my-component-2",
                children: [
                  {
                    type: YETI_NODE_TYPE.TEXT,
                    content: "Goodbye, world!",
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });
});