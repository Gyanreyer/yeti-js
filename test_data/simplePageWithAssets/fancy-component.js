class FancyComponent extends HTMLElement {
  static tagName = "fancy-component";

  static {
    customElements.define(this.tagName, this);
  }

  connectedCallback() {
    this.innerHTML = `
      <h1>Fancy Component</h1>
      <p>This is a fancy component.</p>
    `;
  }
}