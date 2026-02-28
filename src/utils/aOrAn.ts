const VOWEL_CHARCODES: Record<number, boolean> = {
  65: true,//A
  97: true,//a
  69: true,//E
  101: true,//e
  73: true,//I
  105: true,//i
  79: true,//O
  111: true,//o
  85: true, //U
  117: true,//u
};

export const aOrAn = (nextWord: string): string => {
  if (VOWEL_CHARCODES[nextWord.charCodeAt(0)]) {
    return "an";
  }
  return "a";
};
