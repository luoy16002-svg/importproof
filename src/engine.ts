import Papa from "papaparse";
import { z } from "zod";

export type FieldType = "text" | "integer" | "decimal" | "date" | "enum";
export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique?: boolean;
  min?: number;
  allowed?: string[];
  currency?: string;
  description: string;
};
export const CONTRACT: Field[] = [
  {
    key: "sku",
    label: "SKU",
    type: "text",
    required: true,
    unique: true,
    description: "Unique product identifier. Preserve leading zeroes.",
  },
  {
    key: "product_name",
    label: "Product name",
    type: "text",
    required: true,
    description: "A product name supplied by the source.",
  },
  {
    key: "quantity",
    label: "Quantity",
    type: "integer",
    required: true,
    min: 0,
    description: "Whole units in stock, zero or greater.",
  },
  {
    key: "unit_price",
    label: "Unit price · EUR",
    type: "decimal",
    required: true,
    min: 0,
    currency: "EUR",
    description:
      "EUR amount with at most two decimal places. No currency conversion.",
  },
  {
    key: "restock_date",
    label: "Restock date",
    type: "date",
    required: false,
    description:
      "ISO date YYYY-MM-DD. Ambiguous dates require an explicit convention.",
  },
  {
    key: "category",
    label: "Category",
    type: "enum",
    required: true,
    allowed: ["lighting", "furniture", "accessories"],
    description:
      "One of lighting, furniture or accessories. Aliases must be explicit.",
  },
];
export const mappingSchema = z
  .object({
    target: z.string(),
    source: z.string().nullable(),
    trim: z.boolean(),
    casing: z.enum(["keep", "lower", "upper"]),
    decimal: z.enum(["unconfirmed", "dot", "comma"]),
    dateOrder: z.enum(["reject", "DMY", "MDY"]),
    aliases: z.record(z.string(), z.string()),
  })
  .strict();
export const planSchema = z
  .object({ version: z.literal(1), mappings: z.array(mappingSchema).max(40) })
  .strict();
export type Mapping = z.infer<typeof mappingSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Dataset = {
  name: string;
  text: string;
  headers: string[];
  rows: string[][];
  delimiter: string;
};
export type Resolution = {
  row: number;
  field: string;
  value: string;
  reason: string;
};
export type Issue = { field: string; code: string; message: string };
export type CellTrace = {
  field: string;
  source: string | null;
  original: string;
  output: string;
  steps: string[];
  overridden: boolean;
};
export type RowResult = {
  row: number;
  values: Record<string, string>;
  issues: Issue[];
  traces: CellTrace[];
  changed: boolean;
  accepted: boolean;
};
export type Evaluation = {
  rows: RowResult[];
  accepted: number;
  rejected: number;
  changed: number;
  changes: number;
  issues: number;
  issueCounts: Record<string, number>;
};
export const MAX_BYTES = 5_000_000;
export const MAX_ROWS = 20_000;

export function parseCSV(text: string, name = "uploaded.csv"): Dataset {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw new Error("This workbench accepts CSV files up to 5 MB.");
  if (text.includes("\0"))
    throw new Error(
      "This is not a supported text CSV. Export an UTF-8 CSV from your spreadsheet first.",
    );
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  const serious = parsed.errors.filter(
    (e) => e.code !== "UndetectableDelimiter",
  );
  if (serious.length)
    throw new Error(`CSV could not be read: ${serious[0].message}`);
  if (parsed.data.length < 2)
    throw new Error("Add a header row and at least one data row.");
  const headers = parsed.data[0].map((h) => h.trim());
  if (headers.length > 50)
    throw new Error("Use a file with 50 columns or fewer.");
  if (headers.some((h) => !h))
    throw new Error("Each column needs a non-empty header.");
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length)
    throw new Error(
      "Duplicate column headers are ambiguous. Rename them before importing.",
    );
  if (parsed.data.length - 1 > MAX_ROWS)
    throw new Error(
      `Use a file with ${MAX_ROWS.toLocaleString()} rows or fewer.`,
    );
  const rows = parsed.data.slice(1);
  const wrong = rows.findIndex((row) => row.length !== headers.length);
  if (wrong !== -1)
    throw new Error(
      `Data row ${wrong + 1} has ${rows[wrong].length} cells; the header has ${headers.length}. Check its quoting or delimiter.`,
    );
  return { name, text, headers, rows, delimiter: parsed.meta.delimiter };
}

const synonyms: Record<string, string[]> = {
  sku: ["sku", "item code", "product code", "product id", "article", "item id"],
  product_name: [
    "product name",
    "item name",
    "product",
    "title",
    "description",
    "name",
  ],
  quantity: ["quantity", "stock", "available", "qty", "inventory", "units"],
  unit_price: [
    "unit price",
    "unit cost",
    "price",
    "price eur",
    "cost eur",
    "cost",
  ],
  restock_date: [
    "restock date",
    "eta",
    "available on",
    "arrival date",
    "delivery date",
  ],
  category: ["category", "group", "department", "type"],
};
const normalizeHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function localPlan(dataset: Dataset, contract = CONTRACT): Plan {
  const used = new Set<string>();
  return {
    version: 1,
    mappings: contract.map((field) => {
      const exact = dataset.headers.filter(
        (h) => normalizeHeader(h) === normalizeHeader(field.key),
      );
      const alternatives = exact.length
        ? exact
        : dataset.headers.filter((h) =>
            (synonyms[field.key] || []).includes(normalizeHeader(h)),
          );
      const source =
        alternatives.length === 1 && !used.has(alternatives[0])
          ? alternatives[0]
          : null;
      if (source) used.add(source);
      return {
        target: field.key,
        source,
        trim: true,
        casing: "keep",
        decimal: field.type === "decimal" ? "unconfirmed" : "dot",
        dateOrder: "reject",
        aliases: {},
      };
    }),
  };
}

export function validatePlan(
  input: unknown,
  dataset: Pick<Dataset, "headers">,
  contract = CONTRACT,
): Plan {
  const plan = planSchema.parse(input);
  if (plan.mappings.length !== contract.length)
    throw new Error("The recipe must map every target field exactly once.");
  const targets = new Set(plan.mappings.map((m) => m.target));
  if (
    targets.size !== contract.length ||
    contract.some((f) => !targets.has(f.key))
  )
    throw new Error("Unknown or duplicate target field in recipe.");
  for (const m of plan.mappings) {
    if (m.source !== null && !dataset.headers.includes(m.source))
      throw new Error(`Unknown source column: ${m.source}`);
    const field = contract.find((f) => f.key === m.target)!;
    if (Object.keys(m.aliases).length > 100)
      throw new Error("Too many aliases in a mapping.");
    if (Object.keys(m.aliases).length && field.type !== "enum")
      throw new Error(
        "Aliases are allowed only for explicit category mappings.",
      );
    if (
      Object.values(m.aliases).some((value) => !field.allowed?.includes(value))
    )
      throw new Error("An alias points outside the allowed categories.");
    if (field.type !== "text" && field.type !== "enum" && m.casing !== "keep")
      throw new Error("Case changes apply only to text fields.");
  }
  return plan;
}

export function decimalValue(
  raw: string,
  locale: "dot" | "comma",
  currency?: string,
): string {
  let value = raw;
  if (currency === "EUR")
    value = value.replace(/^(?:EUR\s*|€\s*)/i, "").replace(/\s*EUR$/i, "");
  const dot = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  const comma = /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/;
  if (!(locale === "dot" ? dot : comma).test(value))
    throw new Error(
      `Use ${locale === "dot" ? "1,234.56" : "1.234,56"} notation; currency must match the contract.`,
    );
  value =
    locale === "dot"
      ? value.replace(/,/g, "")
      : value.replace(/\./g, "").replace(",", ".");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > 2)
    throw new Error(
      "More than two decimal places. No automatic rounding is allowed.",
    );
  if (whole.replace(/^0+/, "").length > 14)
    throw new Error("Amount is too large for this import contract.");
  const cents =
    BigInt(whole) * 100n + BigInt((significantFraction + "00").slice(0, 2));
  return `${negative && cents !== 0n ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function dateValue(value: string, order: Mapping["dateOrder"]): string {
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const short = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (iso) [, year, month, day] = iso.map(Number);
  else if (short) {
    const a = Number(short[1]),
      b = Number(short[2]);
    year = Number(short[3]);
    if (order === "reject" && a <= 12 && b <= 12 && a !== b)
      throw new Error("Ambiguous day/month. Choose DMY or MDY explicitly.");
    if (order === "DMY" || (order === "reject" && a > 12)) {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
  } else throw new Error("Use YYYY-MM-DD or a declared day/month convention.");
  if (
    year! < 1900 ||
    year! > 2199 ||
    month! < 1 ||
    month! > 12 ||
    day! < 1 ||
    day! > new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  )
    throw new Error("This is not a valid calendar date between 1900 and 2199.");
  return `${year!}-${String(month!).padStart(2, "0")}-${String(day!).padStart(2, "0")}`;
}

function convert(raw: string, mapping: Mapping, field: Field) {
  let value = raw;
  const steps: string[] = [];
  const update = (next: string, step: string) => {
    if (next !== value) {
      steps.push(step);
      value = next;
    }
  };
  if (mapping.trim) update(value.trim(), "Trim surrounding whitespace");
  if (mapping.casing === "lower")
    update(value.toLowerCase(), "Convert to lowercase");
  if (mapping.casing === "upper")
    update(value.toUpperCase(), "Convert to uppercase");
  if (field.type === "enum" && Object.hasOwn(mapping.aliases, value))
    update(mapping.aliases[value], `Apply reviewed alias “${value}”`);
  if (field.required && !value.trim())
    throw new Error("Required value is missing.");
  if (!value) {
    if (field.required) throw new Error("Required value is missing.");
    return { value, steps };
  }
  if (field.type === "integer") {
    if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error(
        "A safe whole number is required; decimals and text are not guessed.",
      );
    if (field.min !== undefined && Number(value) < field.min)
      throw new Error(`Must be ${field.min} or greater.`);
    update(String(Number(value)), "Normalize whole number");
  } else if (field.type === "decimal") {
    if (mapping.decimal === "unconfirmed")
      throw new Error(
        "Choose a number convention for this column before importing any prices.",
      );
    update(
      decimalValue(value, mapping.decimal, field.currency),
      `Parse ${mapping.decimal}-decimal amount exactly`,
    );
    if (field.min === 0 && value.startsWith("-"))
      throw new Error("Must be zero or greater.");
  } else if (field.type === "date")
    update(
      dateValue(value, mapping.dateOrder),
      "Convert validated date to ISO",
    );
  else if (field.type === "enum" && !field.allowed?.includes(value))
    throw new Error(
      `Choose an explicit alias to ${field.allowed?.join(", ")}.`,
    );
  return { value, steps };
}

export function evaluate(
  dataset: Dataset,
  candidate: Plan,
  resolutions: Resolution[] = [],
  contract = CONTRACT,
): Evaluation {
  const plan = validatePlan(candidate, dataset, contract);
  const overrides = new Map<string, Resolution>();
  for (const r of resolutions) {
    if (
      !Number.isInteger(r.row) ||
      r.row < 1 ||
      r.row > dataset.rows.length ||
      !contract.some((f) => f.key === r.field) ||
      typeof r.value !== "string" ||
      !r.reason?.trim()
    )
      throw new Error(
        "Each resolution needs a real data row, target field, string value and reason.",
      );
    const k = `${r.row}:${r.field}`;
    if (overrides.has(k))
      throw new Error("Duplicate resolution for the same cell.");
    overrides.set(k, r);
  }
  const rows: RowResult[] = dataset.rows.map((row, rowIndex) => {
    const issues: Issue[] = [],
      traces: CellTrace[] = [],
      values: Record<string, string> = Object.create(null);
    for (const field of contract) {
      const mapping = plan.mappings.find((m) => m.target === field.key)!;
      const original =
        mapping.source === null
          ? ""
          : row[dataset.headers.indexOf(mapping.source)];
      const override = overrides.get(`${rowIndex + 1}:${field.key}`);
      // Reviewed values are canonical target values: source-locale transforms must not be applied twice.
      const canonical: Mapping = {
        ...mapping,
        trim: false,
        casing: "keep",
        decimal: "dot",
        dateOrder: "reject",
        aliases: {},
      };
      let converted = {
        value: override?.value ?? original,
        steps: [] as string[],
      };
      try {
        if (mapping.source === null && field.required && !override)
          throw new Error("Map this required target field to a source column.");
        converted = convert(
          override?.value ?? original,
          override ? canonical : mapping,
          field,
        );
      } catch (error) {
        issues.push({
          field: field.key,
          code:
            mapping.source === null && !override
              ? "unmapped"
              : !converted.value.trim()
                ? "missing"
                : field.type === "decimal" && mapping.decimal === "unconfirmed"
                  ? "unconfirmed_number"
                  : field.type === "date" &&
                      (error as Error).message.startsWith("Ambiguous")
                    ? "ambiguous_date"
                    : `invalid_${field.type}`,
          message: (error as Error).message,
        });
      }
      values[field.key] = converted.value;
      traces.push({
        field: field.key,
        source: mapping.source,
        original,
        output: converted.value,
        overridden: !!override,
        steps: override
          ? [`Reviewed correction: ${override.reason}`, ...converted.steps]
          : converted.steps,
      });
    }
    return {
      row: rowIndex + 1,
      values,
      issues,
      traces,
      changed: traces.some((t) => t.original !== t.output),
      accepted: false,
    };
  });
  // Quarantine every duplicate, not an arbitrary first/last row. No silent data loss.
  for (const field of contract.filter((f) => f.unique)) {
    const seen = new Map<string, RowResult[]>();
    for (const row of rows) {
      const key = row.values[field.key];
      if (key && !row.issues.some((i) => i.field === field.key))
        seen.set(key, [...(seen.get(key) || []), row]);
    }
    for (const group of seen.values())
      if (group.length > 1)
        for (const row of group)
          row.issues.push({
            field: field.key,
            code: "duplicate",
            message: `Duplicate key in data rows ${group.map((r) => r.row).join(", ")}. All copies held for review.`,
          });
  }
  const issueCounts: Record<string, number> = Object.create(null);
  for (const row of rows) {
    row.accepted = row.issues.length === 0;
    for (const issue of row.issues)
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
  }
  return {
    rows,
    accepted: rows.filter((r) => r.accepted).length,
    rejected: rows.filter((r) => !r.accepted).length,
    changed: rows.filter((r) => r.changed).length,
    changes: rows.reduce(
      (s, r) => s + r.traces.filter((t) => t.original !== t.output).length,
      0,
    ),
    issues: rows.reduce((s, r) => s + r.issues.length, 0),
    issueCounts,
  };
}

export function profile(dataset: Dataset, shareSamples = false) {
  return {
    rowCount: dataset.rows.length,
    columns: dataset.headers.map((name, i) => {
      const values = dataset.rows.map((row) => row[i]);
      const nonempty = values.filter((v) => v.trim());
      return {
        name,
        empty: values.length - nonempty.length,
        distinct: new Set(values).size,
        patterns: {
          integer: nonempty.filter((v) => /^[+-]?\d+$/.test(v.trim())).length,
          isoDate: nonempty.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))
            .length,
          slashDate: nonempty.filter((v) =>
            /^\d{1,2}[/]\d{1,2}[/]\d{4}$/.test(v.trim()),
          ).length,
        },
        ...(shareSamples
          ? {
              examples: [...new Set(nonempty)]
                .slice(0, 3)
                .map((v) => v.slice(0, 160)),
            }
          : {}),
      };
    }),
  };
}

export function safeCSV(headers: string[], rows: string[][]): string {
  const neutralize = (v: string) =>
    /^[\s\uFEFF]*[=+\-@]/u.test(v) || /^[\t\r\n]/.test(v) ? `'${v}` : v;
  return Papa.unparse(
    [headers.map(neutralize), ...rows.map((row) => row.map(neutralize))],
    { newline: "\r\n" },
  );
}
