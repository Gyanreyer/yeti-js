import { html } from "../../src/html/html.ts";
import { js } from "../../src/js/js.ts";
import { css } from "../../src/css/css.ts";

export function FancyComponent() {
  return html`<fancy-component></fancy-component>`;
}

FancyComponent.js = js`
  ${js.import("./fancy-component.js")}
  ${js.import("./say-hello.ts", "critical")}

  console.log("Hello from FancyComponent!");
`;

FancyComponent.css = css`
  fancy-component:not(:defined) {
    display: none;
  }
`;