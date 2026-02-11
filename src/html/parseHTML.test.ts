import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { parseHTML } from "./parseHTML.ts";
import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiChildNode, YetiNode, YetiRootNode } from "./types.ts";
import { makeDynamicValuePlaceholder } from "./utils.ts";
import { YetiHTMLParsingError } from "./error.ts";

describe("parseHTML", () => {
  test("should correctly parse an empty HTML string", async () => {
    const result = await parseHTML("", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [],
    } satisfies YetiRootNode);
  });

  test("should correctly parse a string with only whitespace", async () => {
    const result = await parseHTML("   \n\t  ", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.TEXT,
        content: "   \n\t  ",
      }],
    } satisfies YetiRootNode);
  });

  test("should correctly parse a doctype declaration", async () => {
    const result = await parseHTML("<!DOCTYPE html>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.DOCTYPE,
        content: "html",
      }],
    } satisfies YetiRootNode);
  });

  test("should parse a single HTML element as expected", async () => {
    const result = await parseHTML("<div></div>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [],
      }],
    } satisfies YetiRootNode);
  });

  test("should parse nested HTML elements correctly", async () => {
    const result = await parseHTML("<div><span>Text</span></div>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "span",
          attributes: {},
          children: [{
            type: YETI_NODE_TYPE.TEXT,
            content: "Text",
          }],
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should parse self-closing tags correctly", async () => {
    const result = await parseHTML("<div><img src='image.png' /></div>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "img",
          attributes: { src: "image.png" },
          children: [],
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle void elements correctly", async () => {
    const result = await parseHTML("<area><base><br><col><embed><hr><img><input><link><meta><param><source><track><wbr>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "area", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "base", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "br", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "col", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "embed", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "hr", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "img", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "input", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "link", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "meta", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "param", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "source", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "track", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "wbr", attributes: {}, children: [] },
      ],
    } satisfies YetiRootNode);
  });

  test("should parse elements with attributes correctly", async () => {
    const result = await parseHTML("<a href='https://example.com' target='_blank' data-bool>Link</a>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "a",
        attributes: { href: "https://example.com", target: "_blank", "data-bool": true },
        children: [{
          type: YETI_NODE_TYPE.TEXT,
          content: "Link",
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should parse comments correctly", async () => {
    const result = await parseHTML("<!-- This is a comment -->", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.COMMENT,
        content: "This is a comment",
      }],
    } satisfies YetiRootNode);
  });

  test("should parse a component correctly", async () => {
    const component = ({ children, title }: { children: YetiChildNode[]; title: string }): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "h1",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: title,
            },
          ],
        },
        ...children,
      ],
    });

    const result = await parseHTML(`<${makeDynamicValuePlaceholder(0)} title='Hello'><p>World</p></${makeDynamicValuePlaceholder(1)}>`, [
      component,
      component,
    ]);

    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "h1",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Hello",
            },
          ],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "p",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "World",
            },
          ],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle self-closing components", async () => {
    const component = ({ title }: { title: string }): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "h1",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: title,
            },
          ],
        },
      ],
    });

    const result = await parseHTML(`<${makeDynamicValuePlaceholder(0)} title='Hello' /><div>Next</div>`, [
      component,
    ]);

    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "h1",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Hello",
            },
          ],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Next",
            },
          ],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle async components that return promises as children", async () => {
    const asyncComponent = async ({ title }: { title: string }): Promise<YetiRootNode> => {
      await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async work
      return ({
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "h1",
            attributes: {},
            children: [
              {
                type: YETI_NODE_TYPE.TEXT,
                content: title,
              },
            ],
          },
        ],
      });
    };

    const result = await parseHTML(`<${makeDynamicValuePlaceholder(0)} title='Async Component' /><div>After</div>`, [
      asyncComponent,
    ]);

    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "h1",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Async Component",
            },
          ],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "After",
            },
          ],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle unclosed tags gracefully", async () => {
    const result = await parseHTML("<div><span>Text</div>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "span",
          attributes: {},
          children: [{
            type: YETI_NODE_TYPE.TEXT,
            content: "Text",
          }],
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle fragment closing tags correctly", async () => {
    // Component wraps children in an <article> tag
    const component = ({ children }: { children: YetiChildNode[] }): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "article",
          attributes: {},
          children,
        }
      ],
    });

    const result = await parseHTML(`<${makeDynamicValuePlaceholder(0)}><p>Paragraph 1</><p>Paragraph 2</></><div>After</>`, [
      component,
    ]);

    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "article",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "p",
              attributes: {},
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "Paragraph 1",
                },
              ],
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "p",
              attributes: {},
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "Paragraph 2",
                },
              ],
            },
          ],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "After",
            },
          ],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle spread attributes correctly", async () => {
    const attrs = {
      class: "btn",
      disabled: true,
      id: "submit-btn",
      "data-value": "123",
    };

    const result = await parseHTML(`<button data-value="abc" ...${makeDynamicValuePlaceholder(0)} disabled=${makeDynamicValuePlaceholder(1)}></button>`, [attrs, false]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "button",
        attributes: {
          class: "btn",
          id: "submit-btn",
          // The initial data-value should be overridden by the spread attribute which came after it
          "data-value": "123",
          // disabled should be overridden by the disabled attribute which came after it
          disabled: false,
        },
        children: [],
      }],
    } satisfies YetiRootNode);
  });

  test("should unwrap iterable child content as expected", async () => {
    // An array should be unwrapped
    let result = await parseHTML(`<div>Items: ${makeDynamicValuePlaceholder(0)}</div>`, [[1, 2, 3]]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Items: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "1",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "2",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "3",
          },
        ],
      }],
    } satisfies YetiRootNode);

    // A Set should be unwrapped
    result = await parseHTML(`<div>Items: ${makeDynamicValuePlaceholder(0)}</div>`, [new Set(["a", "b", "c"])]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Items: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "a",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "b",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "c",
          },
        ],
      }],
    } satisfies YetiRootNode);

    // A generator should be unwrapped
    function* generator() {
      yield "x";
      yield "y";
      yield "z";
    }
    result = await parseHTML(`<div>Items: ${makeDynamicValuePlaceholder(0)}</div>`, [generator]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Items: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "x",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "y",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "z",
          },
        ],
      }],
    });

    // An async generator should also be unwrapped
    async function* asyncGenerator() {
      yield "1";
      yield "2";
      yield "3";
    }
    result = await parseHTML(`<div>Items: ${makeDynamicValuePlaceholder(0)}</div>`, [asyncGenerator]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Items: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "1",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "2",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "3",
          },
        ],
      }],
    } satisfies YetiRootNode);
  });

  test("should stringify non-YetiNode object in child content to [object Object] by default", async () => {
    const obj = { a: 1, b: 2 };
    const result = await parseHTML(`<div>Object: ${makeDynamicValuePlaceholder(0)}</div>`, [obj]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Object: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "[object Object]",
          },
        ],
      }],
    } satisfies YetiRootNode, "Non-YetiNode objects should be stringified to [object Object] by default");
  });

  test("should escape special characters in text content", async () => {
    const result = await parseHTML(`<div>Special chars: & < > ${makeDynamicValuePlaceholder(0)}</div>`, [
      "& < > \" '",
    ]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Special chars: &amp; &lt; &gt; &amp; &lt; &gt; &quot; &#39;",
          },
        ],
      }],
    } satisfies YetiRootNode, "Special characters in text content should be escaped");
  });

  test("should skip null, undefined, or empty string values in child content", async () => {
    const result = await parseHTML(`<div>Values: ${makeDynamicValuePlaceholder(0)}</div>`, [
      [null, undefined, "", "Valid String"],
    ]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Values: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Valid String",
          }
        ],
      }],
    } satisfies YetiRootNode, "Null, undefined, or empty string values in child content should be skipped");
  });

  test("should unwrap promises in child content", async () => {
    const promise = Promise.resolve("Resolved Value");
    const result = await parseHTML(`<div>Promise: ${makeDynamicValuePlaceholder(0)}</div>`, [promise]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Promise: ",
          },
          {
            type: YETI_NODE_TYPE.TEXT,
            content: "Resolved Value",
          },
        ],
      }],
    } satisfies YetiRootNode, "Promises in child content should be unwrapped to their resolved values");
  });

  test("should parse dynamic attribute names correctly", async () => {
    const dynamicAttrName = "data-dynamic";
    let result = await parseHTML(`<div ${makeDynamicValuePlaceholder(0)}="value"></div>`, [dynamicAttrName]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {
          "data-dynamic": "value",
        },
        children: [],
      }],
    } satisfies YetiRootNode, "The attribute should have been parsed with the dynamic 'data-dynamic' name.");

    await assert.rejects(
      () => parseHTML(`<div ${makeDynamicValuePlaceholder(0)}="value"></div>`, ["invalid attr name"]),
      new YetiHTMLParsingError(`lexAttributeName received invalid attribute name "invalid attr name"`),
      "Invalid dynamic attribute names should throw a YetiHTMLParsingError",
    );
  });

  test("should handle dynamic attribute values correctly", async () => {
    const url = "https://example.com";
    const result = await parseHTML(`<a href=${makeDynamicValuePlaceholder(0)}>Link</a>`, [url]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "a",
        attributes: { href: "https://example.com" },
        children: [{
          type: YETI_NODE_TYPE.TEXT,
          content: "Link",
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle function-based child content", async () => {
    const fn = () => "Function Result";
    const result = await parseHTML(`<div>${makeDynamicValuePlaceholder(0)}</div>`, [fn]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.TEXT,
          content: "Function Result",
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle async function-based child content", async () => {
    const asyncFn = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return "Async Function Result";
    };
    const result = await parseHTML(`<div>${makeDynamicValuePlaceholder(0)}</div>`, [asyncFn]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.TEXT,
          content: "Async Function Result",
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should throw error when function in child content throws", async () => {
    const throwingFn = () => {
      throw new Error("Function error");
    };
    await assert.rejects(
      () => parseHTML(`<div>${makeDynamicValuePlaceholder(0)}</div>`, [throwingFn]),
      new YetiHTMLParsingError("An error occurred while executing inlined function in HTML"),
      "Functions that throw should propagate errors wrapped in YetiHTMLParsingError",
    );
  });

  test("should handle component that returns an array of nodes", async () => {
    const component = (): YetiNode[] => [
      {
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "h1",
        attributes: {},
        children: [{ type: YETI_NODE_TYPE.TEXT, content: "Title" }],
      },
      {
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "p",
        attributes: {},
        children: [{ type: YETI_NODE_TYPE.TEXT, content: "Content" }],
      },
    ];

    const result = await parseHTML(`<${makeDynamicValuePlaceholder(0)} />`, [component]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "h1",
          attributes: {},
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "Title" }],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "p",
          attributes: {},
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "Content" }],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle component that returns a primitive value", async () => {
    const component = () => "Simple String";
    const result = await parseHTML(`<${makeDynamicValuePlaceholder(0)} />`, [component]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.TEXT,
        content: "Simple String",
      }],
    } satisfies YetiRootNode);
  });

  test("should handle nested components", async () => {
    const InnerComponent = ({ text }: { text: string }): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "span",
        attributes: {},
        children: [{ type: YETI_NODE_TYPE.TEXT, content: text }],
      }],
    });

    const OuterComponent = ({ title, children }: { title: string; children: YetiChildNode[]; }): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: { "data-outer": true, },
        children: [
          { type: YETI_NODE_TYPE.TEXT, content: title },
          ...children,
        ],
      }],
    });

    const result = await parseHTML(
      `<${makeDynamicValuePlaceholder(0)} title='Outer'><${makeDynamicValuePlaceholder(1)} text='Inner' /></>`,
      [OuterComponent, InnerComponent]
    );

    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {
          "data-outer": true,
        },
        children: [
          { type: YETI_NODE_TYPE.TEXT, content: "Outer" },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "span",
            attributes: {},
            children: [{ type: YETI_NODE_TYPE.TEXT, content: "Inner" }],
          },
        ],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle multiple root-level elements", async () => {
    const result = await parseHTML("<div>First</div><span>Second</span><p>Third</p>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "First" }],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "span",
          attributes: {},
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "Second" }],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "p",
          attributes: {},
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "Third" }],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle deeply nested elements", async () => {
    const result = await parseHTML(
      "<div><div><div><div><span>Deep</span></div></div></div></div>",
      []
    );
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [{
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "div",
            attributes: {},
            children: [{
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "div",
              attributes: {},
              children: [{
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "span",
                attributes: {},
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Deep" }],
              }],
            }],
          }],
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle mixed text and element children", async () => {
    const result = await parseHTML("<div>Before<span>Inside</span>After</div>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          { type: YETI_NODE_TYPE.TEXT, content: "Before" },
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "span",
            attributes: {},
            children: [{ type: YETI_NODE_TYPE.TEXT, content: "Inside" }],
          },
          { type: YETI_NODE_TYPE.TEXT, content: "After" },
        ],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle numbers and booleans as child content", async () => {
    const result = await parseHTML(
      `<div>Number: ${makeDynamicValuePlaceholder(0)}, Boolean: ${makeDynamicValuePlaceholder(1)}</div>`,
      [42, true]
    );
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          { type: YETI_NODE_TYPE.TEXT, content: "Number: " },
          { type: YETI_NODE_TYPE.TEXT, content: "42" },
          { type: YETI_NODE_TYPE.TEXT, content: ", Boolean: " },
          { type: YETI_NODE_TYPE.TEXT, content: "true" },
        ],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle spread attributes with null and undefined", async () => {
    const result = await parseHTML(
      `<div ...${makeDynamicValuePlaceholder(0)} ...${makeDynamicValuePlaceholder(1)} class="valid"></div>`,
      [null, undefined]
    );
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: { class: "valid" },
        children: [],
      }],
    } satisfies YetiRootNode);
  });

  test("should throw error for spread attributes with primitive values", async () => {
    await assert.rejects(
      () => parseHTML(`<div ...${makeDynamicValuePlaceholder(0)}></div>`, ["string"]),
      new YetiHTMLParsingError("Received invalid SPREAD_ATTR token: Token value must be an object"),
      "Spread attributes must be objects",
    );

    await assert.rejects(
      () => parseHTML(`<div ...${makeDynamicValuePlaceholder(0)}></div>`, [123]),
      new YetiHTMLParsingError("Received invalid SPREAD_ATTR token: Token value must be an object"),
      "Spread attributes must be objects",
    );
  });

  test("should handle YetiNode as child content", async () => {
    const yetiNode: YetiNode = {
      type: YETI_NODE_TYPE.ELEMENT,
      tagName: "span",
      attributes: { class: "dynamic" },
      children: [{ type: YETI_NODE_TYPE.TEXT, content: "Dynamic Node" }],
    };

    const result = await parseHTML(`<div>${makeDynamicValuePlaceholder(0)}</div>`, [yetiNode]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "span",
          attributes: { class: "dynamic" },
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "Dynamic Node" }],
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle YetiRootNode as child content by unwrapping children", async () => {
    const yetiRootNode: YetiRootNode = {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "h1", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "p", attributes: {}, children: [] },
      ],
    };

    const result = await parseHTML(`<div>${makeDynamicValuePlaceholder(0)}</div>`, [yetiRootNode]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "h1", attributes: {}, children: [] },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "p", attributes: {}, children: [] },
        ],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle complex document with DOCTYPE, comments, and elements", async () => {
    const result = await parseHTML(
      "<!DOCTYPE html><!-- Header comment --><html><head><title>Test</title></head><body><!-- Body comment --><h1>Title</h1></body></html>",
      []
    );
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        { type: YETI_NODE_TYPE.DOCTYPE, content: "html" },
        { type: YETI_NODE_TYPE.COMMENT, content: "Header comment" },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "html",
          attributes: {},
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "head",
              attributes: {},
              children: [{
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "title",
                attributes: {},
                children: [{ type: YETI_NODE_TYPE.TEXT, content: "Test" }],
              }],
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "body",
              attributes: {},
              children: [
                { type: YETI_NODE_TYPE.COMMENT, content: "Body comment" },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "h1",
                  attributes: {},
                  children: [{ type: YETI_NODE_TYPE.TEXT, content: "Title" }],
                },
              ],
            },
          ],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should handle mismatched closing tags by closing until match found", async () => {
    const result = await parseHTML("<div><span><p>Text</div><section>After</section>", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "div",
          attributes: {},
          children: [{
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "span",
            attributes: {},
            children: [{
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "p",
              attributes: {},
              children: [{ type: YETI_NODE_TYPE.TEXT, content: "Text" }],
            }],
          }],
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "section",
          attributes: {},
          children: [{ type: YETI_NODE_TYPE.TEXT, content: "After" }],
        },
      ],
    } satisfies YetiRootNode);
  });

  test("should auto-close all unclosed tags at end of document", async () => {
    const result = await parseHTML("<div><span><p>Text", []);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [{
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "span",
          attributes: {},
          children: [{
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "p",
            attributes: {},
            children: [{ type: YETI_NODE_TYPE.TEXT, content: "Text" }],
          }],
        }],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle arrays containing YetiNodes in child content", async () => {
    const nodes = [
      { type: YETI_NODE_TYPE.ELEMENT, tagName: "li", attributes: {}, children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 1" }] },
      { type: YETI_NODE_TYPE.ELEMENT, tagName: "li", attributes: {}, children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 2" }] },
    ];

    const result = await parseHTML(`<ul>${makeDynamicValuePlaceholder(0)}</ul>`, [nodes]);
    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "ul",
        attributes: {},
        children: [
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "li", attributes: {}, children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 1" }] },
          { type: YETI_NODE_TYPE.ELEMENT, tagName: "li", attributes: {}, children: [{ type: YETI_NODE_TYPE.TEXT, content: "Item 2" }] },
        ],
      }],
    } satisfies YetiRootNode);
  });

  test("should handle component children being passed correctly", async () => {
    const Wrapper = ({ children }: { children: YetiChildNode[] }): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children: [
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "header", attributes: {}, children: [] },
        ...children,
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "footer", attributes: {}, children: [] },
      ],
    });

    const result = await parseHTML(
      `<${makeDynamicValuePlaceholder(0)}><p>Child 1</p><p>Child 2</p></${makeDynamicValuePlaceholder(1)}>`,
      [Wrapper, Wrapper]
    );

    assert.deepEqual(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "header", attributes: {}, children: [] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "p", attributes: {}, children: [{ type: YETI_NODE_TYPE.TEXT, content: "Child 1" }] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "p", attributes: {}, children: [{ type: YETI_NODE_TYPE.TEXT, content: "Child 2" }] },
        { type: YETI_NODE_TYPE.ELEMENT, tagName: "footer", attributes: {}, children: [] },
      ],
    } satisfies YetiRootNode);
  });
});