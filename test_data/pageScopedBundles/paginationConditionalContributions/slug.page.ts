import { css, html, js, type YetiComponent, type YetiPageComponent } from "../../../src/index.ts";
import { SpecialWidget } from "./SpecialWidget.component.ts";

export const config = {
  pagination: {
    data: "slugs",
    size: 1,
    alias: "slug",
  },
  slugs: ["a", "b", "c"],
  permalink: ({ slug }: { slug: string }) => `slug/${slug}.html`,
};

// Renders nothing and contributes no assets — used on the variants that don't include the widget,
// so SpecialWidget's contributions are genuinely conditional (only present on the "b" variant).
const Empty: YetiComponent = () => html``;

const SlugPage: YetiPageComponent<{ slug: string }> = ({ slug }) => html`
<html lang="en">
  <head>
    <title>Slug: ${slug}</title>
    <link rel="stylesheet" href="${css.src("@page")}" />
    <script type="module" src="${js.src("@page")}"></script>
    <script src="${js.src("global")}"></script>
  </head>
  <body>
    <h1>Slug: ${slug}</h1>
    <${slug === "b" ? SpecialWidget : Empty} />
  </body>
</html>
`;

// Every variant contributes a base @page CSS rule so `css.src("@page")` always resolves.
SlugPage.css = css`
  .base-paginated-css-marker {
    color: #654321;
  }
`;

// Every variant contributes base @page JS and a base "global" JS section, so the referenced
// bundles always have content regardless of which variant is rendering.
SlugPage.js = js`
  console.log("base-paginated-js-marker");

  ${js.bundle("global")}
  console.log("base-paginated-global-marker");
`;

export default SlugPage;
