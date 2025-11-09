import { css, Head, html, js } from "../../../../src/index.js";
import { SayHi } from "../_components/SayHi.component.js";
import BaseLayout from "../_layouts/base.layout.js"

export const config = {
  pagination: {
    data: "slugs",
    size: 1,
    alias: "slug",
  },
  slugs: ["a", "b", "c"],
  /**
   * @param {{
   *   slug: string;
   * }} data
   * @returns {string}
   */
  permalink: ({ slug }) => `slug/${slug}.html`,
}

/**
 * @type {import("src/types").YetiPageComponent<{ slug: string }>}
 */
const SlugPage = ({ slug, eleventy: {
  generator,
} }) => {
  return html`<${BaseLayout} title="Page for slug: ${slug}" generator=${generator}>
    <${Head}>
      <meta name="description" content="This is a description override for slug: ${slug}" />
    </>
    <h1>Page for slug: ${slug}</h1>
    <${SayHi} name=${slug} />
  </>`;
}

SlugPage.css = css`
  :root {
    font-size: 20px;
  }

  ${css.bundle("slug")}
  h1 {
    color: teal;
  }
`;

SlugPage.js = js`
  ${js.import("./script.js")}
`;

export default SlugPage;