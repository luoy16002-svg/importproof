# Validation evidence — 2026-09-24

## Automated correctness

`npm test`: 47 passed, 0 failed. Tests exercise malformed CSV, multiline/quoted data, exact large monetary strings, refusing scientific notation and wrong currencies, calendar validity, ambiguous day/month dates, every-copy duplicate quarantine, canonical user corrections, nonmutating evaluation, formula-safe CSV and independently re-created export contents. Provider tests use explicitly labelled mock responses to verify consent minimization, schema rejection, refusal/truncation handling and failure isolation; these are **not real model calls**.

`npm run benchmark`: 2,000 seeded synthetic records split between dot and comma decimal conventions, with supplied correct mappings. Each 1,000-row case contains 694 valid rows and 306 faults/duplicate-associated rows. The result matches every expected row decision and every accepted target value. No silent row loss. This is engine evaluation, not AI accuracy or customer impact. Timing is a single local run, not a comparative performance study.

`npm run replay -- artifacts/demo-bundle`: passed, 22 accepted / 10 held, original source and canonical hashes match.

## Actual Chrome interaction

Tested the app at http://127.0.0.1:5187 in a real browser; screenshots inspected at the default desktop viewport and a temporary 390×844 viewport, then viewport override reset.

1. Default synthetic fixture: 32 source rows, 22 accepted, 10 held, 34 cell changes.
2. Resolve row 5 date to 2026-10-04 with an explicitly synthetic test explanation: 23 accepted / 9 held. Undo restores 22 / 10.
3. Resolve row 6 quantity to 3.5: row remains held. The inspector retains both `three` and `3.5` and the reason. Undo restores the original. Correct to 3 with a test explanation: the row passes.
4. Choose DMY for the date column and an explicit `lamps=lighting` alias: 25 accepted / 7 held.
5. Change the second duplicate identifier to AC-013 with a test explanation: both affected rows revalidate, giving 27 accepted / 5 held.
6. Search for an absent value: proper empty state, 0 rows, disabled page controls; restore all rows.
7. Paste malformed CSV with duplicate headers: clear error, old source remains intact.
8. Real file chooser import of `artifacts/utf8-bom-test.csv`: two records with BOM, a quoted comma, `Café`, leading-zero identifiers and literal formula-looking text. Until number convention is chosen, 0 accepted / 2 held. Choose dot decimal: 2 / 0.
9. Click Export bundle. The browser event observer timed out, but the actual file **was downloaded** to `C:/Users/fuddl/Downloads/utf8-bom-test-review.zip` (2,966 bytes). File readback, extraction and independent replay were performed; success is based on the real artifact, not the click or event observer.
10. Actual browser bundle in `artifacts/browser-export-bom/` replays successfully. Original file and exported original.txt both have SHA-256 `8cb9d87cd0cdb6305eb1a37cd1b3dbd8c706ec1d71ac4d1851c8e3a15fdd3a2e`. The literal `=1+1` is exported as `'=1+1` in CSV and preserved exactly in canonical JSON. Both leading-zero identifiers remain strings.
11. At mobile width the page has no horizontal body overflow (document clientWidth and body scrollWidth were both 375, within a 390px browser viewport with scrollbar). The data table has its own deliberate horizontal scroll. Rule inputs stack correctly. Desktop sample restored afterwards.
12. The live model button is disabled and labelled “Live model not configured”; no fabricated inference result is shown.

## Not verified / not completed

- Actual Nebius model invocation, credits, model choice and model-mapping effectiveness are not verified.
- Event entry, public video, judging and payment are not complete.
- No real customer dataset or live inventory system has been tested. Only the documented inventory schema is supported.
- No claim of general spreadsheet correctness, universal CSV compatibility, conversion truth or competitive prize ranking.
