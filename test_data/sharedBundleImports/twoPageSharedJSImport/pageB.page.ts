import { html, js } from "../../../src/index.ts";

export default function PageB() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page B</title>
    <script type="module" src="${js.src("*")}"></script>
  </head>
  <body>
    <h1>Page B</h1>
  </body>
</html>
  `;
}

PageB.js = js`
  ${js.import("./shared.js", "global")}
`;
