import { html } from "../../../../src/index.js";

/**
 * @type {import("src/types").YetiComponent<{ name: string }>}
 */
export const SayHi = ({
  name,
}) => html`<p>Hi, ${name}!</p>`;