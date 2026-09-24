import { zipSync, strToU8 } from "fflate";
import {
  CONTRACT,
  evaluate,
  safeCSV,
  type Dataset,
  type Plan,
  type Resolution,
} from "./engine";
export async function hashText(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createBundle(
  data: Dataset,
  plan: Plan,
  resolutions: Resolution[],
) {
  const result = evaluate(data, plan, resolutions);
  const headers = CONTRACT.map((f) => f.key);
  const accepted = result.rows.filter((r) => r.accepted);
  const rejected = result.rows.filter((r) => !r.accepted);
  const recipe = {
    version: 1,
    source: data.name,
    sourceSha256: await hashText(data.text),
    plan,
    resolutions,
  };
  const canonical = JSON.stringify(
    accepted.map((r) => ({ sourceRow: r.row, values: r.values })),
    null,
    2,
  );
  const manifest = {
    tool: "ImportProof",
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    source: data.name,
    sourceSha256: recipe.sourceSha256,
    recipeSha256: await hashText(JSON.stringify(recipe)),
    canonicalSha256: await hashText(canonical),
    totalRows: data.rows.length,
    acceptedRows: accepted.length,
    rejectedRows: rejected.length,
    changedCells: result.changes,
    reviewedCorrections: resolutions.length,
    conservationCheck: data.rows.length === accepted.length + rejected.length,
    currency: "EUR",
    note: "All CSV cells are formula-neutralized where needed. canonical.json preserves the exact target strings. Original source is preserved as .txt to avoid accidental spreadsheet execution. Hashes verify byte equality, not source authenticity.",
  };
  const files: Record<string, Uint8Array> = {
    "accepted.csv": strToU8(
      safeCSV(
        headers,
        accepted.map((r) => headers.map((h) => r.values[h])),
      ),
    ),
    "rejected.csv": strToU8(
      safeCSV(
        ["_source_row", "_issues", ...data.headers],
        rejected.map((r) => [
          String(r.row),
          r.issues.map((i) => `${i.field}: ${i.message}`).join(" | "),
          ...data.rows[r.row - 1],
        ]),
      ),
    ),
    "canonical.json": strToU8(canonical),
    "recipe.json": strToU8(JSON.stringify(recipe, null, 2)),
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "lineage.json": strToU8(
      JSON.stringify(
        result.rows.map((r) => ({
          sourceRow: r.row,
          accepted: r.accepted,
          issues: r.issues,
          cells: r.traces,
        })),
        null,
        2,
      ),
    ),
    "original.txt": strToU8(data.text),
    "README.txt": strToU8(
      "ImportProof review bundle\n\naccepted.csv: only rows satisfying the current inventory contract.\nrejected.csv: every held source row with reasons; nothing silently dropped.\ncanonical.json: exact target values and source row numbers.\nrecipe.json: reviewed rules and manual corrections.\nlineage.json: per-cell original, output and transformation explanations.\noriginal.txt: immutable original bytes as UTF-8 text.\nmanifest.json: hashes, counts and conservation result.\n\nCSV values beginning with formula characters are prefixed with an apostrophe. Use canonical.json for exact machine imports. A manual correction is an assertion by the reviewer, not verified external truth.\n\nTo replay with the source repository: npm run replay -- path/to/extracted-bundle\nNo AI credentials or API responses are included.\n",
    ),
  };
  return { zip: zipSync(files, { level: 6 }), manifest, files };
}
