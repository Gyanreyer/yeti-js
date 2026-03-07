import { Lexer } from "marked";
import type { Token, MarkedToken } from "marked";
import { parseHTML } from "../../html/parseHTML.ts";
import { textEncoder } from "../../utils/textEncoder.ts";
import { YETI_NODE_TYPE } from "../../html/types.ts";
import type { YetiRootNode, YetiChildNode, YetiTextNode, YetiElementNode } from "../../html/types.ts";

const el = (
  tagName: string,
  children?: YetiChildNode[],
  attributes?: Record<string, unknown>
): YetiElementNode => ({
  type: YETI_NODE_TYPE.ELEMENT,
  tagName,
  ...(children?.length ? { children } : {}),
  ...(attributes ? { attributes } : {}),
});

const textNode = (content: string): YetiTextNode => ({
  type: YETI_NODE_TYPE.TEXT,
  content,
});

async function parseHTMLFragment(html: string): Promise<YetiChildNode[]> {
  const result = await parseHTML(textEncoder.encode(html));
  return result.children;
}

async function processTokens(tokens: Token[]): Promise<YetiChildNode[]> {
  const children: YetiChildNode[] = [];

  for (const token of tokens as MarkedToken[]) {
    switch (token.type) {
      case "space":
        break;
      case "heading": {
        children.push(el(`h${token.depth}`, await processTokens(token.tokens)));
        break;
      }
      case "paragraph":
        children.push(el("p", await processTokens(token.tokens)));
        break;
      case "blockquote":
        children.push(el("blockquote", await processTokens(token.tokens)));
        break;
      case "code": {
        const codeAttrs = token.lang ? { "data-lang": token.lang, class: `language-${token.lang}` } : undefined;
        children.push(el("pre", [el("code", [textNode(token.text)], codeAttrs)]));
        break;
      }
      case "hr":
        children.push(el("hr"));
        break;
      case "list": {
        const listTag = token.ordered ? "ol" : "ul";
        const listAttrs: Record<string, unknown> | undefined =
          token.ordered && typeof token.start === "number" && token.start !== 1
            ? { start: token.start }
            : undefined;
        children.push(el(listTag, await processTokens(token.items), listAttrs));
        break;
      }
      case "list_item": {
        const liChildren = await processTokens(token.tokens);
        if (token.task) {
          const checkboxAttrs: Record<string, unknown> = { type: "checkbox", disabled: true };
          if (token.checked) {
            checkboxAttrs.checked = true;
          }
          liChildren.unshift(el("input", undefined, checkboxAttrs));
        }
        children.push(el("li", liChildren));
        break;
      }
      case "table": {
        const headerCells = await Promise.all(
          token.header.map(async (cell) => el("th", await processTokens(cell.tokens)))
        );
        const bodyRows = await Promise.all(
          token.rows.map(async (row) => {
            const cells = await Promise.all(
              row.map(async (cell) => el("td", await processTokens(cell.tokens)))
            );
            return el("tr", cells);
          })
        );
        children.push(el("table", [
          el("thead", [el("tr", headerCells)]),
          el("tbody", bodyRows),
        ]));
        break;
      }
      case "def":
        break;
      case "escape":
        children.push(textNode(token.text));
        break;
      case "strong":
        children.push(el("strong", await processTokens(token.tokens)));
        break;
      case "em":
        children.push(el("em", await processTokens(token.tokens)));
        break;
      case "del":
        children.push(el("del", await processTokens(token.tokens)));
        break;
      case "codespan":
        children.push(el("code", [textNode(token.text)]));
        break;
      case "link": {
        const attrs: Record<string, unknown> = { href: token.href };
        if (token.title) {
          attrs.title = token.title;
        }
        children.push(el("a", await processTokens(token.tokens), attrs));
        break;
      }
      case "image": {
        const attrs: Record<string, unknown> = { src: token.href, alt: token.text };
        if (token.title) {
          attrs.title = token.title;
        }
        children.push(el("img", undefined, attrs));
        break;
      }
      case "br":
        children.push(el("br"));
        break;
      case "html":
        children.push(...await parseHTMLFragment(token.text));
        break;
      case "text": {
        if (token.tokens?.length) {
          children.push(...await processTokens(token.tokens));
        } else {
          children.push(textNode(token.text));
        }
        break;
      }
    }
  }

  return children;
}

export const parseMarkdown = async (markdown: string): Promise<YetiRootNode> => {
  const tokens = Lexer.lex(markdown);
  return {
    type: YETI_NODE_TYPE.ROOT,
    children: await processTokens(tokens),
  };
};
