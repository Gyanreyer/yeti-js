import { html, type YetiComponent } from '../../../src/index.ts';

import { BackButton } from './BackButton.component.ts';
import { HomeButton } from './HomeButton.component.ts';

export const SiteNav: YetiComponent = () => {
  return html`<nav>
    <${BackButton} />
    <${HomeButton} />
  </nav>`;
}