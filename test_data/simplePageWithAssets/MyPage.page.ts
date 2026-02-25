import { html } from "../../src/html/html.ts";

import { Layout } from "./Layout.component.ts";

import { Heading } from "./Heading.component.ts";
import { FancyComponent } from "./FancyComponent.component.ts";

export default function MyPage() {
  return html`<${Layout}>
    <main>
      <${Heading}>My Page</${Heading}>
      <${FancyComponent} />
    </main>
  </${Layout}>`;
}