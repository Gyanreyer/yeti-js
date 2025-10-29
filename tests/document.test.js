import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseHTML, defaultTreeAdapter, html as parse5HTML, html } from 'parse5';

import { isDocumentNode, queryElement, transformDocumentNodes, TRANSFORM_ACTIONS } from "../src/utils/document.js";

/**
 * @import { DefaultTreeAdapterTypes as Parse5Types } from 'parse5';
 */

describe("isDocumentNode", () => {
  test("should return true for document nodes", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
    assert.strictEqual(isDocumentNode(document), true);
  });

  test("should return false for element nodes", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div></div></body></html>");
    const htmlElement = document.childNodes.find(node => node.nodeName === "html");
    if (!htmlElement) {
      assert.fail("HTML element not found");
    }
    assert.strictEqual(isDocumentNode(htmlElement), false);
  });

  test("should return false for text nodes", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body>Hello World</body></html>");
    const bodyElement = queryElement(document,
      node => node.tagName === "body"
    );
    assert.ok(bodyElement);
    const textNode = bodyElement.childNodes.find(
      /**
       * @returns {node is Parse5Types.TextNode}
       */
      node => defaultTreeAdapter.isTextNode(node)
    );
    if (!textNode) {
      assert.fail("Text node not found");
    }
    assert.strictEqual(textNode.value, "Hello World");
    assert.strictEqual(isDocumentNode(textNode), false);
  });

  test("should return false for doctype nodes", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
    const doctypeNode = document.childNodes.find(node => defaultTreeAdapter.isDocumentTypeNode(node));
    assert.ok(doctypeNode);
    assert.strictEqual(isDocumentNode(doctypeNode), false);
  });
});

describe("queryElement", () => {
  test("should find element by tag name", () => {
    const document = parseHTML("<!DOCTYPE html><html><head><title>Test</title></head><body><div id='test'>Content</div></body></html>");

    const titleElement = queryElement(document, node => node.tagName === "title");
    assert.ok(titleElement);
    assert.strictEqual(titleElement.tagName, "title");

    const divElement = queryElement(document, node => node.tagName === "div");
    assert.ok(divElement);
    assert.deepStrictEqual(divElement.attrs, [{ name: "id", value: "test" }]);
  });

  test("should find element by attribute", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div id='target'>Content</div><div class='other'>Other</div></body></html>");

    const targetElement = queryElement(document, node => {
      return node.attrs.some(attr => attr.name === "id" && attr.value === "target");
    });
    assert.ok(targetElement);
    assert.strictEqual(targetElement.tagName, "div");
    assert.deepStrictEqual(targetElement.attrs, [{ name: "id", value: "target" }]);
  });

  test("should return null when element is not found", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Content</div></body></html>");

    const notFound = queryElement(document, node => node.tagName === "span");
    assert.strictEqual(notFound, null);
  });

  test("should return first matching element", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div class='first'>First</div><div class='second'>Second</div></body></html>");

    const firstDiv = queryElement(document, node => node.tagName === "div");
    assert.ok(firstDiv);
    assert.deepStrictEqual(firstDiv.attrs, [{ name: "class", value: "first" }], "The first matching div with class='first' should be returned");
  });

  test("should work when starting from an element node", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div><span>Nested</span></div></body></html>");

    const bodyElement = queryElement(document, node => node.tagName === "body");
    assert.ok(bodyElement);
    const spanElement = queryElement(bodyElement, node => node.tagName === "span");
    assert.ok(spanElement);
  });

  test("should not return the starting element if it matches", () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div id='parent'><div id='child'>Content</div></div></body></html>");

    const parentDivElement = queryElement(document, node => node.tagName === "div");
    assert.ok(parentDivElement);
    assert.deepStrictEqual(parentDivElement.attrs, [{ name: "id", value: "parent" }]);
    const childDivElement = queryElement(parentDivElement, node => node.tagName === "div");
    assert.ok(childDivElement);
    assert.notStrictEqual(parentDivElement, childDivElement);
    assert.deepStrictEqual(childDivElement.attrs, [{ name: "id", value: "child" }]);
  });
});

describe("transformDocumentNodes", () => {
  test("should continue traversal by default", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Content</div></body></html>");

    const transformedDocument = structuredClone(document);
    await transformDocumentNodes(transformedDocument, async (node) => {
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    assert.notStrictEqual(transformedDocument, document);
    assert.deepStrictEqual(transformedDocument, document, "The transformed document should be identical to the original");
  });

  test("should remove nodes when REMOVE is returned", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Keep</div><span>Remove</span><p>Keep</p></body></html>");

    let spanElement = queryElement(document, node => node.tagName === "span");
    assert.ok(spanElement);

    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "span") {
        return TRANSFORM_ACTIONS.REMOVE;
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    spanElement = queryElement(document, node => node.tagName === "span");
    assert.strictEqual(spanElement, null);

    const divElement = queryElement(document, node => node.tagName === "div");
    const pElement = queryElement(document, node => node.tagName === "p");
    assert.ok(divElement);
    assert.ok(pElement);
  });

  test("should replace nodes when REPLACE is returned", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Original</div></body></html>");

    let divElement = queryElement(document, node => node.tagName === "div");
    assert.ok(divElement);

    const newSpan = defaultTreeAdapter.createElement("span", parse5HTML.NS.HTML, []);
    defaultTreeAdapter.insertText(newSpan, "Replaced");

    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "div") {
        return [TRANSFORM_ACTIONS.REPLACE, newSpan];
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    divElement = queryElement(document, node => node.tagName === "div");
    assert.strictEqual(divElement, null);

    const spanElement = queryElement(document, node => node.tagName === "span");
    assert.ok(spanElement);
    assert.strictEqual(spanElement, newSpan);
  });

  test("should replace with multiple nodes", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Original</div></body></html>");

    const span1 = defaultTreeAdapter.createElement("span", parse5HTML.NS.HTML, []);
    defaultTreeAdapter.insertText(span1, "First");
    const span2 = defaultTreeAdapter.createElement("span", parse5HTML.NS.HTML, []);
    defaultTreeAdapter.insertText(span2, "Second");

    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "div") {
        return [TRANSFORM_ACTIONS.REPLACE, span1, span2];
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    const bodyElement = queryElement(document, node => node.tagName === "body");
    assert.ok(bodyElement);
    const spanElements = [];

    for (const child of bodyElement.childNodes) {
      if (defaultTreeAdapter.isElementNode(child) && child.tagName === "span") {
        spanElements.push(child);
      }
    }

    assert.deepStrictEqual(spanElements, [span1, span2]);
  });

  test("should skip children when SKIP_CHILDREN is returned", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div><span>Nested</span></div></body></html>");
    let visitedSpan = false;

    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "div") {
        return TRANSFORM_ACTIONS.SKIP_CHILDREN;
      }
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "span") {
        visitedSpan = true;
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    assert.strictEqual(visitedSpan, false);
  });

  test("should handle async transformers", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Content</div></body></html>");
    let asyncCallCount = 0;

    await transformDocumentNodes(document, async (node) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      asyncCallCount++;
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    assert.ok(asyncCallCount > 0);
  });

  test("should properly update parent references when removing nodes", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Keep</div><span>Remove</span></body></html>");

    /** @type {any} */
    let removedNode = null;
    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "span") {
        removedNode = node;
        return TRANSFORM_ACTIONS.REMOVE;
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    assert.ok(removedNode);
    assert.strictEqual(removedNode.parentNode, null);
  });

  test("should properly update parent references when replacing nodes", async () => {
    const document = parseHTML("<!DOCTYPE html><html><head></head><body><div>Original</div></body></html>");

    /** @type {any} */
    let replacedNode = null;
    /** @type {any} */
    let newNode = null;
    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "div") {
        replacedNode = node;
        newNode = defaultTreeAdapter.createElement("span", parse5HTML.NS.HTML, []);
        return [TRANSFORM_ACTIONS.REPLACE, newNode];
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    assert.ok(replacedNode);
    assert.ok(newNode);
    assert.strictEqual(replacedNode.parentNode, null);
    assert.ok(newNode.parentNode);
    assert.strictEqual(newNode.parentNode.tagName, "body");
  });

  test("should handle complex document transformations", async () => {
    const document = parseHTML(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test</title>
          <meta charset="utf-8">
        </head>
        <body>
          <div class="container">
            <h1>Title</h1>
            <p>Paragraph 1</p>
            <span>Remove me</span>
            <p>Paragraph 2</p>
          </div>
        </body>
      </html>
    `);

    await transformDocumentNodes(document, async (node) => {
      if (defaultTreeAdapter.isElementNode(node)) {
        // Remove all span elements
        if (node.tagName === "span") {
          return TRANSFORM_ACTIONS.REMOVE;
        }
        // Replace h1 with h2
        if (node.tagName === "h1") {
          const h2 = defaultTreeAdapter.createElement("h2", parse5HTML.NS.HTML, []);
          // Copy text content
          for (const child of node.childNodes) {
            defaultTreeAdapter.appendChild(h2, child);
          }
          return [TRANSFORM_ACTIONS.REPLACE, h2];
        }
      }
      return TRANSFORM_ACTIONS.CONTINUE;
    });

    const spanElement = queryElement(document, node => node.tagName === "span");
    const h1Element = queryElement(document, node => node.tagName === "h1");
    const h2Element = queryElement(document, node => node.tagName === "h2");

    assert.strictEqual(spanElement, null);
    assert.strictEqual(h1Element, null);
    assert.ok(h2Element);
  });
});