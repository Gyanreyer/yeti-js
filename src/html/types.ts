export const YETI_NODE_TYPE = {
  ELEMENT: 0,
  TEXT: 4,
  COMMENT: 8,
  DOCTYPE: 12,
} as const;

export type YetiNodeType = typeof YETI_NODE_TYPE[keyof typeof YETI_NODE_TYPE];

export interface BaseYetiNode {
  type: YetiNodeType;
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
  attributes: Record<string, string>;
  children: Array<YetiElementNode | YetiTextNode | YetiCommentNode | YetiDoctypeNode>;
}

export type YetiNode = YetiElementNode | YetiTextNode | YetiCommentNode | YetiDoctypeNode;
