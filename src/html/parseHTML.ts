import { lexHTML } from "./lexHTML";
import { YetiNode } from "./types";

export const parseHTML = async (htmlString: string, dynamicValues: unknown[]): Promise<YetiNode[]> => {
  const lexedTokens = await lexHTML(htmlString, dynamicValues);

  // TODO: parse lexed tokens into YetiNode structure
  return [];
}