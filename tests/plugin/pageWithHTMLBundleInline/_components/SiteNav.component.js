import { html } from '../../../../src/index.js';

import { BackButton } from './BackButton.component.js';
import { HomeButton } from './HomeButton.component.js';

/**
 * @type {import('../../../../src/types.js').YetiComponent}
 */
export const SiteNav = () => {
  return html`<nav>
    <${BackButton} />
    <${HomeButton} />
  </nav>`;
}