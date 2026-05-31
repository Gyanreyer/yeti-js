import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { YETI_NODE_TYPE, type YetiRootNode } from "../html/types.ts";
import { textEncoder } from "../utils/textEncoder.ts";

import { type PageScopedBundles, processPageComponent } from "./processPageComponent.ts";
import { makeBundleVersionPlaceholder, makePageBundleVersionPlaceholder } from "./bundleVersionPlaceholder.ts";
import type { EleventyPageData } from "./types.ts";

/**
 * Minimal mock of `EleventyPageData` for unit tests. The plugin only reads `page.inputPath`
 * from this in the default page-bundle path deriver, so the rest of the fields just need to
 * be shape-correct.
 */
const makeMockPageProps = (inputPath: string): EleventyPageData => ({
  eleventy: {
    version: "3.0.0",
    generator: "test",
    env: { source: "script", runMode: "build", config: "", root: "" },
    directories: { input: ".", data: "_data", includes: "_includes", layouts: "_layouts", output: "_site" },
  },
  page: {
    inputPath,
    fileSlug: "test",
    filePathStem: "/test",
    templateSyntax: "njk",
    date: new Date(0),
    url: "/test/",
    outputPath: "_site/test/index.html",
  },
  collections: {},
});

describe("processPageComponent", () => {
  test("handles a simple page with assets", async () => {
    const MyPageComponent = (await import("../../test_data/simplePageWithAssets/MyPage.page.ts")).default;

    const { pageRootNode, externalBundles, dependencies, pageBundles } = await processPageComponent(
      MyPageComponent,
      makeMockPageProps("test_data/simplePageWithAssets/MyPage.page.ts"),
    );

    assert.deepStrictEqual<PageScopedBundles>(pageBundles, {
      css: {
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
      },
      js: {
        importPaths: new Set([
          fileURLToPath(import.meta.resolve("../../test_data/simplePageWithAssets/fancy-component.js")),
        ]),
        rawContents: [
          textEncoder.encode("\n  \n  \n\n  console.log(\"Hello from FancyComponent!\");\n"),
        ],
      },
      html: null,
      inputPath: "test_data/simplePageWithAssets/MyPage.page.ts",
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
                    src: `/js/_pages/test_data/simplePageWithAssets/MyPage.js?v=${makePageBundleVersionPlaceholder("js", "test_data/simplePageWithAssets/MyPage.page.ts")}`,
                  },
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "link",
                  attributes: {
                    rel: "stylesheet",
                    href: `/css/_pages/test_data/simplePageWithAssets/MyPage.css?v=${makePageBundleVersionPlaceholder("css", "test_data/simplePageWithAssets/MyPage.page.ts")}`,
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

    const { pageRootNode, externalBundles, dependencies } = await processPageComponent(
      MyPageComponent,
      makeMockPageProps("test_data/simplePageWithEmptyWildcards/MyPage.page.ts"),
    );

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

  test("handles a page with duplicate wildcard bundle references", async () => {
    const MyPageComponent = (await import("../../test_data/pageWithDuplicateWildcards/MyPage.page.ts")).default;

    const { pageRootNode, externalBundles, pageBundles } = await processPageComponent(
      MyPageComponent,
      makeMockPageProps("test_data/pageWithDuplicateWildcards/MyPage.page.ts"),
    );

    // Each asset type's "global" bundle should be tracked once even though there are
    // multiple `*.src("*")` references in the layout that resolve to it.
    assert.deepStrictEqual(Array.from(externalBundles.css.keys()), ["critical"]);
    assert.deepStrictEqual(Array.from(externalBundles.js.keys()), []);

    assert.deepStrictEqual<PageScopedBundles>(pageBundles, {
      css: {
        importPaths: new Set(),
        rawContents: [
          textEncoder.encode(`
  body { background: blue; }

  `),
        ],
      },
      js: {
        importPaths: new Set(),
        rawContents: [
          textEncoder.encode(`
  console.log("hello");
`),
        ],
      },
      html: null,
      inputPath: "test_data/pageWithDuplicateWildcards/MyPage.page.ts",
    })

    assert.deepStrictEqual<YetiRootNode>(pageRootNode, {
      type: YETI_NODE_TYPE.ROOT,
      children: [
        { type: YETI_NODE_TYPE.DOCTYPE, content: 'html' },
        {
          type: YETI_NODE_TYPE.ELEMENT,
          tagName: 'html',
          attributes: { lang: 'en' },
          children: [
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: 'head',
              children: [
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'meta',
                  attributes: { charset: 'UTF-8' }
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'title',
                  children: [{ type: YETI_NODE_TYPE.TEXT, content: 'Test Page' }]
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'style',
                  attributes: { 'data-first': true },
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'body{background:#00f}'
                    },
                    { type: YETI_NODE_TYPE.TEXT, content: ':root{--color:red}' }
                  ]
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'style',
                  attributes: { 'data-second': true },
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'body{background:#00f}'
                    },
                    { type: YETI_NODE_TYPE.TEXT, content: ':root{--color:red}' }
                  ]
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'link',
                  attributes: {
                    rel: 'stylesheet',
                    href: `/css/_pages/test_data/pageWithDuplicateWildcards/MyPage.css?v=${makePageBundleVersionPlaceholder("css", "test_data/pageWithDuplicateWildcards/MyPage.page.ts")}`,
                    media: 'print',
                    onload: "this.media='all'"
                  }
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'link',
                  attributes: {
                    rel: 'stylesheet',
                    href: `/css/critical.css?v=${makeBundleVersionPlaceholder("css", "critical")}`,
                    media: 'print',
                    onload: "this.media='all'"
                  }
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'noscript',
                  children: [
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: 'link',
                      attributes: {
                        rel: 'stylesheet',
                        href: `/css/_pages/test_data/pageWithDuplicateWildcards/MyPage.css?v=${makePageBundleVersionPlaceholder("css", "test_data/pageWithDuplicateWildcards/MyPage.page.ts")}`
                      }
                    },
                    {
                      type: YETI_NODE_TYPE.ELEMENT,
                      tagName: 'link',
                      attributes: {
                        rel: 'stylesheet',
                        href: `/css/critical.css?v=${makeBundleVersionPlaceholder("css", "critical")}`
                      }
                    }
                  ]
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'script',
                  attributes: { 'data-first': true, type: 'module' },
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'console.log("hello");\n'
                    }
                  ]
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'script',
                  attributes: { 'data-second': true, type: 'module' },
                  children: [
                    {
                      type: YETI_NODE_TYPE.TEXT,
                      content: 'console.log("hello");\n'
                    }
                  ]
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'script',
                  attributes: {
                    'data-first': true,
                    src: `/js/_pages/test_data/pageWithDuplicateWildcards/MyPage.js?v=${makePageBundleVersionPlaceholder("js", "test_data/pageWithDuplicateWildcards/MyPage.page.ts")}`
                  }
                },
                {
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: 'script',
                  attributes: {
                    'data-second': true,
                    src: `/js/_pages/test_data/pageWithDuplicateWildcards/MyPage.js?v=${makePageBundleVersionPlaceholder("js", "test_data/pageWithDuplicateWildcards/MyPage.page.ts")}`
                  }
                }
              ]
            },
            {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: 'body',
              children: [{ type: YETI_NODE_TYPE.ELEMENT, tagName: 'main' }]
            }
          ]
        }
      ]
    });
  });
});