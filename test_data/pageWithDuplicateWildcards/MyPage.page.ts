import { html } from "../../src/html/html.ts";
import { css } from "../../src/css/css.ts";
import { js } from "../../src/js/js.ts";

import { Layout } from "./Layout.component.ts";

export default function MyPage() {
  return html`<${Layout}>
    <main></main>
  </${Layout}>`;
}

MyPage.css = css`
  body { background: blue; }

  ${css.bundle("critical")}
  :root {
    --color: red;
  }
`;

MyPage.js = js`
  console.log("hello");
`;
