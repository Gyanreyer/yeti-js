export const isPrimitiveValue = (value: unknown): value is null | string | number | boolean | bigint | symbol | undefined => {
  return (
    value === null ||
    (typeof value !== "object" &&
      typeof value !== "function")
  );
};

export const DYNAMIC_VALUE_PLACEHOLDER_PREFIX = "\x00DV_";
export const DYNAMIC_VALUE_PLACEHOLDER_SUFFIX = "\x00";

export const makeDynamicValuePlaceholder = (index: number): string => `${DYNAMIC_VALUE_PLACEHOLDER_PREFIX}${index}${DYNAMIC_VALUE_PLACEHOLDER_SUFFIX}`;

export const isLetter = (char: string): boolean => {
  // Fancy bitwise trick to check if char is in [A-Za-z].
  // 1. The only difference between uppercase and lowercase letters in ASCII
  //    is the 6th bit (32). By ORing with 32, we convert uppercase letters
  //    to lowercase.
  // 2. Now that we're converted to lowercase, we can subtract 97, the code point for lowercase 'a',
  //    to normalize to so that 'a' is 0 and 'z' is 25.
  // 3. Masking with 0xFF ensures we only look at the lowest 8 bits to get rid of any negative values (ie, characters with code points < 97).
  // 4. Finally, we check if the result is less than 26 to see if it's in the range of lowercase letters.
  return (((char.charCodeAt(0) | 32) - 97) & 0xFF) < 26;
};

export const isDigit = (char: string): boolean => {
  return ((char.charCodeAt(0) - 48) & 0xFF) < 10; // '0' to '9'
};

export const isWhiteSpace = (char: string): boolean => {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v";
};
