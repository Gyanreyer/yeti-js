import { html, type YetiPageComponent } from '../../../src/index.ts';

// Imports an HTML fragment into the page-scoped `@page` bundle (so it is written to an external
// `_pages/*.html` file rather than inlined) and references that bundle's file path via
// `html.src("@page")`. Exercises `processAndWriteHTMLPageBundle` end to end.
const IndexPage: YetiPageComponent = () => {
  return html`<html>
    <head>
      <title>HTML page bundle test</title>
    </head>
    <body>
      ${html.import("./fragment.html", { bundleName: "@page" })}
      <a data-html-bundle-src="${html.src("@page")}">page html bundle</a>
    </body>
  </html>`;
};

export default IndexPage;
