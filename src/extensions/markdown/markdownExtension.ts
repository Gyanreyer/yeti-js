import { Lexer } from "marked";
import type { Token, Tokens } from "marked";
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

async function processInlineTokens(tokens: Token[]): Promise<YetiChildNode[]> {
  const children: YetiChildNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "escape":
        children.push(textNode((token as Tokens.Escape).text));
        break;
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          children.push(...await processInlineTokens(t.tokens));
        } else {
          children.push(textNode(t.text));
        }
        break;
      }
      case "strong":
        children.push(el("strong", await processInlineTokens((token as Tokens.Strong).tokens)));
        break;
      case "em":
        children.push(el("em", await processInlineTokens((token as Tokens.Em).tokens)));
        break;
      case "del":
        children.push(el("del", await processInlineTokens((token as Tokens.Del).tokens)));
        break;
      case "codespan":
        children.push(el("code", [textNode((token as Tokens.Codespan).text)]));
        break;
      case "link": {
        const t = token as Tokens.Link;
        const attrs: Record<string, unknown> = { href: t.href };
        if (t.title) attrs.title = t.title;
        children.push(el("a", await processInlineTokens(t.tokens), attrs));
        break;
      }
      case "image": {
        const t = token as Tokens.Image;
        const attrs: Record<string, unknown> = { src: t.href, alt: t.text };
        if (t.title) attrs.title = t.title;
        children.push(el("img", undefined, attrs));
        break;
      }
      case "br":
        children.push(el("br"));
        break;
      case "html":
        children.push(...await parseHTMLFragment((token as Tokens.Tag).text));
        break;
    }
  }

  return children;
}

async function processBlockTokens(tokens: Token[]): Promise<YetiChildNode[]> {
  const children: YetiChildNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "heading": {
        const t = token as Tokens.Heading;
        children.push(el(`h${t.depth}`, await processInlineTokens(t.tokens)));
        break;
      }
      case "paragraph":
        children.push(el("p", await processInlineTokens((token as Tokens.Paragraph).tokens)));
        break;
      case "blockquote":
        children.push(el("blockquote", await processBlockTokens((token as Tokens.Blockquote).tokens)));
        break;
      case "code": {
        const t = token as Tokens.Code;
        const codeAttrs = t.lang ? { class: `language-${t.lang}` } : undefined;
        children.push(el("pre", [el("code", [textNode(t.text)], codeAttrs)]));
        break;
      }
      case "hr":
        children.push(el("hr"));
        break;
      case "list": {
        const t = token as Tokens.List;
        const listTag = t.ordered ? "ol" : "ul";
        const listAttrs: Record<string, unknown> | undefined =
          t.ordered && typeof t.start === "number" && t.start !== 1
            ? { start: t.start }
            : undefined;
        const items: YetiChildNode[] = [];
        for (const item of t.items) {
          const liChildren = await processBlockTokens(item.tokens);
          if (item.task) {
            const checkboxAttrs: Record<string, unknown> = { type: "checkbox", disabled: true };
            if (item.checked) checkboxAttrs.checked = true;
            liChildren.unshift(el("input", undefined, checkboxAttrs));
          }
          items.push(el("li", liChildren));
        }
        children.push(el(listTag, items, listAttrs));
        break;
      }
      case "table": {
        const t = token as Tokens.Table;
        const headerCells = await Promise.all(
          t.header.map(async (cell) => el("th", await processInlineTokens(cell.tokens)))
        );
        const bodyRows = await Promise.all(
          t.rows.map(async (row) => {
            const cells = await Promise.all(
              row.map(async (cell) => el("td", await processInlineTokens(cell.tokens)))
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
      case "html":
        children.push(...await parseHTMLFragment((token as Tokens.HTML).text));
        break;
      case "def":
        break;
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          children.push(...await processInlineTokens(t.tokens));
        } else {
          children.push(textNode(t.text));
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
    children: await processBlockTokens(tokens),
  };
};
