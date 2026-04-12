import { html, js } from "../../../src/index.ts";

export default function PageC() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Page C</title>
    <script type="module" src="${js.src("*")}"></script>
  </head>
  <body><h1>Page C</h1></body>
</html>
  `;
}

PageC.js = js`
  ${js.import("./y.js")}
`;
