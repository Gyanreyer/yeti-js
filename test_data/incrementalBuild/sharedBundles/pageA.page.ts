import { html, css, js } from "../../../src/index.ts";

export default function PageA() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page A</title>
    <link rel="stylesheet" href="${css.src("*")}" />
    <script type="module" src="${js.src("*")}"></script>
  </head>
  <body>
    <h1 class="pageA-heading">Page A</h1>
  </body>
</html>
  `;
}

PageA.css = css`
  ${css.import("./pageA-only.css", "global")}
`;

PageA.js = js`
  ${js.import("./pageA-only.js", "global")}
`;
