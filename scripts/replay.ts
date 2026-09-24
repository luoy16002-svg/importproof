import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, parseCSV } from "../src/engine";
import { hashText } from "../src/export";
const directory = process.argv[2];
if (!directory)
  throw new Error("Usage: npm run replay -- path/to/extracted-bundle");
const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
const original = read("original.txt"),
  recipe = JSON.parse(read("recipe.json"));
const manifest = JSON.parse(read("manifest.json")),
  expected = read("canonical.json");
if (
  (await hashText(original)) !== recipe.sourceSha256 ||
  recipe.sourceSha256 !== manifest.sourceSha256
)
  throw new Error("Source hash mismatch.");
if ((await hashText(JSON.stringify(recipe))) !== manifest.recipeSha256)
  throw new Error("Recipe hash mismatch.");
const result = evaluate(
  parseCSV(original, recipe.source),
  recipe.plan,
  recipe.resolutions,
);
const canonical = JSON.stringify(
  result.rows
    .filter((r) => r.accepted)
    .map((r) => ({ sourceRow: r.row, values: r.values })),
  null,
  2,
);
if (
  canonical !== expected ||
  (await hashText(canonical)) !== manifest.canonicalSha256
)
  throw new Error("Canonical output mismatch.");
if (
  result.accepted !== manifest.acceptedRows ||
  result.rejected !== manifest.rejectedRows ||
  result.rows.length !== manifest.totalRows
)
  throw new Error("Row-count mismatch.");
console.log(
  JSON.stringify(
    {
      verified: true,
      source: recipe.source,
      accepted: result.accepted,
      rejected: result.rejected,
      sourceSha256: recipe.sourceSha256,
      canonicalSha256: manifest.canonicalSha256,
    },
    null,
    2,
  ),
);
