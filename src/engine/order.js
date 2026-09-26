/**
 * One order for every list on this site: alphabetical, ignoring case and accents,
 * with numbers inside names sorted numerically. Scales (scheme levels, score
 * bands) are deliberately not sorted this way: they are steps, not names.
 */
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Compare two names the way a person reading a list would want them. */
export const byName = (a, b) => collator.compare(String(a ?? ""), String(b ?? ""));

/** A copy of `list` in that order. `of` says where the name is on an item. */
export const inOrder = (list, of = (x) => x) =>
  [...(list || [])].sort((a, b) => byName(of(a), of(b)));
