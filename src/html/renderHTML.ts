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
  let result = "";

  for (const attrName in attributes) {
    const attrValue = attributes[attrName];
    switch (attrValue) {
      case true:
        // True boolean attributes should be rendered as just the attribute name (e.g. "disabled")
        if (result) result += " ";
        result += attrName;
        break;
      case false:
      case null:
      case undefined:
        // False or null/undefined attributes should not be rendered
        break;
      default:
        // For other values, render as key="value".
        // We'll sanitize the attribute value to ensure any " characters are properly escaped.
        if (result) result += " ";
        result += `${attrName}="${sanitizeAttributeValue(attrValue)}"`;
        break;
    }
  }

  return result;
};

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
      shouldEscapeTextContent: !isRawContentTag,
    };

    if (options.indentation === null) {
      // If no indentation, just render children without any newlines or extra spaces.
      renderedChildren = children.map((child) => renderChildNode(child, childOptions)).join("");
    } else {
      const childIndent = options.indentation.repeat(childOptions.indentationLevel);
      const closingIndent = options.indentationLevel > 0
        ? options.indentation.repeat(options.indentationLevel)
        : "";

      // Build children output iteratively, deciding per-child whether to insert
      // a newline+indent ("block mode") or flow without a separator ("inline mode").
      //
      // Inline mode is entered/sustained when a child is directly adjacent to
      // non-whitespace text that contains no surrounding newlines, either because:
      //   (a) the previous sibling was such a text node, OR
      //   (b) the next sibling is such a text node.
      //
      // Whitespace-only text nodes in block mode are suppressed entirely, as they
      // are insignificant between block-level siblings.
      let built = "";
      let inlineMode = false;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const isTextNode = child.type === YETI_NODE_TYPE.TEXT;
        const isWhitespaceOnly = isTextNode && child.content.trimStart() === "";

        if (inlineMode) {
          built += renderChildNode(child, childOptions);
          // A trailing newline in a text node signals the end of the inline run.
          if (isTextNode && !isWhitespaceOnly && child.content.endsWith("\n")) {
            inlineMode = false;
          }
        } else {
          // Block mode: suppress insignificant whitespace-only text nodes.
          if (isWhitespaceOnly) {
            continue;
          }

          // Determine if this child is in an inline context:
          //   (a) It is itself a non-whitespace text node not starting with a newline.
          //   (b) Its immediate next sibling is a non-whitespace text node not starting with a newline.
          const nextSibling = i + 1 < children.length ? children[i + 1] : null;
          const nextSiblingIsInlineText =
            nextSibling !== null &&
            nextSibling.type === YETI_NODE_TYPE.TEXT &&
            nextSibling.content.trimStart() !== "" &&
            !nextSibling.content.startsWith("\n");
          const isInlineContext =
            nextSiblingIsInlineText ||
            (isTextNode && child.content.trimStart() !== "" && !child.content.startsWith("\n"));

          if (isInlineContext) {
            // No newline before this child; enter inline mode.
            built += renderChildNode(child, childOptions);
            inlineMode = true;
            if (isTextNode && child.content.endsWith("\n")) {
              inlineMode = false;
            }
          } else {
            // Block child: prefix with newline+indent. Skip if the child renders empty
            // (e.g. a stripped comment) to avoid orphaned indentation lines.
            const rendered = renderChildNode(child, childOptions);
            if (rendered !== "") {
              built += `\n${childIndent}${rendered}`;
            }
          }
        }
      }

      // Add the closing newline+dedent only when in block mode and something was rendered.
      if (!inlineMode && built !== "") {
        built += `\n${closingIndent}`;
      }

      renderedChildren = built;
    }
  }

  return `<${tagName}${renderedAttributes ? ` ${renderedAttributes}` : ""}>${renderedChildren}</${tagName}>`;
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
