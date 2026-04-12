import { html, js } from "../../../src/index.ts";

export default function PageA() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page A</title>
    <script type="module" src="${js.src("*")}"></script>
  </head>
  <body><h1>Page A</h1></body>
</html>
  `;
}

PageA.js = js`
  ${js.import("./shared.js")}
  console.log("PageA-only-marker");
`;
