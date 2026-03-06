import { html, type YetiComponent } from "../../src/index.ts";

export const Icon: YetiComponent<{
  name: string;
}> = ({ name }) => {
  return html`${html.import(`./icons/${name}.svg`, { bundleName: "icons" })}
  <svg>
    <use href="${html.src("icons")}#${name}" />
  </svg>`;
};