import { html, js, type YetiPageComponent } from "../../../src/index.ts";

// A paginated template producing three output files (slug/a.html, slug/b.html, slug/c.html) from
// one inputPath. All three reference the shared "global" JS bundle. When "global"'s hash changes
// due to another page (trigger) being rebuilt, every one of these three output files must have its
// stale hash updated in the incremental pass — not just one.
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
    <title>Slug: ${slug}</title>
    <script src="${js.src("global")}"></script>
  </head>
  <body><h1>Slug: ${slug}</h1></body>
</html>
`;

// Contribute to "global" so each paginated variant references it.
SlugPage.js = js`
  ${js.bundle("global")}
  console.log("slug-global-marker");
`;

export default SlugPage;
