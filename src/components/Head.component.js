import { html } from '../html.js';

/**
 * @type {import('src/renderComponent.js').Component}
 */
export const Head = ({
  children,
}) => {
  return html`<head-->${children}</head-->`;
}