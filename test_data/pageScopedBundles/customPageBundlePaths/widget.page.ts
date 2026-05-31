import { css, html, js, type YetiPageComponent } from '../../../src/index.ts';

// Contributes CSS, JS, and HTML to the page-scoped `@page` bundle and references each via
// `*.src("@page")`. The test configures custom `derivePageBundleFilePath` functions for all three
// asset types, so this fixture verifies those overrides are honored for both the written file
// paths and the references in the rendered HTML.
const WidgetPage: YetiPageComponent = () => {
  return html`<html>
    <head>
      <title>Custom page bundle paths test</title>
      <link rel="stylesheet" href="${css.src("@page")}" />
    </head>
    <body>
      <h1>custom paths</h1>
      ${html.import("./fragment.html", { bundleName: "@page" })}
      <a data-html-bundle-src="${html.src("@page")}">html bundle</a>
      <script src="${js.src("@page")}"></script>
    </body>
  </html>`;
};

WidgetPage.css = css`
  h1 {
    color: rebeccapurple;
  }
`;

WidgetPage.js = js`
  console.log("custom-page-js-marker");
`;

export default WidgetPage;
