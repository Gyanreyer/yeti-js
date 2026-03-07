import { html } from "../../src/index.ts";

export default function SVGSpriteSheetPage() {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Sprite Sheet</title>
</head>
<body>
  <article>
    ${html.import("./my-markdown.md")}
  </article>
</body>
</html>`;
}