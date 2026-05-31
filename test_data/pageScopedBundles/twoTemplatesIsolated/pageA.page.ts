import { html, js } from "../../../src/index.ts";

export default function PageA() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page A</title>
    <script type="module" src="${js.src("@page")}"></script>
  </head>
  <body><h1>Page A</h1></body>
</html>
  `;
}

PageA.js = js`
  ${js.import("./pageA-only.js")}
  console.log("pageA-raw-marker");
`;
