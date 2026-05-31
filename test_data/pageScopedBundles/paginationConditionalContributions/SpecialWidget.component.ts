import { css, html, js, type YetiComponent } from "../../../src/index.ts";

// Rendered on only one pagination variant of the template. Its page-scoped (`@page`) CSS/JS and
// its contribution to the shared "global" JS bundle must still make it into the merged bundles
// for the template — even though the other variants don't render it.
export const SpecialWidget: YetiComponent = () => html`<div class="special-widget-css-marker">special</div>`;

SpecialWidget.css = css`
  .special-widget-css-marker {
    color: #123456;
  }
`;

SpecialWidget.js = js`
  console.log("special-widget-page-js-marker");

  ${js.bundle("global")}
  console.log("special-widget-global-js-marker");
`;
