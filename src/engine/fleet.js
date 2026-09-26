/**
 * The vessels, so the site is chosen rather than typed and the name is spelt the
 * same every time. It is a list, not a gate: the field stays free text for
 * chartered ships, rigs and yards. Ships that are gone are not offered, and
 * anything typed is kept and offered next time.
 */
import { inOrder } from "./order.js";
export const FLEET = [
  "MV Northstar",
  "MV Northwind Pioneer",
  "MV Northwind Endeavour",
  "MV Northwind Resolve",
  "MV Aurora Bay",
  "MV Cape Meridian",
  "MV Atlantic Crest",
  "MV Polar Reach",
  "MV Coral Horizon",
  "MV Beacon Point",
  "MV Silver Trench",
  "MV Gulf Sentinel",
  "MV Harbour Light",
  "MV Kittiwake",
  "MV Fulmar Bank",
  "MV Solan Deep",
  "MV Skerry Light",
  "MV Westray Spirit",
  "MV Dogger Star",
  "MV Ravenscar",
  "MV Stormhaven",
  "MV Tern Island",
];

/**
 * The fleet, plus whatever else this person has actually been on, in
 * alphabetical order so a name is always where one would look for it.
 */
export function vessels(used = []) {
  const out = [];
  const seen = new Set();
  const add = (name) => {
    const one = String(name || "").trim();
    const k = one.toLowerCase();
    if (!one || seen.has(k)) return;
    seen.add(k);
    out.push(one);
  };
  used.forEach(add);
  FLEET.forEach(add);
  return inOrder(out);
}
