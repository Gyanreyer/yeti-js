import { html } from "../../src/html/html.ts";
import { js } from '../../src/js/js.ts';
import { css } from '../../src/css/css.ts';
import type { YetiChildNode } from "../../src/html/types.ts";

export function Layout({
  children,
}: {
  children: YetiChildNode[];
}) {
  return html`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test Page</title>
    <style>
      ${css.inline("critical")}
    </style>
    <script type="module">
      ${js.inline("critical")}
    </script>
  </head>
  <body>
    ${children}
    <script src=${js.src("*")}></script>
    <link rel="stylesheet" href=${css.src("*")} />
  </body>
</html>`;
}