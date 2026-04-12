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
        ["global", {
          importPaths: new Set([
            fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Heading.component.css")),
          ]),
          rawContents: [
            // Heading's raw contribution to the global bundle. The interleaved whitespace
            // chunks come from the parts of the template literal that surround the
            // ${css.import()} and ${css.bundle()} calls.
            textEncoder.encode("\n  \n\n  \n  header {\n    background-color: red;\n  }\n  h1 {\n    color: yellow;\n  }\n"),
            // FancyComponent's raw contribution to the global bundle.
            textEncoder.encode("\n  fancy-component:not(:defined) {\n    display: none;\n  }\n"),
          ],
        }],
      ]),
      js: new Map([
        ["global", {
          importPaths: new Set([
            fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/fancy-component.js")),
          ]),
          rawContents: [
            textEncoder.encode("\n  \n  \n\n  console.log(\"Hello from FancyComponent!\");\n"),
          ],
        }],
      ]),
      htmlImportPaths: new Map(),
    });

    assert.deepStrictEqual(dependencies, new Set([
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Heading.component.css")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/fancy-component.js")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/say-hello.ts")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Heading.component.ts")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/FancyComponent.component.ts")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/Layout.component.ts")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/MyPage.page.ts")),
    ]));

    assert.deepStrictEqual<YetiRootNode>(pageRootNode, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.DOCTYPE,
          content: "html",
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "html",
          attributes: {
            lang: "en",
          },
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "head",
              children: [
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "meta",
                  attributes: {
                    charset: "UTF-8",
                  },
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
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "style",
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'h1{font-family:sans-serif;font-size:5rem}',
                    },
                  ],
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
                      content: 'var message="Hello, World!";console.log(message);\n'
                    },
                  ],
                },
              ],
            },
            // Body
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "body",
              children: [
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "main",
                  children: [
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: "header",
                      children: [
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
                      ],
                    },
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: "fancy-component",
                    },
                  ],
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "script",
                  attributes: {
                    src: "/js/global.js?v=--YETI__js__global--",
                  },
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "link",
                  attributes: {
                    rel: "stylesheet",
                    href: "/css/global.css?v=--YETI__css__global--",
                  },
                },
              ],
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

    assert.deepStrictEqual(dependencies, new Set([
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithEmptyWildcards/Layout.component.ts")),
      fileURLToPath(import.meta.resolve("../../test_data/simplePageWithEmptyWildcards/MyPage.page.ts")),
    ]));

    assert.deepStrictEqual<YetiRootNode>(pageRootNode, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        {
          type: YETI_NODE_TYPE.DOCTYPE,
          content: "html",
        },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: "html",
          attributes: {
            lang: "en",
          },
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "head",
              children: [
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "meta",
                  attributes: {
                    charset: "UTF-8",
                  },
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
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "style",
                  children: [],
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "script",
                  attributes: {
                    type: "module",
                  },
                  children: [],
                },
              ],
            },
            // Body
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "body",
              children: [
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "main",
                },
              ],
            },
          ],
        },
      ],
    });
  });
});