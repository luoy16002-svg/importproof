/** A small, hand-authored challenge set, frozen before any real model response.
 * It is not an unbiased sample of supplier files or a customer benchmark.
 * Only source-column selection is scored. Locale choices and row correctness
 * are separate questions and must not be inferred from this score.
 */
export type MappingCase = {
  id: string;
  group: "familiar" | "semantic" | "abstention";
  headers: string[];
  rows: string[][];
  expected: Record<string, string | null>;
};

const targets = [
  "sku",
  "product_name",
  "quantity",
  "unit_price",
  "restock_date",
  "category",
];
const canonicalRows = [
  ["0001", "Arc lamp", "12", "49.90", "2026-10-04", "lighting"],
  ["0002", "Oak desk", "8", "129.00", "2026-10-08", "furniture"],
];
function named(
  id: string,
  group: MappingCase["group"],
  headers: string[],
): MappingCase {
  return {
    id,
    group,
    headers,
    rows: canonicalRows.map((row) => [...row]),
    expected: Object.fromEntries(targets.map((key, i) => [key, headers[i]])),
  };
}
const reorderedHeaders = [
  "Group",
  "Cost (EUR)",
  "Item code",
  "ETA",
  "Available",
  "Item name",
];
export const mappingCases: MappingCase[] = [
  named("canonical", "familiar", [...targets]),
  {
    id: "reordered-aliases",
    group: "familiar",
    headers: reorderedHeaders,
    rows: canonicalRows.map((row) => [
      row[5],
      row[3],
      row[0],
      row[4],
      row[2],
      row[1],
    ]),
    expected: {
      sku: "Item code",
      product_name: "Item name",
      quantity: "Available",
      unit_price: "Cost (EUR)",
      restock_date: "ETA",
      category: "Group",
    },
  },
  named("french-inventory", "semantic", [
    "Référence produit",
    "Nom du produit",
    "Quantité en stock",
    "Prix unitaire EUR",
    "Date de réapprovisionnement",
    "Catégorie",
  ]),
  named("german-inventory", "semantic", [
    "Artikelnummer",
    "Produktname",
    "Lagerbestand",
    "Stückpreis EUR",
    "Nachlieferdatum",
    "Produktkategorie",
  ]),
  named("chinese-inventory", "semantic", [
    "商品编码",
    "商品名称",
    "库存数量",
    "单价（欧元）",
    "补货日期",
    "商品类别",
  ]),
  named("warehouse-wording", "semantic", [
    "Stock keeping identifier",
    "Merchandise label",
    "Units currently on hand",
    "Per-item selling price in euros",
    "Next replenishment date",
    "Merchandise category",
  ]),
  {
    id: "missing-optional-date",
    group: "abstention",
    headers: ["sku", "product_name", "quantity", "unit_price", "category"],
    rows: canonicalRows.map((row) => [row[0], row[1], row[2], row[3], row[5]]),
    expected: {
      sku: "sku",
      product_name: "product_name",
      quantity: "quantity",
      unit_price: "unit_price",
      restock_date: null,
      category: "category",
    },
  },
  {
    id: "opaque-columns",
    group: "abstention",
    headers: ["A", "B", "C", "D", "E", "F"],
    // All-text profiles deliberately provide no evidence of field semantics.
    rows: [
      ["x1", "x2", "x3", "x4", "x5", "x6"],
      ["y1", "y2", "y3", "y4", "y5", "y6"],
    ],
    expected: Object.fromEntries(targets.map((key) => [key, null])),
  },
];
