import { YETI_NODE_TYPE } from "./types.ts";
import type { YetiRootNode, YetiElementNode, YetiChildNode } from "./types.ts";

/**
 * Returns a dedup key for a head element, or null if the element should always be appended.
 *
 * Dedup rules:
 * - `<title>` → "title" (last wins)
 * - `<meta>` → "meta:{name|property|http-equiv}" (last wins)
 * - `<link>` → "link:{rel}:{href}" (last wins)
 * - `<script src="...">` → "script:{src}" (last wins)
 * - Everything else → null (always appended)
 */
const getHeadElementDedupKey = (node: YetiElementNode): string | null => {
  const attrs = node.attributes;
  switch (node.tagName) {
    case "title":
      return "title";
    case "meta": {
      const identifier = attrs?.name ?? attrs?.property ?? attrs?.["http-equiv"];
      return identifier ? `meta:${identifier}` : null;
    }
    case "link": {
      const rel = attrs?.rel;
      const href = attrs?.href;
      return (rel && href) ? `link:${rel}:${href}` : null;
    }
    case "script": {
      const src = attrs?.src;
      return src ? `script:${src}` : null;
    }
    default:
      return null;
  }
};

/**
 * Finds the first `<head>` element in the tree via depth-first search.
 */
const findHeadElement = (node: YetiRootNode | YetiElementNode): YetiElementNode | null => {
  const children = node.children;
  if (!children) {
    return null;
  }

  for (const child of children) {
    if (child.type === YETI_NODE_TYPE.ELEMENT) {
      if (child.tagName === "head") {
        return child;
      }
      const found = findHeadElement(child);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

/**
 * Finds the `<html>` element in the tree, or returns null.
 */
const findHtmlElement = (node: YetiRootNode): YetiElementNode | null => {
  for (const child of node.children) {
    if (child.type === YETI_NODE_TYPE.ELEMENT && child.tagName === "html") {
      return child;
    }
  }
  return null;
};

/**
 * Merges collected Head component children into the document's `<head>` element.
 *
 * If no `<head>` element exists in the tree, one is created and inserted:
 * - Into `<html>` as the first child if it exists
 * - Otherwise as the first element child of the root
 *
 * For dedup-able elements (title, meta, link, script with src), later entries
 * replace earlier ones. All other elements are appended.
 */
export const mergeHeadContent = (rootNode: YetiRootNode): void => {
  const headChildren = rootNode.assets?.head;
  if (!headChildren || headChildren.length === 0) {
    return;
  }

  let headElement = findHeadElement(rootNode);

  if (!headElement) {
    // Create a <head> element and insert it into the tree
    headElement = {
      type: YETI_NODE_TYPE.ELEMENT,
      tagName: "head",
      children: [],
    };

    const htmlElement = findHtmlElement(rootNode);
    if (htmlElement) {
      htmlElement.children ??= [];
      // Insert <head> as the first child of <html>
      htmlElement.children.unshift(headElement);
    } else {
      // Insert <head> as the first element child of the root
      rootNode.children.unshift(headElement);
    }
  }

  headElement.children ??= [];

  // Build a map of existing dedup keys to their index in headElement.children
  const existingKeyIndices = new Map<string, number>();
  for (let i = 0; i < headElement.children.length; i++) {
    const child = headElement.children[i];
    if (child.type === YETI_NODE_TYPE.ELEMENT) {
      const key = getHeadElementDedupKey(child);
      if (key) {
        existingKeyIndices.set(key, i);
      }
    }
  }

  for (const newChild of headChildren) {
    if (newChild.type === YETI_NODE_TYPE.ELEMENT) {
      const key = getHeadElementDedupKey(newChild);
      if (key) {
        const existingIndex = existingKeyIndices.get(key);
        if (existingIndex !== undefined) {
          // Replace the existing element in place
          headElement.children[existingIndex] = newChild;
        } else {
          // Append and track the new index
          existingKeyIndices.set(key, headElement.children.length);
          headElement.children.push(newChild);
        }
        continue;
      }
    }
    // No dedup key — always append
    headElement.children.push(newChild);
  }
};
