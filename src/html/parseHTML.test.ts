import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { parseHTML } from "./parseHTML.ts";
import { YETI_NODE_TYPE, parentNode } from "./types.ts";
import type { YetiElementNode, YetiNode, YetiRootNode } from "./types.ts";
import { makeDynamicValuePlaceholder } from "./utils.ts";
import { YetiHTMLParsingError } from "./error.ts";

// Helper function to assign parent nodes in the expected tree for easier assertion writing
const stripParentsFromNodeTree = (rootNode: YetiRootNode) => {
  const newRootNode = { ...rootNode, children: [] as any[] };

  const traverse = (node: Exclude<YetiNode, YetiRootNode>, parent: any) => {
    const { [parentNode]: _, ...nodeWithoutParent } = node;
    const newNode = { ...nodeWithoutParent };

    if ("children" in newNode) {
      newNode.children = [];
    }

    if ("children" in node) {
      for (const child of node.children) {
        traverse(child, newNode);
      }
    }

    parent.children.push(newNode);
  };

  for (const child of rootNode.children) {
    traverse(child, newRootNode);
  }
  return newRootNode;
}

const compareNodeTrees = (actual: YetiRootNode, expected: Record<string, any>) => {
  const actualWithoutParents = stripParentsFromNodeTree(actual);
  assert.deepEqual(actualWithoutParents, expected);
};

describe("parseHTML", () => {
  test("should correctly parse an empty HTML string", async () => {
    const result = await parseHTML("", []);
    compareNodeTrees(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [],
    });
  });

  test("should correctly parse a string with only whitespace", async () => {
    const result = await parseHTML("   \n\t  ", []);
    compareNodeTrees(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.TEXT,
        content: "   \n\t  ",
      }],
    });
  });

  test("should correctly parse a doctype declaration", async () => {
    const result = await parseHTML("<!DOCTYPE html>", []);
    compareNodeTrees(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.DOCTYPE,
        content: "html",
      }],
    });
  });

  test("should parse a single HTML element as expected", async () => {
    const result = await parseHTML("<div></div>", []);
    compareNodeTrees(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.ELEMENT,
        tagName: "div",
        attributes: {},
        children: [],
      }],
    });
  });

  test("should parse nested HTML elements correctly", async () => {
    const result = await parseHTML("<div><span>Text</span></div>", []);
    compareNodeTrees(result, {
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
    });
  });

  test("should parse self-closing tags correctly", async () => {
    const result = await parseHTML("<div><img src='image.png' /></div>", []);
    compareNodeTrees(result, {
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
    });
  });

  test("should handle void elements correctly", async () => {
    const result = await parseHTML("<area><base><br><col><embed><hr><img><input><link><meta><param><source><track><wbr>", []);
    compareNodeTrees(result, {
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
    });
  });

  test("should parse elements with attributes correctly", async () => {
    const result = await parseHTML("<a href='https://example.com' target='_blank' data-bool>Link</a>", []);
    compareNodeTrees(result, {
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
    });
  });

  test("should parse comments correctly", async () => {
    const result = await parseHTML("<!-- This is a comment -->", []);
    compareNodeTrees(result, {
      type: YETI_NODE_TYPE.ROOT,
      children: [{
        type: YETI_NODE_TYPE.COMMENT,
        content: "This is a comment",
      }],
    });
  });

  test("should parse a component correctly", async () => {
    const component = ({ children, title }: { children: YetiNode[]; title: string }) => ({
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

    compareNodeTrees(result, {
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
    })
  });
});