import { html } from "../../src/html/html.ts";

import { Layout } from "./Layout.component.ts";

export default function MyPage() {
  return html`<${Layout}>
    <main></main>
  </${Layout}>`;
}