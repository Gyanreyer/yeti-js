import { html } from '../../../../src/index.js';

/**
 * @type {import('../../../../src/types.js').YetiComponent}
 */
export const BackButton = () => {
  return html`<>
    <button aria-label="Go Back">
      <svg class="icon" xmlns="http://www.w3.org/2000/svg">
        <use href="#back-arrow-icon"></use>
      </svg>
    </button>
    ${html.import("../_icons/back-arrow.svg", { bundleName: "svg-sprites" })}
  </>`;
}