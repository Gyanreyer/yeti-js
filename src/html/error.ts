export class YetiHTMLParsingError extends Error {
  constructor(...params: ConstructorParameters<typeof Error>) {
    super(...params);
    this.name = "YetiHTMLParsingError";
  }
}