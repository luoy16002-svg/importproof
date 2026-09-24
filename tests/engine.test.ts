import test from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  CONTRACT,
  decimalValue,
  dateValue,
  evaluate,
  localPlan,
  parseCSV,
  profile,
  safeCSV,
  validatePlan,
} from "../src/engine";
import { loadDemo } from "../src/demo";
import { createBundle, hashText } from "../src/export";
import { unzipSync, strFromU8 } from "fflate";

for (const [name, input, locale, expected] of [
  ["decimal point", "1,234.56", "dot", "1234.56"],
  ["decimal comma", "1.234,56", "comma", "1234.56"],
  ["exact ten cents", "0.10", "dot", "0.10"],
  ["leading zeroes", "0001.20", "dot", "1.20"],
  ["negative zero", "-0,00", "comma", "0.00"],
  ["trailing fractional zeroes", "2.300", "dot", "2.30"],
  ["large exact amount", "99999999999999.99", "dot", "99999999999999.99"],
  ["EUR prefix", "EUR 19,99", "comma", "19.99"],
  ["EUR suffix", "19,99 EUR", "comma", "19.99"],
  ["Euro symbol", "€ 19,99", "comma", "19.99"],
] as const)
  test(`amount: ${name}`, () =>
    assert.equal(decimalValue(input, locale, "EUR"), expected));
for (const [raw, locale] of [
  ["1.999", "dot"],
  ["12,34.56", "dot"],
  ["1,23,456", "dot"],
  ["$ 19.50", "dot"],
  ["1e3", "dot"],
  ["1.00.00", "comma"],
  ["Infinity", "dot"],
  ["NaN", "dot"],
  ["0x12", "dot"],
] as const)
  test(`reject invalid amount ${raw}/${locale}`, () =>
    assert.throws(() => decimalValue(raw, locale, "EUR")));
test("dates do not depend on the browser timezone or roll invalid days forward", () => {
  assert.equal(dateValue("2024-02-29", "reject"), "2024-02-29");
  for (const d of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-02",
    "2026-10-00",
    "2026-10-02T00:00:00Z",
  ])
    assert.throws(() => dateValue(d, "reject"));
});
test("ambiguous dates are withheld; the convention changes interpretation explicitly", () => {
  assert.throws(() => dateValue("04/10/2026", "reject"), /Ambiguous/);
  assert.equal(dateValue("04/10/2026", "DMY"), "2026-10-04");
  assert.equal(dateValue("04/10/2026", "MDY"), "2026-04-10");
  assert.equal(dateValue("14/10/2026", "reject"), "2026-10-14");
  assert.equal(dateValue("10/14/2026", "reject"), "2026-10-14");
  assert.equal(dateValue("11/11/2026", "reject"), "2026-11-11");
});
test("CSV supports BOM, CRLF, commas in quotes, multiline cells and escaped quotes", () => {
  const input = '\uFEFFid,name\r\n001,"a, b"\r\n002,"line 1\nline ""2"""';
  const d = parseCSV(input);
  assert.equal(d.rows[0][0], "001");
  assert.equal(d.rows[1][1], 'line 1\nline "2"');
  assert.equal(d.text, input);
});
test("CSV detects semicolon and tab separators", () => {
  assert.equal(parseCSV("a;b\n1;2").delimiter, ";");
  assert.equal(parseCSV("a\tb\n1\t2").delimiter, "\t");
});
test("reject malformed, duplicate-header and oversized inputs instead of silently dropping cells", () => {
  for (const s of [
    "a,a\n1,2",
    "A, a\n1,2",
    "a,b\n1,2,3",
    "a,b\n1",
    "a,\n1,2",
    "a,b",
    "a\n\0",
  ])
    assert.throws(() => parseCSV(s));
  assert.throws(() => parseCSV("a\n" + "x".repeat(5000000)), /5 MB/);
});
test("demo has 22 accepted and 10 held rows, with every duplicate retained", () => {
  const { data, plan } = loadDemo();
  const r = evaluate(data, plan);
  assert.equal(r.accepted, 22);
  assert.equal(r.rejected, 10);
  assert.equal(r.rows.length, 32);
  assert.deepEqual(
    r.rows
      .filter((row) => row.issues.some((i) => i.code === "duplicate"))
      .map((row) => row.row),
    [12, 13],
  );
  assert.equal(r.rows[2].values.quantity, "4");
  assert.equal(r.rows[2].values.restock_date, "2026-10-14");
  assert.equal(r.rows[23].values.sku, "LT-024");
});
test("local matching never assumes price locale", () => {
  const { data } = loadDemo();
  const p = localPlan(data);
  assert.equal(
    p.mappings.find((m) => m.target === "unit_price")?.decimal,
    "unconfirmed",
  );
  const r = evaluate(data, p);
  assert.equal(r.accepted, 0);
  assert.equal(r.issueCounts.unconfirmed_number, 32);
});
test("manual correction is canonical, not reparsed with comma source locale", () => {
  const { data, plan } = loadDemo();
  const result = evaluate(data, plan, [
    {
      row: 18,
      field: "unit_price",
      value: "54.99",
      reason: "Confirmed against the supplier sheet",
    },
  ]);
  assert.equal(result.rows[17].accepted, true);
  assert.equal(result.rows[17].values.unit_price, "54.99");
  assert.equal(result.rows[17].traces[3].original, "54,995");
  assert.equal(result.accepted, 23);
});
test("invalid reviewed values still fail validation", () => {
  const { data, plan } = loadDemo();
  const r = evaluate(data, plan, [
    {
      row: 6,
      field: "quantity",
      value: "3.5",
      reason: "A proposed correction",
    },
  ]);
  assert.equal(r.rows[5].accepted, false);
  assert.equal(r.rows[5].traces[2].overridden, true);
});
test("resolving one duplicate revalidates every related row", () => {
  const { data, plan } = loadDemo();
  const result = evaluate(data, plan, [
    {
      row: 13,
      field: "sku",
      value: "AC-013",
      reason: "Revised identifier confirmed",
    },
  ]);
  assert.equal(result.accepted, 24);
  assert.equal(result.issueCounts.duplicate, undefined);
});
test("original data and recipe remain unchanged after evaluation", () => {
  const { data, plan } = loadDemo();
  const before = JSON.stringify({ data, plan });
  evaluate(data, plan, [
    { row: 6, field: "quantity", value: "3", reason: "Confirmed" },
  ]);
  assert.equal(JSON.stringify({ data, plan }), before);
});
test("whitespace is still missing when a required text column does not trim", () => {
  const { data, plan } = loadDemo();
  data.rows[0][1] = "  ";
  plan.mappings[1].trim = false;
  assert.equal(evaluate(data, plan).rows[0].accepted, false);
});
test("an alias must be explicit and cannot overwrite a numeric value", () => {
  const { data, plan } = loadDemo();
  plan.mappings.find((m) => m.target === "category")!.aliases = {
    lamps: "lighting",
  };
  assert.equal(evaluate(data, plan).rows[10].accepted, true);
  plan.mappings.find((m) => m.target === "quantity")!.aliases = { three: "3" };
  assert.throws(() => validatePlan(plan, data), /only/);
});
test("invalid or duplicated mappings fail closed", () => {
  const { data, plan } = loadDemo();
  assert.throws(() => validatePlan({ ...plan, code: "anything" }, data));
  for (const mutation of [
    () => {
      plan.mappings[0].source = "made-up";
    },
    () => {
      plan.mappings[0].source = data.headers[0];
      plan.mappings[0].target = "quantity";
    },
  ]) {
    mutation();
    assert.throws(() => validatePlan(plan, data));
  }
});
test("missing required source columns cannot be silently defaulted", () => {
  const { data, plan } = loadDemo();
  plan.mappings[0].source = null;
  const r = evaluate(data, plan);
  assert.equal(r.accepted, 0);
  assert.equal(r.issueCounts.unmapped, 32);
});
test("profile excludes row values unless samples are explicitly enabled", () => {
  const { data } = loadDemo();
  assert.equal(JSON.stringify(profile(data)).includes("Arc table lamp"), false);
  assert.equal(
    JSON.stringify(profile(data, true)).includes("Arc table lamp"),
    true,
  );
});
test("spreadsheet formula prefixes are neutralized, including headers and whitespace", () => {
  const result = safeCSV(
    ["=danger"],
    [["=1+1"], [" \t@bad"], ["-1"], ["+2"], ["plain"]],
  );
  const values = Papa.parse<string[]>(result).data.flat();
  assert.deepEqual(values, [
    "'=danger",
    "'=1+1",
    "' \t@bad",
    "'-1",
    "'+2",
    "plain",
  ]);
});
test("bundle conserves rows, preserves raw bytes and reproduces canonical target values", async () => {
  const { data, plan } = loadDemo();
  const corrections = [
    {
      row: 6,
      field: "quantity",
      value: "3",
      reason: "Test fixture correction",
    },
  ];
  const bundle = await createBundle(data, plan, corrections);
  const entries = unzipSync(bundle.zip);
  const recipe = JSON.parse(strFromU8(entries["recipe.json"]));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  const raw = strFromU8(entries["original.txt"]);
  const canonical = JSON.parse(strFromU8(entries["canonical.json"]));
  assert.equal(raw, data.text);
  assert.equal(await hashText(raw), manifest.sourceSha256);
  assert.equal(await hashText(JSON.stringify(recipe)), manifest.recipeSha256);
  assert.equal(
    await hashText(strFromU8(entries["canonical.json"])),
    manifest.canonicalSha256,
  );
  const replay = evaluate(parseCSV(raw), recipe.plan, recipe.resolutions);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        replay.rows
          .filter((r) => r.accepted)
          .map((r) => ({ sourceRow: r.row, values: r.values })),
      ),
    ),
    canonical,
  );
  assert.equal(manifest.acceptedRows + manifest.rejectedRows, data.rows.length);
  assert.equal(manifest.conservationCheck, true);
  assert.equal(
    Papa.parse<string[]>(strFromU8(entries["rejected.csv"])).data.length - 1,
    manifest.rejectedRows,
  );
  assert.equal(entries[".env"], undefined);
});
test("row order and leading-zero identifiers survive a full accepted export", async () => {
  const data = parseCSV(
    Papa.unparse([
      CONTRACT.map((f) => f.key),
      ["001", "First", "0", "0.10", "", "lighting"],
      ["0002", "Second", "1", "1.20", "", "lighting"],
    ]),
  );
  const plan = localPlan(data);
  plan.mappings[3].decimal = "dot";
  const r = evaluate(data, plan);
  assert.equal(r.accepted, 2);
  const bundle = await createBundle(data, plan, []);
  const parsed = Papa.parse<string[]>(
    strFromU8(bundle.files["accepted.csv"]),
  ).data;
  assert.deepEqual(
    parsed.slice(1).map((row) => row[0]),
    ["001", "0002"],
  );
});
