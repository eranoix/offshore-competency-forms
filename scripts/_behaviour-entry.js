/* What the bench needs out of the engine, in one entry so esbuild bundles it
   once. */
export { generateDocument, writeBlocks, buildContext, fill, T, KEYS, PRESETS } from "../src/engine/generator.js";
export { jobWords } from "../src/engine/review.js";
