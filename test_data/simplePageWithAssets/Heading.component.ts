import { css } from "../../src/css/css.ts";
import { html } from "../../src/html/html.ts";
import type { YetiChildNode } from "../../src/html/types.ts";

export function Heading({
  children,
}: {
  children: YetiChildNode[];
}) {
  return html`<header>
  <h1>${children}</h1>
</header>`;
}

Heading.css = css`
  ${css.import("./Heading.component.css")}

  ${css.bundle("critical")}
  h1 {
    font-size: 5rem;
    font-family: sans-serif;
  }

  ${css.bundle(css.getDefaultBundleName())}
  header {
    background-color: red;
  }
  h1 {
    color: yellow;
  }
`;
