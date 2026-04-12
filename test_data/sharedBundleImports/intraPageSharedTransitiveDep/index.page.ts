import { html, js } from "../../../src/index.ts";

export default function IndexPage() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Intra-page shared transitive dep</title>
    <script type="module" src="${js.src("*")}"></script>
  </head>
  <body><h1>Hello</h1></body>
</html>
  `;
}

IndexPage.js = js`
  ${js.import("./a.js")}
  ${js.import("./b.js")}
`;
