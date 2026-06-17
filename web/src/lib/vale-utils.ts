/** Strip Vale regex word-boundary markers from a token for display purposes. */
export function displayKey(raw: string): string {
  return raw.replace(/^\\b|\\b$/g, "");
}
