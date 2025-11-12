import { html } from '../../../src/index.js';
import { SiteNav } from './_components/SiteNav.component.js';

/**
 * @import { YetiPageComponent } from '../../../src/types';
 * @type {YetiPageComponent}
 */
const IndexPage = () => {
  return html`<html>
    <head>
      <title>Page with HTML Bundle Inline Test</title>
    </head>
    <body>
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${html.inline("svg-sprites")}
        </defs>
      </svg>
      <${SiteNav} />
    </body>
  </html>`;
};

export default IndexPage;