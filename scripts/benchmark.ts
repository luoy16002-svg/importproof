import { mkdirSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import {
  CONTRACT,
  evaluate,
  localPlan,
  parseCSV,
  type RowResult,
} from "../src/engine";
import { createBundle } from "../src/export";
import { loadDemo } from "../src/demo";
// Generated ground truth, not customer data or a model benchmark. No provider calls.
let seed = 20260924;
const random = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const rounds: unknown[] = [];
for (const locale of ["dot", "comma"] as const) {
  const source: string[][] = [],
    truth: Record<string, string>[] = [],
    held = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const cents = Math.floor(random() * 900000),
      qty = Math.floor(random() * 200),
      day = 1 + Math.floor(random() * 28);
    const price = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    const sku = String(i + 1).padStart(6, "0");
    const title = [
      "Oak desk",
      "Lamp, compact",
      'Linen "moon" shade',
      "Shelf\nsmall",
      "Étagère",
    ][i % 5];
    const group = ["lighting", "furniture", "accessories"][i % 3];
    const canonical = {
      sku,
      product_name: title,
      quantity: String(qty),
      unit_price: price,
      restock_date: `2026-10-${String(day).padStart(2, "0")}`,
      category: group,
    };
    truth.push(canonical);
    const row = [
      ` ${sku} `,
      ` ${title} `,
      `0${qty}`,
      "EUR " + (locale === "dot" ? price : price.replace(".", ",")),
      `${day}/10/2026`,
      ["lamps", "tables", "decor"][i % 3],
    ];
    if (i % 10 === 0) {
      row[2] = "2.5";
      held.add(i);
    }
    if (i % 17 === 0) {
      row[3] = locale === "dot" ? "2.999" : "2,999";
      held.add(i);
    }
    if (i % 19 === 0) {
      row[4] = "2026-02-30";
      held.add(i);
    }
    if (i % 23 === 0) {
      row[5] = "unrecognized";
      held.add(i);
    }
    if (i % 29 === 0) {
      row[1] = "";
      held.add(i);
    }
    if (i % 31 === 0 && i > 0) {
      row[0] = source[i - 1][0];
      held.add(i);
      held.add(i - 1);
    }
    source.push(row);
  }
  const text = Papa.unparse([
    ["Item code", "Item name", "Available", "Cost (EUR)", "ETA", "Group"],
    ...source,
  ]);
  const start = performance.now(),
    data = parseCSV(text, `synthetic-${locale}.csv`);
  const plan = localPlan(data);
  plan.mappings[3].decimal = locale;
  plan.mappings[4].dateOrder = "DMY";
  plan.mappings[5].aliases = {
    lamps: "lighting",
    tables: "furniture",
    decor: "accessories",
  };
  const result = evaluate(data, plan);
  const elapsed = performance.now() - start;
  const unexpectedlyAccepted = result.rows.filter(
    (r) => r.accepted && held.has(r.row - 1),
  );
  const unexpectedlyHeld = result.rows.filter(
    (r) => !r.accepted && !held.has(r.row - 1),
  );
  const wrongValues: RowResult[] = result.rows.filter(
    (r) =>
      r.accepted &&
      CONTRACT.some((f) => r.values[f.key] !== truth[r.row - 1][f.key]),
  );
  const rowAccounting = result.accepted + result.rejected === source.length;
  rounds.push({
    locale,
    total: source.length,
    expectedHeld: held.size,
    accepted: result.accepted,
    held: result.rejected,
    unexpectedlyAccepted: unexpectedlyAccepted.map((r) => r.row),
    unexpectedlyHeld: unexpectedlyHeld.map((r) => r.row),
    wrongAcceptedValues: wrongValues.map((r) => r.row),
    rowAccounting,
    parseAndValidateMs: Number(elapsed.toFixed(2)),
  });
  if (
    unexpectedlyAccepted.length ||
    unexpectedlyHeld.length ||
    wrongValues.length ||
    !rowAccounting
  )
    throw new Error(
      `Failed generated ground-truth check: ${JSON.stringify(rounds.at(-1))}`,
    );
}
const demo = loadDemo();
const bundle = await createBundle(demo.data, demo.plan, []);
mkdirSync("artifacts/demo-bundle", { recursive: true });
for (const [name, bytes] of Object.entries(bundle.files))
  writeFileSync(`artifacts/demo-bundle/${name}`, bytes);
writeFileSync("artifacts/importproof-demo-bundle.zip", bundle.zip);
const report = {
  generatedAt: new Date().toISOString(),
  seed: 20260924,
  type: "Synthetic deterministic-engine validation. Not a real-user study or a model-quality comparison.",
  cases: rounds,
  modelCalls: 0,
  limits:
    "Explicit correct recipe supplied to engine; does not measure whether an AI discovers that recipe. Locale ambiguity, pricing scale and schema scope remain visible user decisions.",
};
writeFileSync(
  "artifacts/engine-evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
