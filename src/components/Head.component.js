import { html } from '../html.js';

/**
 * @type {import('../types').YetiComponent<{}>}
 */
export const Head = ({
  children,
}) => {
  return html`<head-->${children}</head-->`;
}