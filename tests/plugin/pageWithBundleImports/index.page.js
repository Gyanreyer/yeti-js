import { html, css, js, bundle } from "../../../src/index.js";

export default function IndexPage() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page With Bundle Imports Plugin Test</title>
    <link rel="preload" as="style" href="${bundle.src("default")}" />
    <link rel="stylesheet" href="${bundle.src("*")}" />
  </head>
  <body>
    <h1>Hello, Yeti!</h1>
   ${bundle.importHTML("./partials/frag.html")}
    <p>${bundle.importHTML("./partials/some-text.txt", true)}</p>
    <script type="module">
      ${bundle.inline("index")}
    </script>
    <script type="module" src="${bundle.src("*")}"></script>
  </body>
</html>
  `;
}

IndexPage.css = css`
  ${bundle.import("./css/reset.css", "default")}

  ${bundle("index")}
  h1 {
    margin: 0;
    font-size: 2rem;
  }
`;

IndexPage.js = js`
  ${bundle.import("./scripts/global.js", "default")}

  ${bundle("index")}
  console.log("Hello, Yeti from JavaScript!");
  ${bundle.import("./scripts/index.js")}
`;