import { html, type YetiComponent } from '../../../src/index.ts';

export const HomeButton: YetiComponent = () => {
  return html`
    <button aria-label="Home">
      <svg class="icon" xmlns="http://www.w3.org/2000/svg">
        <use href="#home-icon"></use>
      </svg>
    </button>
    ${html.import("../_icons/home.svg", { bundleName: "svg-sprites" })}
  `;
}