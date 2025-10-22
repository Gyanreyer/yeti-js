import { defaultTreeAdapter } from 'parse5';

/**
 * @import { DefaultTreeAdapterTypes as Parse5Types } from 'parse5';
 */

/**
 * @param {Parse5Types.Node} node
 * @returns {node is Parse5Types.Document}
 */
export const isDocumentNode = (node) => node.nodeName === "#document";

/**
 * @param {Parse5Types.Document | Parse5Types.Element} node
 * @param {((elementNode: Parse5Types.Element) => boolean)} callback
 *
 * @returns {Parse5Types.Element | null}
 */
export const queryElement = (node, callback) => {
  if (!isDocumentNode(node) && callback(node)) {
    return node;
  }

  for (const childNode of node.childNodes) {
    if (defaultTreeAdapter.isElementNode(childNode)) {
      const result = queryElement(childNode, callback);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

export const TRANSFORM_ACTIONS =
/** @type {const} */({
    REMOVE: "REMOVE",
    REPLACE: "REPLACE",
    SKIP_CHILDREN: "SKIP_CHILDREN",
    CONTINUE: "CONTINUE",
  });

/**
 * @typedef {(typeof TRANSFORM_ACTIONS)["REMOVE"] | (typeof TRANSFORM_ACTIONS)["CONTINUE"] | (typeof TRANSFORM_ACTIONS)["SKIP_CHILDREN"] | [(typeof TRANSFORM_ACTIONS)["REPLACE"], ...Parse5Types.ChildNode[]]} TransformResult
 */

/**
 * @param {Parse5Types.Node} node
 * @param {(node: Parse5Types.Node) => TransformResult | Promise<TransformResult>} transformer
 */
export const transformDocumentNodes = async (node, transformer) => {
  const result = await transformer(node);
  if (result === TRANSFORM_ACTIONS.SKIP_CHILDREN) {
    return TRANSFORM_ACTIONS.CONTINUE;
  } else if (result !== TRANSFORM_ACTIONS.CONTINUE) {
    return result;
  }

  if (isDocumentNode(node) || defaultTreeAdapter.isElementNode(node)) {
    let childNodeCount = node.childNodes.length;
    for (let i = 0; i < childNodeCount; ++i) {
      const childNode = node.childNodes[i];
      const childResult = await transformDocumentNodes(childNode, transformer);
      if (childResult === TRANSFORM_ACTIONS.REMOVE) {
        node.childNodes.splice(i, 1);
        childNode.parentNode = null;
        --i;
        --childNodeCount;
      } else if (Array.isArray(childResult) && childResult[0] === TRANSFORM_ACTIONS.REPLACE) {
        const [, ...newChildNodes] = childResult;
        node.childNodes.splice(i, 1, ...newChildNodes);
        for (const newChildNode of newChildNodes) {
          newChildNode.parentNode = node;
        }
        i += newChildNodes.length - 1;
        childNodeCount += newChildNodes.length - 1;
        // Disconnect the replaced node from the tree
        childNode.parentNode = null;
      }
    }
  }

  return TRANSFORM_ACTIONS.CONTINUE;
};