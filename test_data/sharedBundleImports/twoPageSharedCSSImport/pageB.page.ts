import { html, css } from "../../../src/index.ts";

export default function PageB() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page B</title>
    <link rel="stylesheet" href="${css.src("*")}" />
  </head>
  <body>
    <h1>Page B</h1>
  </body>
</html>
  `;
}

PageB.css = css`
  ${css.import("./shared.css")}
`;
