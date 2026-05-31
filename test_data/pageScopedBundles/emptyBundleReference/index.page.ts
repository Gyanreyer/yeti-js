import { css, js, html, type YetiPageComponent } from '../../../src/index.ts';

// This page contributes NO CSS/JS/HTML to any bundle, yet references several bundles via `src()`.
// Empty `@page` references must be skipped silently; an empty *named* reference must still warn.
// Either way the build must not throw (the pre-Phase-6 behavior threw during bundle assembly).
const IndexPage: YetiPageComponent = () => html`<html>
  <head>
    <title>Empty bundle reference test</title>
    <link rel="stylesheet" data-page-css="${css.src("@page")}" />
    <link rel="stylesheet" data-named-css="${css.src("named-empty-bundle")}" />
    <script data-page-js="${js.src("@page")}"></script>
    <a data-page-html="${html.src("@page")}">x</a>
  </head>
  <body><h1>no assets</h1></body>
</html>`;

export default IndexPage;
