import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { YETI_NODE_TYPE, type YetiRootNode } from "../html/types.ts";
import { textEncoder } from "../utils/textEncoder.ts";

import { processPageComponent } from "./processPageComponent.ts";

describe("processPageComponent", () => {
  test("handles a simple page with assets", async () => {
    const MyPageComponent = (await import("../../test_data/simplePageWithAssets/MyPage.page.ts")).default;

    const { pageRootNode, externalBundles, dependencies } = await processPageComponent(MyPageComponent, {} as any);

    assert.deepStrictEqual(externalBundles, {
      css: new Map([
        ["global", new Set([textEncoder.encode(`header {
  border: 1px solid #000;
  padding: 4px;
}

  

  
  header {
    background-color: red;
  }
  h1 {
    color: yellow;
  }
`),
        textEncoder.encode(`
  fancy-component:not(:defined) {
    display: none;
  }
`),
        ])],
      ]),
      js: new Map([
        ["global", new Set([textEncoder.encode(`// test_data/simplePageWithAssets/fancy-component.js
var FancyComponent = class extends HTMLElement {
  static tagName = "fancy-component";
  static {
    customElements.define(this.tagName, this);
  }
  connectedCallback() {
    this.innerHTML = \`
      <h1>Fancy Component</h1>
      <p>This is a fancy component.</p>
    \`;
  }
};

  
  

  console.log("Hello from FancyComponent!");
`)],
        )],
      ]),
      htmlImportPaths: new Map(),
    });

    assert.deepStrictEqual(dependencies, {
      css: new Set([fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Heading.component.css"))]),
      js: new Set([
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/fancy-component.js")),
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/say-hello.ts")),
      ]),
      html: new Set([
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Heading.component.ts")),
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/FancyComponent.component.ts")),
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Layout.component.ts")),
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/MyPage.page.ts")),
      ]),
    });

    assert.deepStrictEqual<YetiRootNode>(pageRootNode, {
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
          attributes: {
            lang: "en",
          },
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "\n  ",
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "head",
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "meta",
                  attributes: {
                    charset: "UTF-8",
                  },
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "meta",
                  attributes: {
                    name: "viewport",
                    content: "width=device-width, initial-scale=1.0",
                  },
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
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
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "style",
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      "
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'h1{font-family:sans-serif;font-size:5rem}',
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
                  tagName: "script",
                  attributes: {
                    type: "module",
                  },
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      "
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'var message="Hello, World!";console.log(message);\n'
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n    ",
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
            // Body
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "body",
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    \n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "main",
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      ",
                    },
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: "header",
                      children: [
                        {
                          type: YETI_NODE_TYPE.TEXT,
                          content: "\n  ",
                        },
                        {
                          type: YETI_NODE_TYPE.ELEMENT,
                          tagName: "h1",
                          children: [
                            {
                              type: YETI_NODE_TYPE.TEXT,
                              content: "My Page",
                            },
                          ],
                        },
                        {
                          type: YETI_NODE_TYPE.TEXT,
                          content: "\n",
                        },
                      ],
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      ",
                    },
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: "fancy-component",
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n    ",
                    }
                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n  \n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "script",
                  attributes: {
                    src: "/js/global.js",
                  },
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "link",
                  attributes: {
                    rel: "stylesheet",
                    href: "/css/global.css",
                  },
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n  ",
                }
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

  test("handles a page with empty wildcards", async () => {
    const MyPageComponent = (await import("../../test_data/simplePageWithEmptyWildcards/MyPage.page.ts")).default;

    const { pageRootNode, externalBundles, dependencies } = await processPageComponent(MyPageComponent, {} as any);

    assert.deepStrictEqual(externalBundles, {
      css: new Map(),
      js: new Map(),
      htmlImportPaths: new Map(),
    });

    assert.deepStrictEqual(dependencies, {
      css: new Set(),
      js: new Set(),
      html: new Set([
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithEmptyWildcards/Layout.component.ts")),
        fileURLToPath(import.meta.resolve("../../test_data/simplePageWithEmptyWildcards/MyPage.page.ts")),
      ]),
    });

    assert.deepStrictEqual<YetiRootNode>(pageRootNode, {
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
          attributes: {
            lang: "en",
          },
          children: [
            {
              type: YETI_NODE_TYPE.TEXT,
              content: "\n  ",
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "head",
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "meta",
                  attributes: {
                    charset: "UTF-8",
                  },
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "meta",
                  attributes: {
                    name: "viewport",
                    content: "width=device-width, initial-scale=1.0",
                  },
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
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
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "style",
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      ",
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n    "
                    },
                  ],
                },
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "script",
                  attributes: {
                    type: "module",
                  },
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n      ",
                    },
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: "\n    ",
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
            // Body
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "body",
              children: [
                {
                  type: YETI_NODE_TYPE.TEXT,
                  content: "\n    \n    ",
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "main",
                },
                {
                  content: '\n  \n    ',
                  type: YETI_NODE_TYPE.TEXT,
                },
                {
                  content: '\n    ',
                  type: YETI_NODE_TYPE.TEXT,
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