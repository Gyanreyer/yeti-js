import { lexHTML, TOKEN_TYPE } from "./lexHTML.ts";
import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiNode, YetiRootNode, YetiElementNode, YetiCommentNode, YetiDoctypeNode, YetiChildNode } from "./types.ts";
import { YetiHTMLParsingError } from "../error.ts";
import { isVoidTag } from "./utils.ts";
import { isBundleInlineObject, makeBundleInlineElementNode } from "../bundle/bundle.ts";

// TODO:
// - Handle html import objects
// - Handle inlined bundle content objects
// - Bundle CSS and JS resources attached to components and include them in parsed output

// Node type to identify a component node
const COMPONENT_NODE_TYPE = 1000;

// A node representing a parsed component which has not been closed and rendered yet.
// Once closed, we will render the component by calling the component function with the parsed attributes and children,
// and then insert the rendered content into the tree.
type OpenComponentNode = {
  type: typeof COMPONENT_NODE_TYPE;
  component: Function;
  attributes?: Record<string, unknown>;
  children?: YetiChildNode[];
};

const isYetiNode = (value: unknown): value is YetiNode => {
  return typeof value === "object" && value !== null && "type" in value;
};

const appendContentToNode = async (parent: YetiRootNode | YetiElementNode | OpenComponentNode, content: unknown) => {
  let unwrappedContent = content;
  if (typeof unwrappedContent === "function") {
    try {
      unwrappedContent = unwrappedContent();
    } catch (error) {
      throw new YetiHTMLParsingError(`An error occurred while executing an inlined function in HTML`, {
        cause: error,
      });
    }
  }
  if (unwrappedContent instanceof Promise) {
    unwrappedContent = await unwrappedContent;
  }

  if (unwrappedContent === null || unwrappedContent === undefined || unwrappedContent === "") {
    // If the content is null, undefined, or an empty string, we can just ignore it and not insert anything.
    return;
  }

  if (typeof unwrappedContent === "object") {
    // If the content is an object, we will try to unwrap any iterables or YetiNodes and insert them appropriately.
    // If the content is an iterable object, iterate over its values and insert each item as a separate node. Handle both sync and async iterables.
    if (Symbol.iterator in unwrappedContent && typeof unwrappedContent[Symbol.iterator] === "function") {
      for (const item of unwrappedContent as Generator) {
        await appendContentToNode(parent, item);
      }
      return;
    } else if (Symbol.asyncIterator in unwrappedContent && typeof unwrappedContent[Symbol.asyncIterator] === "function") {
      for await (const item of unwrappedContent as AsyncGenerator) {
        await appendContentToNode(parent, item);
      }
      return;
    }

    parent.children ??= [];

    if (isYetiNode(unwrappedContent)) {
      switch (unwrappedContent.type) {
        case YETI_NODE_TYPE.ROOT:
          // Unwrap root nodes' children and insert them directly, since we don't want to nest root nodes inside other nodes.
          // We may get a root node from dynamic content like the return value from rendering a nested component.
          parent.children.push(...unwrappedContent.children);
          break;
        case YETI_NODE_TYPE.TEXT:
          // Merge text into a single text node if the last child is also a text node,
          // to avoid unnecessary fragmentation of text nodes.
          const lastChild = parent.children[parent.children.length - 1];
          if (lastChild?.type === YETI_NODE_TYPE.TEXT) {
            lastChild.content += unwrappedContent.content;
          } else {
            parent.children.push(unwrappedContent);
          }
          break;
        default:
          // For all other node types, we can just append them directly without any special handling.
          parent.children.push(unwrappedContent);
          break;
      }

      return;
    } else if (isBundleInlineObject(unwrappedContent)) {
      parent.children.push(makeBundleInlineElementNode(
        unwrappedContent.bundleName,
        unwrappedContent.assetType,
      ));
      return
    }
  }

  // If all else fails, we'll stringify the value and insert it as a text node.
  appendContentToNode(parent, {
    type: YETI_NODE_TYPE.TEXT,
    content: String(unwrappedContent),
  });
};

/**
 * Parses an HTML string into a tree of YetiNodes. This is the main entry point for the HTML parsing logic.
 * The parser works by first lexing the input HTML string into a stream of tokens using the lexHTML function,
 * and then processing each token to build up the node tree.
 */
export const parseHTML = async (htmlStringChars: Uint8Array, dynamicValues: unknown[]): Promise<YetiRootNode> => {
  const rootNode: YetiRootNode = { type: YETI_NODE_TYPE.ROOT, children: [] };

  // Track all unique tagnames that are currently open in the tree.
  // This way, we can quickly determine if a closing tag matches any currently open tag
  // without having to traverse up the tree to check each open element node's tag name.
  const currentOpenTreeTagnameAndComponentCounts = new Map<string | Function, number>();
  let openParentStack: Array<YetiElementNode | OpenComponentNode> = [];
  const getCurrentOpenParent = () => {
    const stackLength = openParentStack.length;
    return stackLength > 0 ? openParentStack[stackLength - 1] : rootNode;
  };

  let openAttributeName: string | null = null;
  let openCommentNode: YetiCommentNode | null = null;
  let openDoctypeNode: YetiDoctypeNode | null = null;

  const finalizeOpenAttribute = () => {
    if (!openAttributeName) {
      return;
    }
    const currentParent = getCurrentOpenParent();
    if (currentParent.type === YETI_NODE_TYPE.ROOT) {
      //This state should be impossible to reach unless there is a serious bug in the lexer
      throw new YetiHTMLParsingError("Cannot finalize open attribute: Cannot set attributes on the root node");
    }

    if (!currentParent.attributes) {
      currentParent.attributes = {
        [openAttributeName]: true,
      };
    } else if (!(openAttributeName in currentParent.attributes)) {
      // If the open attribute name is not already in the current parent's attributes,
      // we will treat it as a boolean attribute with a value of true.
      currentParent.attributes[openAttributeName] = true;
    }

    openAttributeName = null;
  };

  /**
   * Closes the current open parent node and appends it to its parent's children array.
   * If the current open node is a component, we will render it and then append the returned contents to its parent.
   */
  const closeCurrentParent = async () => {
    const closingParentNode = openParentStack.pop();
    if (!closingParentNode) {
      // No open parent to close, we're already at the root node
      return null;
    }

    const nextParent = getCurrentOpenParent();

    if (closingParentNode.type === COMPONENT_NODE_TYPE) {
      const componentContent = closingParentNode.component({
        children: closingParentNode.children,
        ...closingParentNode.attributes,
      });
      await appendContentToNode(nextParent, componentContent);
      const currentInstanceCount = currentOpenTreeTagnameAndComponentCounts.get(closingParentNode.component) ?? 0;
      if (currentInstanceCount <= 1) {
        currentOpenTreeTagnameAndComponentCounts.delete(closingParentNode.component);
      } else {
        currentOpenTreeTagnameAndComponentCounts.set(closingParentNode.component, currentInstanceCount - 1);
      }
    } else {
      // For regular element nodes, we can just insert them directly.
      await appendContentToNode(nextParent, closingParentNode);
      const currentInstanceCount = currentOpenTreeTagnameAndComponentCounts.get(closingParentNode.tagName) ?? 0;
      if (currentInstanceCount <= 1) {
        currentOpenTreeTagnameAndComponentCounts.delete(closingParentNode.tagName);
      } else {
        currentOpenTreeTagnameAndComponentCounts.set(closingParentNode.tagName, currentInstanceCount - 1);
      }
    }

    return closingParentNode;
  };

  await lexHTML(htmlStringChars, dynamicValues, async (tokenType, tokenValue) => {
    switch (tokenType) {
      case TOKEN_TYPE.OPENING_TAGNAME: {
        if (typeof tokenValue === "string") {
          // Create a new element node and set it as the current parent
          const newElementNode: YetiElementNode = {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: tokenValue,
          };
          openParentStack.push(newElementNode);
          const currentInstanceCount = currentOpenTreeTagnameAndComponentCounts.get(tokenValue) ?? 0;
          currentOpenTreeTagnameAndComponentCounts.set(tokenValue, currentInstanceCount + 1);
        } else {
          // If the token value is a function, this is a component. We need to
          // gather the props and children for this component and then render it to get the actual nodes to insert.
          // For now, we'll just throw an error since we haven't implemented this yet.
          const newComponentNode: OpenComponentNode = {
            type: COMPONENT_NODE_TYPE,
            component: tokenValue,
          };
          openParentStack.push(newComponentNode);
          const currentInstanceCount = currentOpenTreeTagnameAndComponentCounts.get(tokenValue) ?? 0;
          currentOpenTreeTagnameAndComponentCounts.set(tokenValue, currentInstanceCount + 1);
        }
        break;
      }
      case TOKEN_TYPE.CLOSING_TAGNAME: {
        // Empty string = element closing tag shorthand (</>), this will close the current element or component regardless of tag name.
        // String = move up the tree until we find a matching tag name (or the root), then move up one more level to set the current parent.
        // Function = component closing tag, closes the open component with the matching function reference.
        // const tokenValue = tokens[i + 1] as LexerTokenValueTypeMap[typeof tokenType];

        if (tokenValue === "") {
          // Just move up one level to close the current element/component
          await closeCurrentParent();
        } else {
          if (!currentOpenTreeTagnameAndComponentCounts.has(tokenValue)) {
            // Ignore mismatched closing tags for tag names that aren't currently open in the tree.
            break;
          }

          // Move up the tree until we find a matching tag name or the root
          while (true) {
            const closedParentNode = await closeCurrentParent();
            if (
              !closedParentNode ||
              (closedParentNode.type === YETI_NODE_TYPE.ELEMENT && closedParentNode.tagName === tokenValue) ||
              (closedParentNode.type === COMPONENT_NODE_TYPE && closedParentNode.component === tokenValue)
            ) {
              break;
            }
          }
        }
        break;
      }
      case TOKEN_TYPE.OPENING_TAG_END: {
        const currentOpenParent = getCurrentOpenParent();

        if (currentOpenParent.type === YETI_NODE_TYPE.ROOT) {
          // This state shouldn't be possible unless there's a serious bug in the lexer throw an error
          throw new YetiHTMLParsingError("Received invalid OPENING_TAG_END token: Cannot self-close the root node");
        }

        // Finalize any open attribute before we close the tag
        finalizeOpenAttribute();

        // Token value is a boolean indicating whether the opening tag was terminated with a self-closing slash (/>) or not (>)
        const isSelfClosing = tokenValue === true;

        // If the tag was self-closing, or if it's a known void tag which cannot have any children, then we can immediately close it and move on.
        if (isSelfClosing || (currentOpenParent.type === YETI_NODE_TYPE.ELEMENT && isVoidTag(currentOpenParent.tagName))) {
          await closeCurrentParent();
        }
        break;
      }
      case TOKEN_TYPE.ATTR_NAME: {
        const currentParent = getCurrentOpenParent();

        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          // This state shouldn't be possible unless there's a serious bug in the lexer, throw an error
          throw new YetiHTMLParsingError("Received invalid ATTR_NAME token: Cannot set attributes on the root node");
        }

        // Finalize any previous open attribute before we start another one
        finalizeOpenAttribute();

        // The next token should be either an attribute value or an equals sign followed by an attribute value.
        // For simplicity, we'll assume that attributes are always in the form name="value" for now, and we'll handle the other cases later.
        openAttributeName = tokenValue;

        if (currentParent.attributes && openAttributeName in currentParent.attributes) {
          // Delete any previously existing attribute entry under this name
          // because this new one will overwrite it.
          delete currentParent.attributes[openAttributeName];
        }

        break;
      }
      case TOKEN_TYPE.ATTR_VALUE: {
        const currentParent = getCurrentOpenParent();

        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          // This state shouldn't be possible unless there's a serious bug in the lexer, throw an error
          throw new YetiHTMLParsingError("Received invalid ATTR_VALUE token: Cannot set attributes on the root node");
        }

        if (!openAttributeName) {
          // This state shouldn't be possible unless there's a serious bug in the lexer, throw an error
          throw new YetiHTMLParsingError("Received ATTR_VALUE token without an open attribute name");
        }

        if (!currentParent.attributes) {
          currentParent.attributes = {
            [openAttributeName]: tokenValue,
          };
        } else if (openAttributeName in currentParent.attributes) {
          const currentAttrValue = currentParent.attributes[openAttributeName];
          // Concatenate the new value with the existing value. ATTR_VALUE tokens can represent multiple parts of the
          // same attribute value if there is a mix of dynamic and static content
          currentParent.attributes[openAttributeName] = String(currentAttrValue) + String(tokenValue);
        } else {
          currentParent.attributes[openAttributeName] = tokenValue;
        }
        break;
      }
      case TOKEN_TYPE.CHILD_CONTENT: {
        await appendContentToNode(getCurrentOpenParent(), tokenValue);
        break;
      }
      case TOKEN_TYPE.COMMENT_PART: {
        if (openCommentNode) {
          openCommentNode.content += String(tokenValue);
        } else {
          openCommentNode = {
            type: YETI_NODE_TYPE.COMMENT,
            content: String(tokenValue),
          };
        }
        break;
      }
      case TOKEN_TYPE.COMMENT_END: {
        const currentParent = getCurrentOpenParent();
        if (openCommentNode) {
          // Trim whitespace from comment content
          openCommentNode.content = openCommentNode.content.trim();
          await appendContentToNode(currentParent, openCommentNode);
          openCommentNode = null;
        } else {
          await appendContentToNode(currentParent, {
            type: YETI_NODE_TYPE.COMMENT,
            // Empty comment with no content
            content: "",
          });
        }
        break;
      }
      case TOKEN_TYPE.DOCTYPE_PART: {
        if (openDoctypeNode) {
          openDoctypeNode.content += String(tokenValue);
        } else {
          openDoctypeNode = {
            type: YETI_NODE_TYPE.DOCTYPE,
            content: String(tokenValue),
          };
        }
        break;
      }
      case TOKEN_TYPE.DOCTYPE_END: {
        const currentParent = getCurrentOpenParent();
        if (openDoctypeNode) {
          // Trim leading and trailing whitespace from the doctype content
          openDoctypeNode.content = openDoctypeNode.content.trim();
          await appendContentToNode(currentParent, openDoctypeNode);
          openDoctypeNode = null;
        } else {
          await appendContentToNode(currentParent, {
            type: YETI_NODE_TYPE.DOCTYPE,
            // Empty doctype with no content
            content: "",
          });
        }
        break;
      }
      case TOKEN_TYPE.SPREAD_ATTR: {
        const currentParent = getCurrentOpenParent();
        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          // This state shouldn't be possible unless the lexer is broken, throw an error
          throw new YetiHTMLParsingError("Received invalid SPREAD_ATTR token: Cannot set attributes on the root node");
        }

        // Finalize any previous open attribute before we process the spread attribute
        finalizeOpenAttribute();

        if (tokenValue === null || tokenValue === undefined) {
          // Ignore null or undefined spread values
          break;
        }

        if (typeof tokenValue !== "object") {
          // Primitive values cannot be spread since they don't have any properties to spread. Throw an error to alert the developer that their input is invalid.
          throw new YetiHTMLParsingError(`Received invalid non-object value to spread operator in HTML: ${typeof tokenValue === "string" ? `"${tokenValue}"` : String(tokenValue)}`);
        }

        currentParent.attributes ??= {};
        // Apply all of the attributes from the spread object to the current element's attributes.
        // If there are any overlapping attribute names, the spread attributes will overwrite the existing ones.
        Object.assign(currentParent.attributes, tokenValue);
        break;
      }
      case TOKEN_TYPE.ERROR: {
        throw tokenValue;
      }
    }
  });

  while (await closeCurrentParent() !== null) {
    // Keep closing any open nodes until we reach the root. This will ensure that all nodes are properly closed and appended to the tree, 
    // even if there are unclosed tags in the input HTML.
  }

  return rootNode;
}