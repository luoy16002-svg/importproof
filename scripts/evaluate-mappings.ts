import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import {
  localPlan,
  parseCSV,
  profile,
  validatePlan,
  type Plan,
} from "../src/engine";
import { mappingCases } from "./mapping-cases";

const args = process.argv.slice(2);
const live = args.includes("--live");
const caseFlag = args.indexOf("--case");
const requestedCase = caseFlag < 0 ? undefined : args[caseFlag + 1];
const permitted = new Set(["--live", "--case", requestedCase].filter(Boolean));
if (
  args.some((arg) => !permitted.has(arg)) ||
  (caseFlag >= 0 && !requestedCase)
)
  throw new Error("Usage: npm run evaluate:mappings -- [--case ID] [--live]");
const cases = requestedCase
  ? mappingCases.filter((c) => c.id === requestedCase)
  : mappingCases;
if (!cases.length)
  throw new Error("Unknown case. Read scripts/mapping-cases.ts for IDs.");

function score(expected: Record<string, string | null>, plan: Plan) {
  const fields = Object.entries(expected).map(([target, source]) => {
    const proposed =
      plan.mappings.find((mapping) => mapping.target === target)?.source ??
      null;
    const outcome =
      source === proposed
        ? source === null
          ? "correct_abstention"
          : "correct_mapping"
        : proposed === null
          ? "unresolved_mapping"
          : "wrong_nonnull_mapping";
    return { target, expected: source, proposed, outcome };
  });
  return {
    fields,
    correctMappings: fields.filter((f) => f.outcome === "correct_mapping")
      .length,
    correctAbstentions: fields.filter((f) => f.outcome === "correct_abstention")
      .length,
    unresolvedMappings: fields.filter((f) => f.outcome === "unresolved_mapping")
      .length,
    wrongNonNullMappings: fields.filter(
      (f) => f.outcome === "wrong_nonnull_mapping",
    ).length,
  };
}

if (live) {
  const response = await fetch("http://127.0.0.1:5188/api/status", {
    signal: AbortSignal.timeout(5000),
  });
  const status = (await response.json()) as {
    configured?: boolean;
    remainingCalls?: number;
  };
  if (
    !response.ok ||
    !status.configured ||
    (status.remainingCalls ?? 0) < cases.length
  )
    throw new Error(
      "Live evaluation requires an enabled local server and enough remaining capped calls. Check free credits and model access before enabling it.",
    );
}
const results: unknown[] = [];
let proposalRequestsAttempted = 0;
let stoppedAfterFailure = false;
for (const item of cases) {
  const data = parseCSV(
    Papa.unparse([item.headers, ...item.rows]),
    `${item.id}.csv`,
  );
  const baseline = score(item.expected, localPlan(data));
  let model: unknown = null;
  if (live) {
    try {
      // Use the app server so persistent quota, strict schema and one-call-at-a-time
      // behavior are identical to the workbench. No API key is read by this script.
      proposalRequestsAttempted++;
      const response = await fetch("http://127.0.0.1:5188/api/propose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:5187",
        },
        body: JSON.stringify({
          profile: profile(data, false),
          shareSamples: false,
        }),
        signal: AbortSignal.timeout(40000),
      });
      const result = (await response.json()) as {
        plan?: unknown;
        model?: string;
        latencyMs?: number;
        usage?: unknown;
        sampleCount?: number;
        error?: string;
      };
      if (response.ok && result.plan) {
        model = {
          ...score(item.expected, validatePlan(result.plan, data)),
          model: result.model,
          latencyMs: result.latencyMs,
          usage: result.usage,
          sampleCount: result.sampleCount,
        };
      } else {
        model = {
          failed: true,
          status: response.status,
          error: result.error ?? "No validated recipe returned",
        };
        stoppedAfterFailure = true;
      }
    } catch (error) {
      model = {
        failed: true,
        error: error instanceof Error ? error.message : "Request failed",
      };
      stoppedAfterFailure = true;
    }
  }
  results.push({ id: item.id, group: item.group, baseline, model });
  // Do not retry a provider/network failure across the remaining fixtures.
  if (stoppedAfterFailure) break;
}
const timestamp = new Date().toISOString();
const report = {
  generatedAt: timestamp,
  fixtureSha256: createHash("sha256")
    .update(JSON.stringify(mappingCases))
    .digest("hex"),
  source:
    "Eight hand-authored synthetic cases fixed before any real model response; not an independent, randomized or customer dataset.",
  scope:
    "Scores source-column selection only, with no raw sample values. Correct abstention, unresolved mapping and wrong non-null mapping are reported separately. Does not measure locale inference, aliases or accepted-row correctness. Never tune the model prompt or synonyms against this set without disclosing it.",
  mode: live
    ? "real_nebius_via_capped_local_server"
    : "baseline_only_no_network_calls",
  casesPlanned: cases.length,
  proposalRequestsAttempted,
  stoppedAfterFailure,
  results,
};
mkdirSync("artifacts", { recursive: true });
const output = live
  ? `artifacts/mapping-live-${timestamp.replace(/[:.]/g, "-")}.json`
  : "artifacts/mapping-baseline.json";
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Saved ${output}`);
if (stoppedAfterFailure) process.exitCode = 1;
