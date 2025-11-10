import { html } from '../html.js';

/**
 * @type {import("../types.js").Head}
 */
export const Head = ({
  children,
}) => {
  return html`<head-->${children}</head-->`;
}