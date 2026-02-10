export const YETI_NODE_TYPE = {
  ROOT: 0,
  ELEMENT: 2,
  TEXT: 4,
  COMMENT: 8,
  DOCTYPE: 12,
} as const;

export const parentNode = Symbol.for("parentNode");

export type YetiNodeType = typeof YETI_NODE_TYPE[keyof typeof YETI_NODE_TYPE];

export interface BaseYetiNode {
  type: YetiNodeType;
  [parentNode]: YetiElementNode | YetiRootNode;
}

export interface YetiRootNode extends Omit<BaseYetiNode, typeof parentNode> {
  type: typeof YETI_NODE_TYPE.ROOT;
  children: Array<Exclude<YetiNode, YetiRootNode>>;
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
  attributes: Record<string, string | boolean>;
  children: Array<Exclude<YetiNode, YetiRootNode>>;
}

export type YetiNode = YetiElementNode | YetiTextNode | YetiCommentNode | YetiDoctypeNode | YetiRootNode;
