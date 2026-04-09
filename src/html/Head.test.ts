import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { html } from "./html.ts";
import { Head } from "./Head.ts";
import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiRootNode, YetiElementNode, YetiChildNode } from "./types.ts";
import { mergeHeadContent } from "./mergeHeadContent.ts";

describe("Head component", () => {
  describe("collection during parsing", () => {
    test("collects Head children onto rootNode.assets.head", async () => {
      const result = await html`<div>
        <${Head}>
          <title>My Page</title>
        </${Head}>
      </div>`;

      assert.ok(result.assets?.head, "Expected assets.head to be defined");
      assert.equal(result.assets.head.length, 1);
      assert.deepStrictEqual(result.assets.head[0], {
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "title",
        children: [{ type: YETI_NODE_TYPE.TEXT, content: "My Page" }],
      });
    });

    test("does not render Head content in place", async () => {
      const result = await html`<div>
        <${Head}>
          <title>My Page</title>
        </${Head}>
        <p>Content</p>
      </div>`;

      // The div should only contain the <p>, not the <title>
      const div = result.children[0] as YetiElementNode;
      assert.equal(div.tagName, "div");
      const elementChildren = div.children!.filter(
        (c): c is YetiElementNode => c.type === YETI_NODE_TYPE.ELEMENT
      );
      assert.equal(elementChildren.length, 1);
      assert.equal(elementChildren[0].tagName, "p");
    });

    test("collects multiple Head components in order", async () => {
      const result = await html`<div>
        <${Head}>
          <title>First</title>
        </${Head}>
        <${Head}>
          <title>Second</title>
          <meta name="description" content="test" />
        </${Head}>
      </div>`;

      assert.ok(result.assets?.head);
      assert.equal(result.assets.head.length, 3);
      // First Head's title
      assert.equal((result.assets.head[0] as YetiElementNode).tagName, "title");
      // Second Head's title
      assert.equal((result.assets.head[1] as YetiElementNode).tagName, "title");
      // Second Head's meta
      assert.equal((result.assets.head[2] as YetiElementNode).tagName, "meta");
    });

    test("collects Head content from nested components", async () => {
      function Inner() {
        return html`<${Head}>
          <title>From Inner</title>
        </${Head}>
        <span>Inner content</span>`;
      }

      const result = await html`<div>
        <${Inner} />
      </div>`;

      assert.ok(result.assets?.head);
      assert.equal(result.assets.head.length, 1);
      assert.equal((result.assets.head[0] as YetiElementNode).tagName, "title");
    });

    test("collects Head from both parent and nested component in order", async () => {
      function Child() {
        return html`<${Head}>
          <meta name="author" content="child" />
        </${Head}>
        <span>child</span>`;
      }

      const result = await html`<div>
        <${Head}>
          <meta name="author" content="parent" />
        </${Head}>
        <${Child} />
      </div>`;

      assert.ok(result.assets?.head);
      assert.equal(result.assets.head.length, 2);
      // Parent's meta comes first (parsed first), then child's
      assert.equal(
        (result.assets.head[0] as YetiElementNode).attributes?.content,
        "parent"
      );
      assert.equal(
        (result.assets.head[1] as YetiElementNode).attributes?.content,
        "child"
      );
    });

    test("supports self-closing Head syntax", async () => {
      // Head with no children should not add anything
      const result = await html`<div><${Head} /></div>`;
      assert.equal(result.assets?.head, undefined);
    });
  });

  describe("mergeHeadContent", () => {
    const makeRootNode = (children: YetiChildNode[], head?: YetiChildNode[]): YetiRootNode => ({
      type: YETI_NODE_TYPE.ROOT,
      children,
      ...(head ? { assets: { head } } : {}),
    });

    const makeElement = (tagName: string, attributes?: Record<string, unknown>, children?: YetiChildNode[]): YetiElementNode => ({
      type: YETI_NODE_TYPE.ELEMENT,
      tagName,
      ...(attributes ? { attributes } : {}),
      ...(children ? { children } : {}),
    });

    test("does nothing when no head assets exist", () => {
      const rootNode = makeRootNode([
        makeElement("html", undefined, [
          makeElement("head", undefined, [
            makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Original" }]),
          ]),
        ]),
      ]);
      mergeHeadContent(rootNode);

      const html = rootNode.children[0] as YetiElementNode;
      const head = html.children![0] as YetiElementNode;
      assert.equal(head.children!.length, 1);
    });

    test("replaces <title> when deduping", () => {
      const rootNode = makeRootNode(
        [
          makeElement("html", undefined, [
            makeElement("head", undefined, [
              makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Layout Title" }]),
            ]),
            makeElement("body"),
          ]),
        ],
        [
          makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Page Title" }]),
        ]
      );

      mergeHeadContent(rootNode);

      const htmlEl = rootNode.children[0] as YetiElementNode;
      const headEl = htmlEl.children![0] as YetiElementNode;
      assert.equal(headEl.children!.length, 1);
      const title = headEl.children![0] as YetiElementNode;
      assert.equal(title.tagName, "title");
      assert.equal((title.children![0] as any).content, "Page Title");
    });

    test("dedupes <meta> by name attribute", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("meta", { name: "description", content: "old" }),
            makeElement("meta", { name: "viewport", content: "width=device-width" }),
          ]),
        ],
        [
          makeElement("meta", { name: "description", content: "new" }),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 2);
      // The description meta should be replaced in place
      const descMeta = headEl.children![0] as YetiElementNode;
      assert.equal(descMeta.attributes?.content, "new");
      // The viewport meta should be untouched
      const viewportMeta = headEl.children![1] as YetiElementNode;
      assert.equal(viewportMeta.attributes?.content, "width=device-width");
    });

    test("dedupes <meta> by property attribute", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("meta", { property: "og:title", content: "old" }),
          ]),
        ],
        [
          makeElement("meta", { property: "og:title", content: "new" }),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 1);
      assert.equal((headEl.children![0] as YetiElementNode).attributes?.content, "new");
    });

    test("dedupes <meta> by http-equiv attribute", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("meta", { "http-equiv": "content-type", content: "text/html" }),
          ]),
        ],
        [
          makeElement("meta", { "http-equiv": "content-type", content: "application/xhtml+xml" }),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 1);
      assert.equal((headEl.children![0] as YetiElementNode).attributes?.content, "application/xhtml+xml");
    });

    test("dedupes <link> by rel+href", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("link", { rel: "stylesheet", href: "/style.css" }),
            makeElement("link", { rel: "icon", href: "/favicon.ico" }),
          ]),
        ],
        [
          makeElement("link", { rel: "stylesheet", href: "/style.css", media: "print" }),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 2);
      // The stylesheet link should be replaced with the new one (includes media attr)
      const stylesheetLink = headEl.children![0] as YetiElementNode;
      assert.equal(stylesheetLink.attributes?.media, "print");
      // The icon link should be untouched
      const iconLink = headEl.children![1] as YetiElementNode;
      assert.equal(iconLink.attributes?.href, "/favicon.ico");
    });

    test("dedupes <script> by src attribute", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("script", { src: "/app.js" }),
          ]),
        ],
        [
          makeElement("script", { src: "/app.js", defer: true }),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 1);
      assert.equal((headEl.children![0] as YetiElementNode).attributes?.defer, true);
    });

    test("appends <script> without src (no dedup)", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("script", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "console.log('a')" }]),
          ]),
        ],
        [
          makeElement("script", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "console.log('b')" }]),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 2);
    });

    test("appends <style> elements (no dedup)", () => {
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("style", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "body { margin: 0; }" }]),
          ]),
        ],
        [
          makeElement("style", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "h1 { color: red; }" }]),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 2);
    });

    test("creates <head> inside <html> when none exists", () => {
      const rootNode = makeRootNode(
        [
          makeElement("html", undefined, [
            makeElement("body", undefined, [
              makeElement("p", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Hello" }]),
            ]),
          ]),
        ],
        [
          makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "New Title" }]),
        ]
      );

      mergeHeadContent(rootNode);

      const htmlEl = rootNode.children[0] as YetiElementNode;
      assert.equal(htmlEl.children!.length, 2);
      const headEl = htmlEl.children![0] as YetiElementNode;
      assert.equal(headEl.tagName, "head");
      assert.equal(headEl.children!.length, 1);
      assert.equal((headEl.children![0] as YetiElementNode).tagName, "title");
    });

    test("creates <head> at root level when no <html> exists", () => {
      const rootNode = makeRootNode(
        [
          makeElement("body"),
        ],
        [
          makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "New Title" }]),
        ]
      );

      mergeHeadContent(rootNode);

      assert.equal(rootNode.children.length, 2);
      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.tagName, "head");
      assert.equal(headEl.children!.length, 1);
    });

    test("later Head entries override earlier ones for deduped elements", () => {
      // Simulates: Layout has title "Default", first Head sets "Page", second Head sets "Final"
      const rootNode = makeRootNode(
        [
          makeElement("head", undefined, [
            makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Default" }]),
          ]),
        ],
        [
          makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Page" }]),
          makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Final" }]),
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      // Should only have one <title>, and it should be "Final"
      const titles = headEl.children!.filter(
        (c): c is YetiElementNode => c.type === YETI_NODE_TYPE.ELEMENT && (c as YetiElementNode).tagName === "title"
      );
      assert.equal(titles.length, 1);
      assert.equal((titles[0].children![0] as any).content, "Final");
    });

    test("appends non-element nodes (text, comments)", () => {
      const rootNode = makeRootNode(
        [makeElement("head", undefined, [])],
        [
          { type: YETI_NODE_TYPE.COMMENT, content: "head comment" },
        ]
      );

      mergeHeadContent(rootNode);

      const headEl = rootNode.children[0] as YetiElementNode;
      assert.equal(headEl.children!.length, 1);
      assert.equal(headEl.children![0].type, YETI_NODE_TYPE.COMMENT);
    });

    test("finds <head> nested inside <html>", () => {
      const rootNode = makeRootNode(
        [
          { type: YETI_NODE_TYPE.DOCTYPE, content: "html" },
          makeElement("html", { lang: "en" }, [
            makeElement("head", undefined, [
              makeElement("meta", { charset: "UTF-8" }),
            ]),
            makeElement("body"),
          ]),
        ],
        [
          makeElement("title", undefined, [{ type: YETI_NODE_TYPE.TEXT, content: "Merged" }]),
        ]
      );

      mergeHeadContent(rootNode);

      const htmlEl = rootNode.children[1] as YetiElementNode;
      const headEl = htmlEl.children![0] as YetiElementNode;
      assert.equal(headEl.children!.length, 2);
      assert.equal((headEl.children![0] as YetiElementNode).tagName, "meta");
      assert.equal((headEl.children![1] as YetiElementNode).tagName, "title");
    });
  });

  describe("end-to-end with components", () => {
    test("Head content merges into Layout's <head> via mergeHeadContent", async () => {
      function Layout({ children }: { children: YetiChildNode[] }) {
        return html`<html>
          <head>
            <meta charset="UTF-8" />
            <title>Default Title</title>
          </head>
          <body>${children}</body>
        </html>`;
      }

      const result = await html`<${Layout}>
        <${Head}>
          <title>Custom Title</title>
          <meta name="description" content="A great page" />
        </${Head}>
        <main>Hello</main>
      </${Layout}>`;

      // Before merging, the tree should have the Layout's head with default content,
      // and assets.head should have the Head component's children
      assert.ok(result.assets?.head);
      assert.equal(result.assets.head.length, 2);

      // Apply the merge (this is what processPageComponent does)
      mergeHeadContent(result);

      // After merging, the <head> should have the merged content
      const htmlEl = result.children[0] as YetiElementNode;
      const headEl = htmlEl.children![0] as YetiElementNode;

      // Find the title — should be "Custom Title" (override)
      const titles = headEl.children!.filter(
        (c): c is YetiElementNode => c.type === YETI_NODE_TYPE.ELEMENT && (c as YetiElementNode).tagName === "title"
      );
      assert.equal(titles.length, 1);
      assert.equal((titles[0].children![0] as any).content, "Custom Title");

      // Find the description meta — should be appended
      const descMetas = headEl.children!.filter(
        (c): c is YetiElementNode =>
          c.type === YETI_NODE_TYPE.ELEMENT &&
          (c as YetiElementNode).tagName === "meta" &&
          (c as YetiElementNode).attributes?.name === "description"
      );
      assert.equal(descMetas.length, 1);
      assert.equal(descMetas[0].attributes?.content, "A great page");
    });

    test("deeply nested Head content is collected and merged", async () => {
      function DeepChild() {
        return html`<${Head}>
          <meta name="author" content="Deep Child" />
        </${Head}>
        <span>Deep</span>`;
      }

      function MiddleComponent({ children }: { children: YetiChildNode[] }) {
        return html`<div>
          <${DeepChild} />
          ${children}
        </div>`;
      }

      function Layout({ children }: { children: YetiChildNode[] }) {
        return html`<html>
          <head>
            <title>Layout</title>
          </head>
          <body>${children}</body>
        </html>`;
      }

      const result = await html`<${Layout}>
        <${Head}>
          <title>Page Title</title>
        </${Head}>
        <${MiddleComponent}>
          <p>Content</p>
        </${MiddleComponent}>
      </${Layout}>`;

      assert.ok(result.assets?.head);

      mergeHeadContent(result);

      const htmlEl = result.children[0] as YetiElementNode;
      const headEl = htmlEl.children![0] as YetiElementNode;

      // Title should be "Page Title" (from MyPage's Head, which appears after DeepChild's Head in parsing order)
      const titles = headEl.children!.filter(
        (c): c is YetiElementNode => c.type === YETI_NODE_TYPE.ELEMENT && (c as YetiElementNode).tagName === "title"
      );
      assert.equal(titles.length, 1);
      assert.equal((titles[0].children![0] as any).content, "Page Title");

      // Author meta should be present from DeepChild
      const authorMetas = headEl.children!.filter(
        (c): c is YetiElementNode =>
          c.type === YETI_NODE_TYPE.ELEMENT &&
          (c as YetiElementNode).tagName === "meta" &&
          (c as YetiElementNode).attributes?.name === "author"
      );
      assert.equal(authorMetas.length, 1);
      assert.equal(authorMetas[0].attributes?.content, "Deep Child");
    });

    test("Head placed before Layout still overrides Layout's base <head> content", async () => {
      function Layout({ children }: { children: YetiChildNode[] }) {
        return html`<html>
          <head>
            <title>Layout Default</title>
            <meta name="description" content="Layout description" />
          </head>
          <body>${children}</body>
        </html>`;
      }

      // Head appears BEFORE the Layout in the template
      const result = await html`<${Head}>
        <title>Page Override</title>
        <meta name="description" content="Page description" />
      </${Head}>
      <${Layout}>
        <main>Content</main>
      </${Layout}>`;

      assert.ok(result.assets?.head);

      mergeHeadContent(result);

      const htmlEl = result.children[0] as YetiElementNode;
      const headEl = htmlEl.children![0] as YetiElementNode;

      // Title should be overridden by the Head component
      const titles = headEl.children!.filter(
        (c): c is YetiElementNode => c.type === YETI_NODE_TYPE.ELEMENT && (c as YetiElementNode).tagName === "title"
      );
      assert.equal(titles.length, 1);
      assert.equal((titles[0].children![0] as any).content, "Page Override");

      // Description meta should be overridden by the Head component
      const descMetas = headEl.children!.filter(
        (c): c is YetiElementNode =>
          c.type === YETI_NODE_TYPE.ELEMENT &&
          (c as YetiElementNode).tagName === "meta" &&
          (c as YetiElementNode).attributes?.name === "description"
      );
      assert.equal(descMetas.length, 1);
      assert.equal(descMetas[0].attributes?.content, "Page description");
    });
  });
});
