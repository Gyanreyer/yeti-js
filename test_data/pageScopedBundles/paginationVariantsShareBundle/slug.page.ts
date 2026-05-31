import { html, js, type YetiPageComponent } from "../../../src/index.ts";

export const config = {
  pagination: {
    data: "slugs",
    size: 1,
    alias: "slug",
  },
  slugs: ["a", "b", "c"],
  permalink: ({ slug }: { slug: string }) => `slug/${slug}.html`,
};

const SlugPage: YetiPageComponent<{ slug: string }> = ({ slug }) => html`
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Slug: ${slug}</title>
    <script type="module" src="${js.src("@page")}"></script>
  </head>
  <body><h1>Slug: ${slug}</h1></body>
</html>
`;

SlugPage.js = js`
  ${js.import("./shared-dep.js")}
  console.log("paginated-raw-marker");
`;

export default SlugPage;
