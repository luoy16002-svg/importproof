# ImportProof

**Verify a CSV before importing it.** ImportProof is a local inventory-data workbench with explicit mappings, exact decimal handling, exception review, reversible decisions and an independently replayable audit bundle.

This is an original AI-assisted project developed for consideration in the Nebius × NVIDIA Global AI Hackathon. It has **not been registered or submitted**. The live Nebius integration is implemented but **has not yet been exercised with real credentials**; local matching is visibly labelled and is not presented as a model response. No award or revenue is claimed.

## Run locally

Node.js 24 or later. No paid service or API key is needed for the entire local workflow.

```sh
npm ci
npm run server
# In another terminal:
npm run dev
```

Open http://127.0.0.1:5187. For a production build, run `npm run build` and `npm run server`, then open http://127.0.0.1:5188. The server binds only to loopback.

## What works

- UTF-8 CSV/TSV import, quoting, multiline fields, BOM preservation, clear rejection of malformed records; 5 MB / 20,000 row / 50 column cap.
- Six-field EUR inventory contract: SKU, product name, nonnegative whole quantity, exact two-decimal price, optional restock date and an allowed category.
- Conservative local header matching. Price convention must be explicitly chosen. Ambiguous dates are held until the day/month order is declared. No FX conversion, inferred quantities or silent rounding.
- Every duplicate SKU is held, including its first copy. Correcting one identifier revalidates all affected rows.
- Before/after inspection, searchable filtered views, per-cell lineage and reviewed cell corrections with a required explanation. Undo the last 30 changes.
- ZIP export with accepted.csv, rejected.csv, exact canonical.json, original.txt, recipe.json, lineage.json and manifest.json. CSV formula characters are neutralized; exact strings remain in canonical.json.
- Recipe loading verifies the source hash when present. The CLI independently replays a bundle and checks its hashes, canonical output and row counts.

## Optional model proposal

Copy `.env.example` to `.env`, configure a verified NVIDIA open-model ID from your Nebius Token Factory catalog and a server-side key, and enable `ENABLE_NEBIUS=1` **only after free credits and billing are checked**. No key is embedded in the client, committed, stored in a browser or included in an export. Hosted model access is not needed for local use.

The runtime uses Nebius's official OpenAI-compatible endpoint, requesting a JSON mapping plan. It sends the contract, column headers and aggregate profiles. Raw values are excluded by default; a separate checkbox permits at most three short examples per source column. The server strips examples if consent is false, even if an incorrect client sends them. Names of source columns may themselves be confidential, so do not request a hosted proposal for data you cannot share.

All model output is untrusted. Unknown columns, targets, unsupported operations, invalid aliases, malformed or truncated responses are rejected. No generated code, SQL or row values are executed. A valid proposal is shown with a preview and must be explicitly applied. The server permits only one model request at a time, stores a persistent request count and stops at its configured cap. This cap is a local safeguard, **not a guarantee about provider charges**. Failed requests consume a slot. No automatic retry.

## Verify and replay

```sh
npm test
npm run build
npm run benchmark
npm run replay -- artifacts/demo-bundle
```

The evaluation corpus is synthetic and seeded. Two independently generated source conventions have 1,000 rows each, with known valid target strings and known injected faults. It measures deterministic engine correctness with a supplied recipe; it does **not** establish model superiority, user adoption or prize competitiveness. Full results are in `artifacts/engine-evaluation.json`.

## Limits and privacy

- This version targets the one documented inventory contract. It is not a general spreadsheet or accounting system.
- All data and corrections live in browser memory. Export before closing or replacing a session. No browser storage, analytics or automatic upload.
- A reviewed correction is a user's assertion, not independent evidence of the supplier's truth. Passing a schema does not prove that a real inventory is accurate.
- An optional missing source field maps to blank. Unmapped required fields are blocked. Row numbers are **data-record numbers**, not physical line numbers for multiline CSV.
- Hashes check byte equality and replay consistency; they do not establish authorship or data authenticity.
- Exported bundles include the original data. Keep them private when your source is private.

## Architecture

`src/engine.ts` — pure parser, typed recipe, exact conversion, quarantine and lineage.
`src/export.ts` — local hashes and deterministic replay material.
`src/main.tsx` — React workbench with manual and proposed-rule review.
`server/model.ts` — profile validation, consent minimization, one inference call and strict output validation.
`server/index.ts` — local API/static host, origin checks and persistent request cap.
`scripts/replay.ts` — file-based verifier; no browser or model required.

## Attribution and license

Original code and synthetic sample data: KAI CHEN, 2026, with disclosed AI assistance. MIT License. Uses React (MIT), Papa Parse (MIT), fflate (MIT), Zod (MIT), Phosphor icons (MIT), Vite (MIT) and TypeScript (Apache-2.0). No unlicensed artwork, copied customer data or sponsor logos are included. Source APIs are documented at https://docs.tokenfactory.nebius.com/quickstart and https://docs.tokenfactory.nebius.com/ai-models-inference/json.
