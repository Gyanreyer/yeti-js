import { html, css, js } from "../../../src/index.js";

export default function IndexPage() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page With Bundle Imports Plugin Test</title>
    <link rel="preload" as="style" href="${css.src("default")}" />
    <link rel="stylesheet" href="${css.src("*")}" />
    <script type="module">
      ${js.inline("index")}
    </script>
    <style>
      ${css.inline("index")}
    </style>
    <script src="${js.src("other")}"></script>
    <link rel="stylesheet" href="${css.src("other")}" />
  </head>
  <body>
    <h1>Hello, Yeti!</h1>
   ${html.import("./partials/frag.html")}
    <p>${html.import("./partials/some-text.txt", true)}</p>
    <script type="module" src="${js.src("*")}"></script>
  </body>
</html>
  `;
}

IndexPage.css = css`
  ${css.import("./css/reset.css", "default")}
  ${css.import("./css/other.css", "other")}

  ${css.bundle("index")}
  h1 {
    margin: 0;
    font-size: 2rem;
  }
`;

IndexPage.js = js`
  ${js.import("./scripts/global.js", "default")}
  ${js.import("./scripts/other.js", "other")}

  ${js.bundle("index")}
  console.log("Hello, Yeti from JavaScript!");
  ${js.import("./scripts/index.js")}
`;