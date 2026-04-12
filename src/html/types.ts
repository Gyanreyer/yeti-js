import type { BundleContribution } from "../bundle/bundle.ts";

// Using symbols for node types to ensure uniqueness and prevent potential conflicts with user-defined content
// We have to declare them outside of the YETI_NODE_TYPE object because otherwise they
// were just getting typed as generic symbols instead of unique symbol values
const ROOT_SYMBOL = Symbol("ROOT");
const ELEMENT_SYMBOL = Symbol("ELEMENT");
const TEXT_SYMBOL = Symbol("TEXT");
const COMMENT_SYMBOL = Symbol("COMMENT");
const DOCTYPE_SYMBOL = Symbol("DOCTYPE");

export const YETI_NODE_TYPE = {
  ROOT: ROOT_SYMBOL,
  ELEMENT: ELEMENT_SYMBOL,
  TEXT: TEXT_SYMBOL,
  COMMENT: COMMENT_SYMBOL,
  DOCTYPE: DOCTYPE_SYMBOL,
} as const;

export type YetiNodeType = typeof YETI_NODE_TYPE[keyof typeof YETI_NODE_TYPE];

export interface BaseYetiNode {
  type: YetiNodeType;
}

export interface DocumentBundleAssets {
  css?: Map<string, Set<BundleContribution>>;
  js?: Map<string, Set<BundleContribution>>;
  html?: {
    bundleImportPaths?: Map<string, Set<string>>;
    dependencies?: Set<string>;
  };
  /**
   * Collected children from Head components, in document order.
   * Merged into the page's `<head>` element during page processing.
   */
  head?: YetiChildNode[];
}

export interface YetiRootNode extends BaseYetiNode {
  type: typeof YETI_NODE_TYPE.ROOT;
  children: YetiChildNode[];
  assets?: DocumentBundleAssets;
}

export interface YetiTextNode extends BaseYetiNode {
  type: typeof YETI_NODE_TYPE.TEXT;
  content: string;
}

export interface YetiCommentNode extends BaseYetiNode {
  type: typeof YETI_NODE_TYPE.COMMENT;
  content: string;
}

export interface YetiDoctypeNode extends BaseYetiNode {
  type: typeof YETI_NODE_TYPE.DOCTYPE;
  content: string;
}

export interface YetiElementNode extends BaseYetiNode {
  type: typeof YETI_NODE_TYPE.ELEMENT;
  tagName: string;
  attributes?: Record<string, unknown>;
  children?: YetiChildNode[];
}

export type YetiChildNode = YetiElementNode | YetiTextNode | YetiCommentNode | YetiDoctypeNode;
export type YetiNode = YetiChildNode | YetiRootNode;
