import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiRootNode, YetiElementNode, YetiTextNode, YetiCommentNode, YetiDoctypeNode, YetiChildNode } from "./types.ts";
import { sanitizeHTMLTextContent } from "./utils.ts";

const renderDoctypeNode = (node: YetiDoctypeNode): string => {
  return `<!DOCTYPE ${node.content}>`;
};

const renderCommentNode = (node: YetiCommentNode): string => {
  return `<!-- ${node.content} -->`;
};

const renderTextNode = (node: YetiTextNode): string => {
  // Sanitize text content to prevent HTML injection vulnerabilities
  return sanitizeHTMLTextContent(node.content);
};

const renderAttributes = (attributes: Record<string, unknown>): string => {
  return Object.entries(attributes)
    .map(([key, value]) => {
      if (value === true) {
        return key; // Boolean attributes can be rendered as just the key
      } else if (value === false || value == null) {
        return ""; // False or null/undefined attributes should not be rendered
      } else {
        // For other values, render as key="value" with proper escaping
        const escapedValue = String(value).replace(/"/g, "&quot;");
        return `${key}="${escapedValue}"`;
      }
    })
    .filter(attrStr => attrStr.length > 0) // Filter out empty attribute strings
    .join(" ");
};

const renderElementNode = (node: YetiElementNode): string => {
  const { tagName, attributes, children } = node;
  return `<${tagName}${attributes ? ` ${renderAttributes(attributes)}` : ""}>${children ? children.map(renderChildNode).join("") : ""}</${tagName}>`;
};

const renderChildNode = (node: YetiChildNode): string => {
  switch (node.type) {
    case YETI_NODE_TYPE.TEXT:
      return renderTextNode(node);
    case YETI_NODE_TYPE.ELEMENT:
      return renderElementNode(node);
    case YETI_NODE_TYPE.COMMENT:
      return renderCommentNode(node);
    case YETI_NODE_TYPE.DOCTYPE:
      return renderDoctypeNode(node);
    default:
      throw new Error(`Unsupported node type ${(node as any).type} encountered during rendering.`);
  }
};

/**
 * Renders a YetiRootNode object into an HTML string.
 */
export const renderHTML = (rootNode: YetiRootNode): string => {
  return rootNode.children.map(renderChildNode).join("");
};
