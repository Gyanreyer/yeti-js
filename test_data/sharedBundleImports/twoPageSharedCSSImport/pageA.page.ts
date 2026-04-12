import { html, css } from "../../../src/index.ts";

export default function PageA() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page A</title>
    <link rel="stylesheet" href="${css.src("*")}" />
  </head>
  <body>
    <h1>Page A</h1>
  </body>
</html>
  `;
}

PageA.css = css`
  ${css.import("./shared.css")}
`;
