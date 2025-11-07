/**
 * @type {{[char: string]: string}}
 */
const escapedCharacterMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
};

const escapeCharactersRegex = new RegExp(`[${Object.keys(escapedCharacterMap).join('')}]`, 'g');

/**
 * @param {unknown} unescaped
 */
export const escapeHTML = (unescaped) => String(unescaped).replace(escapeCharactersRegex, (s) => s in escapedCharacterMap ? escapedCharacterMap[s] : s);