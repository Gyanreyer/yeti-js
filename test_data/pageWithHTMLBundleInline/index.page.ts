import { css, html, type YetiPageComponent } from '../../src/index.ts';
import { SiteNav } from './_components/SiteNav.component.ts';

const IndexPage: YetiPageComponent = () => {
  return html`<html>
    <head>
      <title>Page with HTML Bundle Inline Test</title>
      <style>
        ${css.inline("*")}
      </style>
    </head>
    <body>
      <svg xmlns="http://www.w3.org/2000/svg" hidden>
        <defs>
          ${html.inline("svg-sprites")}
        </defs>
      </svg>
      <${SiteNav} />
    </body>
  </html>`;
};

IndexPage.css = css`
  *[hidden] {
    display: none !important;
  }
`;

export default IndexPage;