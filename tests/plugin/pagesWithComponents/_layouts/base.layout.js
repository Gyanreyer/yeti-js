import { html, css, bundle } from '../../../../src/index.js';

/**
 * @import {YetiComponent} from '../../../../src/types';
 */

/**
 * @type {YetiComponent<{
 *  title: string;
 *  description: string;
 *  generator: string;
 * }>}
 */
const BaseLayout = ({ title = "Yeti", description = "A helpful tool for building websites", generator, children }) => {
  return html`
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      <title>${title}</title>

      <meta name="description" content="${description}" />

      <meta name="generator" content="${generator}" />
      <script src="${bundle.src("*")}" type="module" async></script>
      <link rel="stylesheet" href="${bundle.src("*")}" />
    </head>
    <body>
      ${children}
    </body>
  </html>`;
}

BaseLayout.css = css`
  :root {
    font-family: sans-serif;
  }
`;

export default BaseLayout;