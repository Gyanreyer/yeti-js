import { html, css, js } from "../../../src/index.js";

export default function IndexPage() {
  return html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simple Page Plugin Test</title>
    <style>${css.inline(css.defaultBundleName)}</style>
  </head>
  <body>
    <h1>Hello, Yeti!</h1>
    <script type="module">
      ${js.inline(js.defaultBundleName)}
    </script>
  </body>
</html>`;
}

IndexPage.css = css`
  body {
    font-family: Arial, sans-serif;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
  }
`;

IndexPage.js = js`
  console.log("Hello, Yeti from JavaScript!");
`;