import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { html } from "./html.ts";
import { YETI_NODE_TYPE, } from "./types.ts";
import type { YetiChildNode, YetiRootNode } from './types.ts';

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
              content: "Name: ",
            },
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "Alice",
            },
            {
              type: YETI_NODE_TYPE.TEXT,
              content: ", Age: ",
            },
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "30",
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
});