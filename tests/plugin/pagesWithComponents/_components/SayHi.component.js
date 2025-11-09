import { bundle, css, html, js } from "../../../../src/index.js";

/**
 * @type {import("src/types").YetiComponent<{ name: string }>}
 */
export const SayHi = ({
  name,
}) => html`
  <p class="say-hi">Hi, ${name}!</p>
  <script type="module">${bundle.inline("say-hi")}</script>
  <style>${bundle.inline("say-hi")}</style>
`;

SayHi.js = js`
  console.log("Just saying hi!");
  ${bundle.import("./SayHi.js", "say-hi")}
`;

SayHi.css = css`
  ${bundle.import("./SayHi.css", "say-hi")}
`;