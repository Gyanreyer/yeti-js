const doctypeRegex = /^\s*<!DOCTYPE [^>]+>/i;

/**
 * @param {string} htmlStr 
 */
export const ensureHTMLHasDoctype = (htmlStr) => {
  if (doctypeRegex.test(htmlStr)) {
    return htmlStr;
  } else {
    return `<!DOCTYPE html>\n${htmlStr}`;
  }
}