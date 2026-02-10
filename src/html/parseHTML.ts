import { lexHTML, TOKEN_TYPE } from "./lexHTML.ts";
import { YETI_NODE_TYPE, parentNode } from "./types.ts";
import type { YetiNode, YetiRootNode, YetiElementNode } from "./types.ts";
import { YetiHTMLParsingError } from "./error.ts";
import { isVoidTag } from "./utils.ts";

// Node type to identify a component node
const COMPONENT_NODE_TYPE = 1000;

// A node representing a parsed component. This will be rendered into actual YetiNodes before being inserted into the tree.
// We need to keep track of the component function reference and its props so that we can render it later.
type OpenComponentNode = {
  type: typeof COMPONENT_NODE_TYPE;
  component: Function;
  attributes: Record<string, unknown>;
  children: YetiNode[];
  [parentNode]: YetiRootNode | YetiElementNode | OpenComponentNode | OpenElementNode;
};

// A node representing an open element tag that has not been closed yet.
// We need to keep track of the parent node so that we can move back up the tree when we encounter a closing tag.
type OpenElementNode = Omit<YetiElementNode, typeof parentNode> & {
  [parentNode]: YetiRootNode | YetiElementNode | OpenComponentNode | OpenElementNode;
};

/**
 * 
 * @param htmlString 
 * @param dynamicValues 
 * @returns 
 */
export const parseHTML = async (htmlString: string, dynamicValues: unknown[]): Promise<YetiRootNode> => {
  const rootNode: YetiRootNode = { type: YETI_NODE_TYPE.ROOT, children: [] };
  let currentParent: YetiRootNode | YetiElementNode | OpenComponentNode | OpenElementNode = rootNode;

  let openAttributeName: string | null = null;

  for (const [tokenType, tokenValue] of lexHTML(htmlString, dynamicValues)) {
    switch (tokenType) {
      case TOKEN_TYPE.OPENING_TAGNAME: {
        if (typeof tokenValue === "string") {
          // Create a new element node and set it as the current parent
          const newElementNode: OpenElementNode = {
            type: YETI_NODE_TYPE.ELEMENT,
            tagName: tokenValue,
            attributes: {},
            children: [],
            [parentNode]: currentParent,
          };
          currentParent = newElementNode;
        } else {
          // If the token value is a function, this is a component. We need to
          // gather the props and children for this component and then render it to get the actual nodes to insert.
          // For now, we'll just throw an error since we haven't implemented this yet.
          const newComponentNode: OpenComponentNode = {
            type: COMPONENT_NODE_TYPE,
            component: tokenValue,
            attributes: {},
            children: [],
            [parentNode]: currentParent,
          };
          currentParent = newComponentNode;
        }
        break;
      }
      case TOKEN_TYPE.CLOSING_TAGNAME: {
        // Empty string = element closing tag shorthand (</>), this will close the current element or component regardless of tag name.
        // String = move up the tree until we find a matching tag name (or the root), then move up one more level to set the current parent.
        // Function = component closing tag, closes the open component with the matching function reference.

        const closeCurrentParent = () => {
          if (currentParent.type === YETI_NODE_TYPE.ROOT) {
            // Cannot close the root node
            return null;
          }

          const closingParentNode = currentParent;
          const nextParent = currentParent[parentNode];

          if (closingParentNode.type === COMPONENT_NODE_TYPE) {
            const componentContent = closingParentNode.component({
              children: closingParentNode.children,
              ...closingParentNode.attributes,
            });
            if ("type" in componentContent && componentContent.type === YETI_NODE_TYPE.ROOT && Array.isArray(componentContent.children)) {
              // If the component content is a root node, we can just take its children and insert them directly.
              for (const child of componentContent.children) {
                nextParent.children.push({
                  ...child,
                  [parentNode]: nextParent as YetiRootNode | YetiElementNode,
                });
              }
            } else if (Array.isArray(componentContent)) {
              // If the component content is an array, we can assume it's an array of nodes and insert them directly.
              for (const child of componentContent) {
                if ("type" in child && "children" in child) {
                  nextParent.children.push({
                    ...child,
                    [parentNode]: nextParent as YetiRootNode | YetiElementNode,
                  });
                } else {
                  // If the child is not a node, we will stringify it and insert it as a text node.
                  nextParent.children.push({
                    type: YETI_NODE_TYPE.TEXT,
                    content: String(child),
                    [parentNode]: nextParent as YetiRootNode | YetiElementNode,
                  });
                }
              }
            } else {
              // Otherwise, we assume it's a single node and insert it directly.
              nextParent.children.push({
                type: YETI_NODE_TYPE.TEXT,
                content: String(componentContent),
                [parentNode]: nextParent as YetiRootNode | YetiElementNode,
              });
            }
          } else {
            // For regular element nodes, we can just insert them directly.
            nextParent.children.push({
              ...closingParentNode,
              [parentNode]: nextParent as YetiRootNode | YetiElementNode,
            });
          }

          currentParent = nextParent;

          return closingParentNode;
        };

        if (tokenValue === "") {
          // Just move up one level to close the current element/component
          closeCurrentParent();
        } else {
          // Move up the tree until we find a matching tag name or the root
          while (true) {
            const closedParentNode = closeCurrentParent();
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
        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          throw new YetiHTMLParsingError("Received invalid OPENING_TAG_END token: Cannot self-close the root node");
        }

        if (openAttributeName) {
          currentParent.attributes[openAttributeName] = true;
          openAttributeName = null;
        }

        const isSelfClosing = tokenValue === true;

        // If the tag was self-closing, or if it's a known void tag which cannot have any children, then we can immediately add it to the tree and move on.
        if (isSelfClosing || (currentParent.type === YETI_NODE_TYPE.ELEMENT && isVoidTag(currentParent.tagName))) {
          const closingParentNode = currentParent;
          const nextParent = currentParent[parentNode] as YetiRootNode | YetiElementNode;
          if (closingParentNode.type === COMPONENT_NODE_TYPE) {
            const componentContent = closingParentNode.component({
              children: [],
              ...closingParentNode.attributes,
            });
            if ("type" in componentContent && componentContent.type === YETI_NODE_TYPE.ROOT && Array.isArray(componentContent.children)) {
              // If the component content is a root node, we can just take its children and insert them directly.
              for (const child of componentContent.children) {
                closingParentNode.children.push({
                  ...child,
                  [parentNode]: nextParent as YetiRootNode | YetiElementNode,
                });
              }
            } else if (Array.isArray(componentContent)) {
              // If the component content is an array, we can assume it's an array of nodes and insert them directly.
              for (const child of componentContent) {
                if ("type" in child && "children" in child) {
                  closingParentNode.children.push({
                    ...child,
                    [parentNode]: nextParent as YetiRootNode | YetiElementNode,
                  });
                } else {
                  // If the child is not a node, we will stringify it and insert it as a text node.
                  closingParentNode.children.push({
                    type: YETI_NODE_TYPE.TEXT,
                    content: String(child),
                    [parentNode]: nextParent as YetiRootNode | YetiElementNode,
                  });
                }
              }
            } else {
              // Otherwise, we assume it's a single node and insert it directly.
              closingParentNode.children.push({
                type: YETI_NODE_TYPE.TEXT,
                content: String(componentContent),
                [parentNode]: nextParent as YetiRootNode | YetiElementNode,
              });
            }
          } else {
            // For regular element nodes, we can just insert them directly.
            nextParent.children.push({
              ...closingParentNode,
              [parentNode]: nextParent as YetiRootNode | YetiElementNode,
            });
          }
          currentParent = nextParent;
        }
        break;
      }
      case TOKEN_TYPE.ATTR_NAME: {
        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          throw new YetiHTMLParsingError("Received invalid ATTR_NAME token: Cannot set attributes on the root node");
        }

        if (openAttributeName) {
          // If we already have an open attribute name, that means we received an attribute name without a value.
          // We will treat this as a boolean attribute with a value of true.
          currentParent.attributes[openAttributeName] = true;
          openAttributeName = null;
        }

        // The next token should be either an attribute value or an equals sign followed by an attribute value.
        // For simplicity, we'll assume that attributes are always in the form name="value" for now, and we'll handle the other cases later.
        openAttributeName = tokenValue;
        break;
      }
      case TOKEN_TYPE.ATTR_VALUE: {
        if (!openAttributeName) {
          throw new YetiHTMLParsingError("Received ATTR_VALUE token without an open attribute name");
        }
        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          throw new YetiHTMLParsingError("Received invalid ATTR_VALUE token: Cannot set attributes on the root node");
        }

        currentParent.attributes[openAttributeName] = tokenValue;
        openAttributeName = null;
        break;
      }
      case TOKEN_TYPE.CHILD_CONTENT: {
        // Unwrap the child content...
        // 1. If it's a promise, await it
        // 2. If it's a root node, insert its children directly
        // 3. If it's an iterable, iterate over its values and insert each item as a separate node. Handle both sync and async iterables.
        // 4. If it's a function, call it and insert the result (handle both sync and async functions)
        // 5. Otherwise, insert it as a text node
        let contentToInsert = tokenValue;
        if (typeof contentToInsert === "function") {
          try {
            contentToInsert = contentToInsert();
          } catch (error) {
            throw new YetiHTMLParsingError(`An error occurred while executing inlined function in HTML`, {
              cause: error,
            });
          }
        }
        if (contentToInsert instanceof Promise) {
          contentToInsert = await contentToInsert;
        }

        if (contentToInsert === null || contentToInsert === undefined || contentToInsert === "") {
          // If the content is null, undefined, or an empty string, we can just ignore it and not insert anything.
          break;
        }

        if (typeof contentToInsert === "object") {
          if ("type" in contentToInsert && "children" in contentToInsert && Array.isArray(contentToInsert.children)) {
            for (const child of contentToInsert.children) {
              currentParent.children.push({
                ...child,
                [parentNode]: currentParent as YetiRootNode | YetiElementNode,
              });
            }
          } else if (Symbol.iterator in contentToInsert && typeof contentToInsert[Symbol.iterator] === "function") {
            const generator = (contentToInsert as any)[Symbol.iterator]() as Generator;
            for (const item of generator) {
              if (item === null || item === undefined || item === "") {
                continue;
              }

              if (typeof item === "object" && "type" in item && "children" in item && Array.isArray(item.children)) {
                for (const child of item.children) {
                  currentParent.children.push({
                    ...child,
                    [parentNode]: currentParent as YetiRootNode | YetiElementNode,
                  });
                }
              } else {
                currentParent.children.push({
                  type: YETI_NODE_TYPE.TEXT,
                  content: String(item),
                  [parentNode]: currentParent as YetiRootNode | YetiElementNode,
                });
              }
            }
          } else if (Symbol.asyncIterator in contentToInsert && typeof contentToInsert[Symbol.asyncIterator] === "function") {
            const asyncGenerator = (contentToInsert as any)[Symbol.asyncIterator]() as AsyncGenerator;
            for await (const item of asyncGenerator) {
              if (item === null || item === undefined || item === "") {
                continue;
              }

              if (typeof item === "object" && "type" in item && "children" in item && Array.isArray(item.children)) {
                for (const child of item.children) {
                  currentParent.children.push({
                    ...child,
                    [parentNode]: currentParent as YetiRootNode | YetiElementNode,
                  });
                }
              } else {
                currentParent.children.push({
                  type: YETI_NODE_TYPE.TEXT,
                  content: String(item),
                  [parentNode]: currentParent as YetiRootNode | YetiElementNode,
                });
              }
            }
          } else {
            // If it's just a regular object, we'll stringify it and insert it as a text node.
            currentParent.children.push({
              type: YETI_NODE_TYPE.TEXT,
              content: String(contentToInsert),
              [parentNode]: currentParent as YetiRootNode | YetiElementNode,
            });
          }
        } else {
          // For any other type of content, we will stringify it and insert it as a text node.
          currentParent.children.push({
            type: YETI_NODE_TYPE.TEXT,
            content: String(contentToInsert),
            [parentNode]: currentParent as YetiRootNode | YetiElementNode,
          });
        }

        break;
      }
      case TOKEN_TYPE.COMMENT: {
        currentParent.children.push({
          type: YETI_NODE_TYPE.COMMENT,
          content: tokenValue,
          [parentNode]: currentParent as YetiRootNode | YetiElementNode,
        });
        break;
      }
      case TOKEN_TYPE.DOCTYPE: {
        currentParent.children.push({
          type: YETI_NODE_TYPE.DOCTYPE,
          content: tokenValue,
          [parentNode]: currentParent as YetiRootNode | YetiElementNode,
        });
        break;
      }
      case TOKEN_TYPE.SPREAD_ATTR: {
        if (currentParent.type === YETI_NODE_TYPE.ROOT) {
          throw new YetiHTMLParsingError("Received invalid SPREAD_ATTR token: Cannot set attributes on the root node");
        }
        if (typeof tokenValue !== "object" || tokenValue === null) {
          throw new YetiHTMLParsingError("Received invalid SPREAD_ATTR token: Token value must be a non-null object");
        }

        // Apply all of the attributes from the spread object to the current element's attributes.
        // If there are any overlapping attribute names, the spread attributes will overwrite the existing ones.
        Object.assign(currentParent.attributes, tokenValue);
        break;
      }
      case TOKEN_TYPE.ERROR: {
        throw tokenValue;
      }
    }
  }

  while (currentParent.type !== YETI_NODE_TYPE.ROOT) {
    const closingParentNode = currentParent;
    const nextParent = currentParent[parentNode] as YetiRootNode | YetiElementNode;
    if (closingParentNode.type === COMPONENT_NODE_TYPE) {
      const componentContent = closingParentNode.component({
        children: closingParentNode.children,
        ...closingParentNode.attributes,
      });
      if ("type" in componentContent && componentContent.type === YETI_NODE_TYPE.ROOT && Array.isArray(componentContent.children)) {
        // If the component content is a root node, we can just take its children and insert them directly.
        for (const child of componentContent.children) {
          closingParentNode.children.push({
            ...child,
            [parentNode]: nextParent as YetiRootNode | YetiElementNode,
          });
        }
      } else if (Array.isArray(componentContent)) {
        // If the component content is an array, we can assume it's an array of nodes and insert them directly.
        for (const child of componentContent) {
          if ("type" in child && "children" in child) {
            closingParentNode.children.push({
              ...child,
              [parentNode]: nextParent as YetiRootNode | YetiElementNode,
            });
          } else {
            // If the child is not a node, we will stringify it and insert it as a text node.
            closingParentNode.children.push({
              type: YETI_NODE_TYPE.TEXT,
              content: String(child),
              [parentNode]: nextParent as YetiRootNode | YetiElementNode,
            });
          }
        }
      } else {
        // Otherwise, we assume it's a single node and insert it directly.
        closingParentNode.children.push({
          type: YETI_NODE_TYPE.TEXT,
          content: String(componentContent),
          [parentNode]: nextParent as YetiRootNode | YetiElementNode,
        });
      }
    } else {
      // For regular element nodes, we can just insert them directly.
      nextParent.children.push({
        ...closingParentNode,
        [parentNode]: nextParent as YetiRootNode | YetiElementNode,
      });
    }

    currentParent = nextParent;
  }

  return rootNode;
}