import { html, css, js } from "../../../src/index.ts";

export default function PageB() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page B</title>
    <link rel="stylesheet" href="${css.src("*")}" />
    <script type="module" src="${js.src("*")}"></script>
  </head>
  <body>
    <h1 class="pageB-heading">Page B</h1>
  </body>
</html>
  `;
}

PageB.css = css`
  ${css.import("./pageB-only.css")}
`;

PageB.js = js`
  ${js.import("./pageB-only.js")}
`;
