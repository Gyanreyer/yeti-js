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
    <title>Test Page</title>
    <style data-first>${css.inline("*")}</style>
    <style data-second>${css.inline("*")}</style>
    <link rel="stylesheet" href=${css.src("*")} media="print" onload="this.media='all'" />
    <noscript><link rel="stylesheet" href=${css.src("*")} /></noscript>
    <script data-first type="module">${js.inline("*")}</script>
    <script data-second type="module">${js.inline("*")}</script>
    <script data-first src=${js.src("*")}></script>
    <script data-second src=${js.src("*")}></script>
  </head>
  <body>
    ${children}
  </body>
</html>`;
}
