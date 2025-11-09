import { css, html, js } from "../../../../src/index.js";

/**
 * @type {import("src/types").YetiComponent<{ name: string }>}
 */
export const SayHi = ({
  name,
}) => html`
  <p class="say-hi">Hi, ${name}!</p>
  <script type="module">${js.inline("say-hi")}</script>
  <style>${css.inline("say-hi")}</style>
`;

SayHi.js = js`
  console.log("Just saying hi!");
  ${js.import("./SayHi.js", "say-hi")}
`;

SayHi.css = css`
  ${css.import("./SayHi.css", "say-hi")}
`;