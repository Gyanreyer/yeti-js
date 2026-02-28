import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiRootNode, YetiElementNode, YetiTextNode, YetiCommentNode, YetiDoctypeNode, YetiChildNode } from "./types.ts";
import { isPreserveWhitespaceTag, isRawStringContentTag, sanitizeHTMLTextContent } from "./utils.ts";

const WHITESPACE_REGEX = /\s+/g;

export const collapseWhitespace = (text: string): string => text.replace(WHITESPACE_REGEX, " ");

interface RenderChildNodeOptions {
  minify: boolean;
  preserveWhitespace: boolean;
}

const renderDoctypeNode = (node: YetiDoctypeNode): string => {
  return `<!DOCTYPE ${node.content}>`;
};

const renderCommentNode = (node: YetiCommentNode): string => {
  return `<!-- ${node.content} -->`;
};


const renderTextNode = (node: YetiTextNode, { minify, preserveWhitespace }: RenderChildNodeOptions): string => {
  // Sanitize text content to prevent HTML injection vulnerabilities
  const sanitized = sanitizeHTMLTextContent(node.content);

  if (!minify || preserveWhitespace) {
    return sanitized;
  }

  return collapseWhitespace(sanitized.trim());
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

const renderElementNode = (node: YetiElementNode, options: RenderChildNodeOptions): string => {
  const { tagName, attributes, children } = node;
  const preserveWhitespace = options.preserveWhitespace || isRawStringContentTag(tagName) || isPreserveWhitespaceTag(tagName);
  const childOptions: RenderChildNodeOptions = {
    minify: options.minify,
    preserveWhitespace,
  };
  const renderedChildren = children ? children.map(child => renderChildNode(child, childOptions)).join("") : "";

  return `<${tagName}${attributes ? ` ${renderAttributes(attributes)}` : ""}>${renderedChildren}</${tagName}>`;
};

const renderChildNode = (node: YetiChildNode, options: RenderChildNodeOptions): string => {
  switch (node.type) {
    case YETI_NODE_TYPE.TEXT:
      return renderTextNode(node, options);
    case YETI_NODE_TYPE.ELEMENT:
      return renderElementNode(node, options);
    case YETI_NODE_TYPE.COMMENT:
      if (options.minify) {
        // Strip comments entirely when minifying
        return "";
      }
      return renderCommentNode(node);
    case YETI_NODE_TYPE.DOCTYPE:
      return renderDoctypeNode(node);
    default:
      throw new Error(`Unsupported node type ${(node as any).type} encountered during rendering.`);
  }
};

export interface RenderHTMLOptions {
  /**
   * Whether to minify the output HTML by collapsing whitespace and removing comments. Defaults to false.
   */
  minify?: boolean;
}

/**
 * Renders a YetiRootNode object into an HTML string.
 */
export const renderHTML = (rootNode: YetiRootNode, { minify = false }: RenderHTMLOptions = {}): string => {
  return rootNode.children.map(child => renderChildNode(child, { minify, preserveWhitespace: false })).join("");
};
