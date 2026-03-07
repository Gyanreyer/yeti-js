import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "./markdownExtension.ts";
import { YETI_NODE_TYPE } from "../../html/types.ts";
import type { YetiRootNode } from "../../html/types.ts";

describe("parseMarkdown", () => {
  describe("headings", () => {
    test("parses h1", async () => {
      const result = await parseMarkdown("# Hello");
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "h1",
            children: [{ type: YETI_NODE_TYPE.TEXT, content: "Hello" }],
          },
        ],
      });
    });

    test("parses h2 through h6", async () => {
      for (let depth = 2; depth <= 6; depth++) {
        const result = await parseMarkdown(`${"#".repeat(depth)} Heading ${depth}`);
        assert.strictEqual(result.children.length, 1);
        const heading = result.children[0];
        assert.ok(heading.type === YETI_NODE_TYPE.ELEMENT);
        assert.strictEqual(heading.tagName, `h${depth}`);
      }
    });
  });

  describe("paragraph", () => {
    test("parses plain paragraph", async () => {
      const result = await parseMarkdown("Hello world.");
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [
          {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: "p",
            children: [{ type: YETI_NODE_TYPE.TEXT, content: "Hello world." }],
          },
        ],
      });
    });

    test("parses bold text", async () => {
      const result = await parseMarkdown("**bold**");
      const p = result.children[0];
      assert.ok(p.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual(p.tagName, "p");
      assert.ok(p.children?.[0].type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((p.children?.[0] as any).tagName, "strong");
    });

    test("parses italic text", async () => {
      const result = await parseMarkdown("*italic*");
      const p = result.children[0];
      assert.ok(p.type === YETI_NODE_TYPE.ELEMENT && p.children?.[0].type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((p.children[0] as any).tagName, "em");
    });

    test("parses inline code", async () => {
      const result = await parseMarkdown("Some `code` here.");
      const p = result.children[0];
      assert.ok(p.type === YETI_NODE_TYPE.ELEMENT);
      const codeNode = p.children?.find((c): c is any => c.type === YETI_NODE_TYPE.ELEMENT && (c as any).tagName === "code");
      assert.ok(codeNode, "expected a <code> element");
      assert.deepStrictEqual(codeNode.children, [{ type: YETI_NODE_TYPE.TEXT, content: "code" }]);
    });
  });

  describe("blockquote", () => {
    test("parses blockquote", async () => {
      const result = await parseMarkdown("> A quote.");
      assert.strictEqual(result.children.length, 1);
      const bq = result.children[0];
      assert.ok(bq.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual(bq.tagName, "blockquote");
      assert.ok(bq.children?.length, "blockquote should have children");
      const inner = bq.children![0];
      assert.ok(inner.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((inner as any).tagName, "p");
    });
  });

  describe("lists", () => {
    test("parses unordered list", async () => {
      const result = await parseMarkdown("- alpha\n- beta\n- gamma");
      assert.strictEqual(result.children.length, 1);
      const ul = result.children[0];
      assert.ok(ul.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual(ul.tagName, "ul");
      assert.strictEqual(ul.children?.length, 3);
      assert.ok(ul.children?.every((c) => c.type === YETI_NODE_TYPE.ELEMENT && (c as any).tagName === "li"));
    });

    test("parses ordered list", async () => {
      const result = await parseMarkdown("1. one\n2. two\n3. three");
      assert.strictEqual(result.children.length, 1);
      const ol = result.children[0];
      assert.ok(ol.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual(ol.tagName, "ol");
      assert.strictEqual(ol.children?.length, 3);
    });

    test("ordered list with non-1 start gets start attribute", async () => {
      const result = await parseMarkdown("3. three\n4. four");
      const ol = result.children[0];
      assert.ok(ol.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual(ol.tagName, "ol");
      assert.strictEqual((ol.attributes as any)?.start, 3);
    });
  });

  describe("code block", () => {
    test("parses fenced code block with language", async () => {
      const result = await parseMarkdown("```js\nconsole.log('hi');\n```");
      assert.strictEqual(result.children.length, 1);
      const pre = result.children[0];
      assert.ok(pre.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual(pre.tagName, "pre");
      const code = pre.children?.[0];
      assert.ok(code?.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((code as any).tagName, "code");
      assert.deepStrictEqual((code as any).attributes, { "data-lang": "js", class: "language-js" });
      assert.deepStrictEqual((code as any).children, [{ type: YETI_NODE_TYPE.TEXT, content: "console.log('hi');" }]);
    });

    test("parses fenced code block without language", async () => {
      const result = await parseMarkdown("```\nplain code\n```");
      const pre = result.children[0];
      assert.ok(pre.type === YETI_NODE_TYPE.ELEMENT);
      const code = (pre as any).children?.[0];
      assert.ok(code, "expected code child");
      assert.strictEqual(code.attributes, undefined);
    });
  });

  describe("horizontal rule", () => {
    test("parses hr", async () => {
      const result = await parseMarkdown("---");
      assert.deepStrictEqual<YetiRootNode>(result, {
        type: YETI_NODE_TYPE.ROOT,
        children: [{ type: YETI_NODE_TYPE.ELEMENT, tagName: "hr" }],
      });
    });
  });

  describe("links and images", () => {
    test("parses link with href", async () => {
      const result = await parseMarkdown("[click here](https://example.com)");
      const p = result.children[0];
      assert.ok(p.type === YETI_NODE_TYPE.ELEMENT);
      const a = p.children?.[0];
      assert.ok(a?.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((a as any).tagName, "a");
      assert.strictEqual((a as any).attributes?.href, "https://example.com");
    });

    test("parses link with title", async () => {
      const result = await parseMarkdown('[click here](https://example.com "My Title")');
      const p = result.children[0];
      assert.ok(p.type === YETI_NODE_TYPE.ELEMENT);
      const a = p.children?.[0];
      assert.ok(a?.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((a as any).attributes?.title, "My Title");
    });

    test("parses image", async () => {
      const result = await parseMarkdown("![alt text](https://example.com/img.png)");
      const p = result.children[0];
      assert.ok(p.type === YETI_NODE_TYPE.ELEMENT);
      const img = p.children?.[0];
      assert.ok(img?.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((img as any).tagName, "img");
      assert.strictEqual((img as any).attributes?.src, "https://example.com/img.png");
      assert.strictEqual((img as any).attributes?.alt, "alt text");
    });
  });

  describe("raw HTML block", () => {
    test("passes through block-level HTML as parsed YetiNodes", async () => {
      const result = await parseMarkdown("<div>\n  <p>Hello</p>\n</div>");
      assert.strictEqual(result.children.length, 1);
      const div = result.children[0];
      assert.ok(div.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((div as any).tagName, "div");
    });
  });

  describe("table", () => {
    test("parses table with header and body", async () => {
      const result = await parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
      assert.strictEqual(result.children.length, 1);
      const table = result.children[0];
      assert.ok(table.type === YETI_NODE_TYPE.ELEMENT);
      assert.strictEqual((table as any).tagName, "table");
      const thead = (table as any).children?.[0];
      assert.strictEqual(thead?.tagName, "thead");
      const tbody = (table as any).children?.[1];
      assert.strictEqual(tbody?.tagName, "tbody");
    });
  });

  describe("combined content", () => {
    test("parses multiple block elements", async () => {
      const result = await parseMarkdown("# Title\n\nA paragraph.\n\n---");
      assert.strictEqual(result.children.length, 3);
      assert.ok(result.children[0].type === YETI_NODE_TYPE.ELEMENT && (result.children[0] as any).tagName === "h1");
      assert.ok(result.children[1].type === YETI_NODE_TYPE.ELEMENT && (result.children[1] as any).tagName === "p");
      assert.ok(result.children[2].type === YETI_NODE_TYPE.ELEMENT && (result.children[2] as any).tagName === "hr");
    });
  });
});
