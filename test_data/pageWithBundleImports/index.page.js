import { html, css, js } from "../../src/index.ts";

export default function IndexPage() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page With Bundle Imports Plugin Test</title>
    <link rel="preload" as="style" href="${css.src("reset")}" />
    <link rel="stylesheet" href="${css.src("*")}" />
    <script type="module">
      ${js.inline("@page")}
    </script>
    <style>
      ${css.inline("@page")}
    </style>
    <script src="${js.src("other")}"></script>
    <link rel="stylesheet" href="${css.src("other")}" />
  </head>
  <body>
    <h1>Hello, Yeti!</h1>
   ${html.import("./partials/frag.html")}
    <p>${html.import("./partials/some-text.txt", { shouldEscape: true })}</p>
    <script type="module" src="${js.src("*")}"></script>
  </body>
</html>
  `;
}

IndexPage.css = css`
  ${css.import("./css/reset.css", "reset")}
  ${css.import("./css/other.css", "other")}

  ${css.bundle("@page")}
  h1 {
    margin: 0;
    font-size: 2rem;
  }
`;

IndexPage.js = js`
  ${js.import("./scripts/global.js", "global")}
  ${js.import("./scripts/other.js", "other")}
  ${js.import("./scripts/script-with-sub-dep.js")}

  ${js.bundle("@page")}
  console.log("Hello, Yeti from JavaScript!");
  ${js.import("./scripts/index.js")}
`;