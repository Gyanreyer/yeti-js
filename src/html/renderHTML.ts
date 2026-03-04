import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiRootNode, YetiElementNode, YetiTextNode, YetiCommentNode, YetiDoctypeNode, YetiChildNode } from "./types.ts";
import { isRawStringContentTag, isVoidTag, sanitizeAttributeValue, sanitizeHTMLTextContent } from "./utils.ts";

interface RenderChildNodeOptions {
  shouldStripComments: boolean;
  indentation: string | null;
  indentationLevel: number;
  shouldEscapeTextContent: boolean;
}

const renderDoctypeNode = (node: YetiDoctypeNode): string => {
  return `<!DOCTYPE ${node.content}>`;
};

const renderCommentNode = (node: YetiCommentNode): string => {
  return `<!-- ${node.content} -->`;
};

const renderTextNode = (node: YetiTextNode, { shouldEscapeTextContent }: RenderChildNodeOptions & {
  sanitize?: boolean;
}): string => {
  return shouldEscapeTextContent ? sanitizeHTMLTextContent(node.content) : node.content;
};

const renderAttributes = (attributes: Record<string, unknown>): string => {
  let attrStrs: string[] = [];

  for (const attrName in attributes) {
    const attrValue = attributes[attrName];
    switch (attrValue) {
      case true:
        // True boolean attributes should be rendered as just the attribute name (e.g. "disabled")
        attrStrs.push(attrName);
        break;
      case false:
      case null:
      case undefined:
        // False or null/undefined attributes should not be rendered
        break;
      default:
        // For other values, render as key="value".
        // We'll sanitize the attribute value to ensure any " characters are properly escaped.
        attrStrs.push(`${attrName}="${sanitizeAttributeValue(attrValue)}"`);
        break;
    }
  }

  return attrStrs.join(" ");
};

const NEWLINE_REGEX = /\n/g;

const renderElementNode = (node: YetiElementNode, options: RenderChildNodeOptions): string => {
  const { tagName, attributes, children } = node;

  const renderedAttributes = attributes ? renderAttributes(attributes) : "";

  if (isVoidTag(tagName)) {
    // Void tags can't have child contents
    return `<${tagName}${renderedAttributes ? ` ${renderedAttributes}` : ""}>`;
  }

  let renderedChildren = "";
  if (children) {
    const isRawContentTag = isRawStringContentTag(tagName);
    const childOptions: RenderChildNodeOptions = {
      ...options,
      indentationLevel: options.indentationLevel + 1,
      shouldEscapeTextContent: !isRawContentTag
    };

    let childStartIndentation = "";
    let childEndIndentation = "";

    const hasOneLineTextChild = children.length === 1 && children[0].type === YETI_NODE_TYPE.TEXT && !NEWLINE_REGEX.test(children[0].content);

    if (options.indentation !== null && !hasOneLineTextChild) {
      childStartIndentation = `\n${options.indentation.repeat(childOptions.indentationLevel)}`;
      childEndIndentation = `\n${options.indentationLevel > 0 ? options.indentation.repeat(options.indentationLevel) : ""}`;
    }

    renderedChildren = `${childStartIndentation}${children.map(
      (child) => renderChildNode(child, childOptions)
    ).join(childStartIndentation)}${childEndIndentation}`;
  }

  return `<${tagName}${attributes ? ` ${renderAttributes(attributes)}` : ""}>${renderedChildren}</${tagName}>`;
};

const renderChildNode = (node: YetiChildNode, options: RenderChildNodeOptions): string => {
  switch (node.type) {
    case YETI_NODE_TYPE.TEXT:
      return renderTextNode(node, options);
    case YETI_NODE_TYPE.ELEMENT:
      return renderElementNode(node, options);
    case YETI_NODE_TYPE.COMMENT:
      if (options.shouldStripComments) {
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
   * Whether to strip comments from the output HTML.
   *
   * @default true
   */
  shouldStripComments?: boolean;
  /**
   * The string to use for indentation when pretty-printing the HTML.
   * Can be set to null to disable indentation and newlines entirely (i.e. minify the output).
   * Indentation is disabled by default.
   *
   * @default null
   */
  indentation?: string | null;
}

/**
 * Renders a YetiRootNode object into an HTML string.
 */
export const renderHTML = (rootNode: YetiRootNode, { shouldStripComments = true, indentation = null }: RenderHTMLOptions = {}): string => {
  return rootNode.children.map(child => renderChildNode(child, {
    shouldStripComments,
    indentation,
    indentationLevel: 0,
    shouldEscapeTextContent: true,
  })).join(indentation !== null ? "\n" : "");
};
