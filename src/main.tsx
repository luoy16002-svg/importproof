import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowRight,
  ArrowSquareOut,
  ArrowUUpLeft,
  Check,
  CheckCircle,
  Clock,
  Columns,
  DownloadSimple,
  FileCsv,
  FileText,
  FunnelSimple,
  Info,
  ListChecks,
  MagnifyingGlass,
  ShieldCheck,
  Sparkle,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  CONTRACT,
  evaluate,
  localPlan,
  parseCSV,
  profile,
  validatePlan,
  type Dataset,
  type Mapping,
  type Plan,
  type Resolution,
} from "./engine";
import { DEMO_CSV, loadDemo } from "./demo";
import { createBundle, hashText } from "./export";
import "./style.css";

const initial = loadDemo();
const labels: Record<string, string> = {
  unconfirmed_number: "Number convention not confirmed",
  ambiguous_date: "Ambiguous dates",
  duplicate: "Duplicate identifiers",
  invalid_integer: "Invalid quantities",
  invalid_decimal: "Invalid prices",
  invalid_enum: "Unknown categories",
  missing: "Missing values",
  invalid_date: "Invalid dates",
  unmapped: "Unmapped fields",
  invalid_text: "Invalid text",
};
const compactName = (s: string) => s.replace(/\.csv$/i, "");
function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob(
    [typeof bytes === "string" ? bytes : (bytes.slice().buffer as ArrayBuffer)],
    { type },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title">
      <div className="dialog-top">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={() => ref.current?.close()}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [data, setData] = useState<Dataset>(initial.data),
    [plan, setPlan] = useState<Plan>(initial.plan);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [history, setHistory] = useState<
    { plan: Plan; resolutions: Resolution[] }[]
  >([]);
  const [view, setView] = useState<"workbench" | "recipe" | "audit">(
    "workbench",
  );
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(5);
  const [sourceView, setSourceView] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [dialog, setDialog] = useState<"import" | "guide" | null>(null),
    [pasted, setPasted] = useState("");
  const [importName, setImportName] = useState("my-inventory.csv"),
    [synthetic, setSynthetic] = useState(true);
  const [correction, setCorrection] = useState({
    field: "restock_date",
    value: "",
    reason: "",
  });
  const [shareSamples, setShareSamples] = useState(false),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string | null;
    remainingCalls: number;
  } | null>(null);
  const [proposal, setProposal] = useState<{
    plan: Plan;
    model: string;
    latencyMs: number;
    sampleCount: number;
    usage: { inputTokens: number | null; outputTokens: number | null };
  } | null>(null);
  const [modelReceipt, setModelReceipt] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null),
    recipeRef = useRef<HTMLInputElement>(null);
  const result = useMemo(
    () => evaluate(data, plan, resolutions),
    [data, plan, resolutions],
  );
  const row = result.rows.find((r) => r.row === selected) || result.rows[0];
  const visible = useMemo(
    () =>
      result.rows.filter(
        (r) =>
          (filter === "all" ||
            (filter === "review" && !r.accepted) ||
            (filter === "accepted" && r.accepted) ||
            (filter === "changed" && r.changed)) &&
          (!search ||
            [
              String(r.row),
              ...Object.values(r.values),
              ...r.issues.map((i) => i.message),
            ].some((v) => v.toLowerCase().includes(search.toLowerCase()))),
      ),
    [result, filter, search],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / 12));
  const displayPage = Math.min(page, pageCount - 1);
  const shown = visible.slice(displayPage * 12, displayPage * 12 + 12);
  const beforeStats = useMemo(() => evaluate(data, localPlan(data)), [data]);
  useEffect(() => {
    if (!["127.0.0.1", "localhost"].includes(window.location.hostname)) return;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const checkpoint = () =>
    setHistory((h) => [
      ...h.slice(-29),
      {
        plan: structuredClone(plan),
        resolutions: structuredClone(resolutions),
      },
    ]);
  const changeMapping = (key: string, patch: Partial<Mapping>) => {
    checkpoint();
    setPlan((p) => ({
      ...p,
      mappings: p.mappings.map((m) =>
        m.target === key ? { ...m, ...patch } : m,
      ),
    }));
    setProposal(null);
    setModelReceipt("");
  };
  function undo() {
    const prior = history.at(-1);
    if (!prior) return;
    setPlan(prior.plan);
    setResolutions(prior.resolutions);
    setHistory((h) => h.slice(0, -1));
    setProposal(null);
    setModelReceipt("");
    setNotice("Last change undone.");
  }
  function importText(text: string, name: string) {
    try {
      const next = parseCSV(text, name);
      setData(next);
      setPlan(localPlan(next));
      setResolutions([]);
      setHistory([]);
      setProposal(null);
      setModelReceipt("");
      setSelected(1);
      setPage(0);
      setFilter("all");
      setSearch("");
      setSynthetic(false);
      setError("");
      setDialog(null);
      setView("recipe");
      setNotice(
        "File opened locally. Review its column mappings and number conventions.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000) {
      setError("Use a CSV file smaller than 5 MB.");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      importText(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
        file.name,
      );
    } catch {
      setError(
        "This file is not valid UTF-8 text. Export it as UTF-8 CSV and try again.",
      );
    }
  }
  function restoreDemo() {
    const demo = loadDemo();
    setData(demo.data);
    setPlan(demo.plan);
    setResolutions([]);
    setHistory([]);
    setSelected(5);
    setFilter("all");
    setSearch("");
    setPage(0);
    setView("workbench");
    setSynthetic(true);
    setProposal(null);
    setModelReceipt("");
    setError("");
    setNotice(
      "Synthetic sample restored. The comma decimal convention is preselected for this sample.",
    );
  }
  function saveCorrection(event: React.FormEvent) {
    event.preventDefault();
    if (!correction.reason.trim()) return;
    checkpoint();
    setResolutions((current) => [
      ...current.filter(
        (r) => !(r.row === row.row && r.field === correction.field),
      ),
      { row: row.row, ...correction, reason: correction.reason.trim() },
    ]);
    setNotice(`Data row ${row.row}: correction recorded and revalidated.`);
    setCorrection((c) => ({ ...c, value: "", reason: "" }));
  }
  async function exportBundle() {
    setExporting(true);
    setError("");
    try {
      const bundle = await createBundle(data, plan, resolutions);
      download(
        bundle.zip,
        `${compactName(data.name)}-review.zip`,
        "application/zip",
      );
      setNotice(
        `Exported ${result.accepted} accepted rows, ${result.rejected} held rows, recipe and full audit trail.`,
      );
    } catch {
      setError(
        "Export failed. Your current review is still available; try again.",
      );
    } finally {
      setExporting(false);
    }
  }
  async function askModel() {
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      const response = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(35000),
        body: JSON.stringify({
          profile: profile(data, shareSamples),
          shareSamples,
        }),
      });
      const answer = await response.json();
      if (!response.ok)
        throw new Error(answer.error || "No proposal was produced.");
      answer.plan = validatePlan(answer.plan, data);
      setProposal(answer);
      setStatus((current) =>
        current
          ? {
              ...current,
              remainingCalls: Math.max(0, current.remainingCalls - 1),
            }
          : current,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Proposal failed. No recipe applied.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadRecipe(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("Recipe file is too large.");
      return;
    }
    try {
      const value = JSON.parse(await file.text());
      const candidate = validatePlan(value.plan || value, data);
      const corrections = value.resolutions || [];
      if (value.sourceSha256) {
        if (value.sourceSha256 !== (await hashText(data.text)))
          throw new Error(
            "This recipe belongs to a different source file. Its hash does not match.",
          );
      }
      evaluate(data, candidate, corrections);
      checkpoint();
      setPlan(candidate);
      setResolutions(corrections);
      setProposal(null);
      setModelReceipt("");
      setError("");
      setNotice("Recipe loaded and validated against this source.");
    } catch (e) {
      setError(`Recipe was not applied: ${(e as Error).message}`);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("workbench");
          }}
        >
          <span className="brand-mark">
            <ListChecks weight="bold" />
          </span>
          <span>
            Import<span className="brand-light">Proof</span>
          </span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Workspace">
          <button
            className={view === "workbench" ? "active" : ""}
            onClick={() => setView("workbench")}
          >
            <Columns /> Review data <span>{result.rejected || <Check />}</span>
          </button>
          <button
            className={view === "recipe" ? "active" : ""}
            onClick={() => setView("recipe")}
          >
            <ListChecks /> Mapping recipe <span>{CONTRACT.length}</span>
          </button>
          <button
            className={view === "audit" ? "active" : ""}
            onClick={() => setView("audit")}
          >
            <ShieldCheck /> Audit trail
          </button>
        </nav>
        <div className="sidebar-file">
          <FileCsv weight="duotone" />
          <strong>Inventory import</strong>
          <span>
            {data.rows.length} source rows · {data.headers.length} columns
          </span>
          <div className="file-line">
            <i />
            <span>Local, in-memory session</span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setDialog("guide")}>
            <Info /> How this works
          </button>
          <div className="local-note">
            <ShieldCheck size={19} />
            <p>
              Your CSV stays here.
              <br />
              <span>Model proposals are optional.</span>
            </p>
          </div>
          <span className="version">IMPORTPROOF / 0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <span className="slash">/</span>
            <strong>Inventory import</strong>
          </div>
          <div className="session-status">
            <span className="status-dot" /> Local workspace{" "}
            <span className="avatar">IP</span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">VERIFY BEFORE YOU IMPORT</div>
              <h1>
                {view === "workbench"
                  ? "Every row. Accounted for."
                  : view === "recipe"
                    ? "Make the rules explicit."
                    : "A handoff you can retrace."}
              </h1>
              <p>
                {view === "workbench"
                  ? "Review the changes. Resolve the exceptions. Export with a complete trail."
                  : view === "recipe"
                    ? "A mapping is a proposal. You choose the conventions before data moves."
                    : "Original values, reviewed decisions and an independently replayable recipe."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                onClick={() => {
                  setPasted("");
                  setError("");
                  setDialog("import");
                }}
              >
                <UploadSimple /> Open CSV
              </button>
              <button
                className="button primary"
                onClick={exportBundle}
                disabled={exporting}
              >
                {exporting ? <Clock /> : <DownloadSimple />}{" "}
                {exporting ? "Preparing…" : "Export bundle"}
              </button>
            </div>
          </section>
          {error && (
            <div className="alert error" role="alert">
              <WarningCircle />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCircle />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X />
              </button>
            </div>
          )}
          <div className="source-bar">
            <div className="source-file">
              <FileCsv />
              <div>
                <strong>{data.name}</strong>
                <span>
                  {synthetic
                    ? "Synthetic sample · no customer data"
                    : "Opened locally · session is not saved automatically"}
                </span>
              </div>
            </div>
            <div className="source-tools">
              <span className="contract-tag">Inventory / EUR</span>
              <button className="text-button" onClick={restoreDemo}>
                Reset sample
              </button>
            </div>
          </div>
          <section className="metrics" aria-label="Import validation summary">
            <div className="metric">
              <span>
                <i className="dot good" />
                Ready to import
              </span>
              <strong>
                {result.accepted}
                <small> / {data.rows.length}</small>
              </strong>
              <div
                className="meter"
                aria-label={`${result.accepted} accepted, ${result.rejected} need review`}
              >
                <i
                  style={{
                    width: `${(result.accepted / data.rows.length) * 100}%`,
                  }}
                />
              </div>
            </div>
            <div className="metric">
              <span>
                <i className="dot warn" />
                Needs your review
              </span>
              <strong>
                {result.rejected}
                <small> rows</small>
              </strong>
              <p>Held out of the accepted export</p>
            </div>
            <div className="metric">
              <span>
                <i className="dot blue" />
                Traceable changes
              </span>
              <strong>
                {result.changes}
                <small> {result.changes === 1 ? "cell" : "cells"}</small>
              </strong>
              <p>Every original value is preserved</p>
            </div>
            <div className="metric conservation">
              <ShieldCheck weight="duotone" />
              <div>
                <strong>No rows lost</strong>
                <span>
                  {result.accepted} accepted + {result.rejected} held ={" "}
                  {data.rows.length}
                </span>
              </div>
            </div>
          </section>
          {view === "workbench" && (
            <>
              <div className="section-title">
                <h2>Review workspace</h2>
                <div className="undo-group">
                  <span>
                    {resolutions.length} reviewed{" "}
                    {resolutions.length === 1 ? "correction" : "corrections"}
                  </span>
                  <button
                    className="text-button"
                    disabled={!history.length}
                    onClick={undo}
                  >
                    <ArrowUUpLeft /> Undo
                  </button>
                </div>
              </div>
              <div className="work-grid">
                <section className="data-panel" aria-label="Data preview">
                  <div className="table-toolbar">
                    <div className="tabs" aria-label="Filter rows">
                      {[
                        ["all", "All rows", data.rows.length],
                        ["review", "Needs review", result.rejected],
                        ["accepted", "Accepted", result.accepted],
                        ["changed", "Changed", result.changed],
                      ].map(([key, label, count]) => (
                        <button
                          key={key}
                          className={filter === key ? "selected" : ""}
                          onClick={() => {
                            setFilter(String(key));
                            setPage(0);
                          }}
                        >
                          {label}
                          <span>{count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="table-subbar">
                    <label className="search">
                      <MagnifyingGlass />
                      <input
                        aria-label="Search rows"
                        placeholder="Search a value or issue…"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(0);
                        }}
                      />
                    </label>
                    <div className="segmented" aria-label="Preview values">
                      <button
                        className={!sourceView ? "selected" : ""}
                        onClick={() => setSourceView(false)}
                      >
                        After
                      </button>
                      <button
                        className={sourceView ? "selected" : ""}
                        onClick={() => setSourceView(true)}
                      >
                        Before
                      </button>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th className="row-number">#</th>
                          <th>Status</th>
                          {CONTRACT.map((f) => (
                            <th
                              key={f.key}
                              className={
                                ["integer", "decimal"].includes(f.type)
                                  ? "numeric"
                                  : ""
                              }
                            >
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <tr
                            key={r.row}
                            className={r.row === row.row ? "chosen" : ""}
                          >
                            <td className="row-number">
                              <button
                                aria-label={`Inspect data row ${r.row}`}
                                onClick={() => {
                                  setSelected(r.row);
                                  setCorrection({
                                    field: r.issues[0]?.field || "product_name",
                                    value: "",
                                    reason: "",
                                  });
                                }}
                              >
                                {r.row}
                              </button>
                            </td>
                            <td>
                              <button
                                className={`row-status ${r.accepted ? "accepted" : "held"}`}
                                onClick={() => {
                                  setSelected(r.row);
                                  setCorrection({
                                    field: r.issues[0]?.field || "product_name",
                                    value: "",
                                    reason: "",
                                  });
                                }}
                                aria-label={`Inspect row ${r.row}, ${r.accepted ? "accepted" : `${r.issues.length} issues`}`}
                              >
                                {r.accepted ? (
                                  <CheckCircle weight="fill" />
                                ) : (
                                  <WarningCircle weight="fill" />
                                )}
                                {r.accepted ? "Ready" : "Review"}
                              </button>
                            </td>
                            {CONTRACT.map((f) => {
                              const trace = r.traces.find(
                                (t) => t.field === f.key,
                              )!;
                              const problem = r.issues.find(
                                (i) => i.field === f.key,
                              );
                              const value = sourceView
                                ? trace.original
                                : trace.output;
                              return (
                                <td
                                  key={f.key}
                                  className={`${["integer", "decimal"].includes(f.type) ? "numeric" : ""} ${problem ? "problem-cell" : !sourceView && trace.original !== trace.output ? "changed-cell" : ""}`}
                                  title={
                                    problem?.message ||
                                    trace.steps.join(" → ") ||
                                    "Unchanged"
                                  }
                                >
                                  <button
                                    onClick={() => {
                                      setSelected(r.row);
                                      setCorrection({
                                        field: f.key,
                                        value: "",
                                        reason: "",
                                      });
                                    }}
                                    aria-label={`Inspect row ${r.row} ${f.label}`}
                                  >
                                    {value || (
                                      <span className="empty-value">—</span>
                                    )}
                                    {problem && (
                                      <i className="cell-issue-dot" />
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!shown.length && (
                      <div className="empty-state">
                        <FunnelSimple />
                        <h3>No rows in this view</h3>
                        <p>Try another filter or clear the search.</p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setSearch("");
                            setFilter("all");
                          }}
                        >
                          Show all rows
                        </button>
                      </div>
                    )}
                  </div>
                  <footer className="table-footer">
                    <span>
                      {visible.length
                        ? `${displayPage * 12 + 1}–${Math.min((displayPage + 1) * 12, visible.length)} of ${visible.length} rows`
                        : "0 rows"}{" "}
                      <span className="subtle">· select a cell to inspect</span>
                    </span>
                    <div>
                      <button
                        aria-label="Previous page"
                        disabled={displayPage === 0}
                        onClick={() => setPage(displayPage - 1)}
                      >
                        ←
                      </button>
                      <span>
                        {displayPage + 1} / {pageCount}
                      </span>
                      <button
                        aria-label="Next page"
                        disabled={displayPage === pageCount - 1}
                        onClick={() => setPage(displayPage + 1)}
                      >
                        →
                      </button>
                    </div>
                  </footer>
                </section>
                <aside
                  className="inspector"
                  aria-label={`Inspector for data row ${row.row}`}
                >
                  <div className="inspector-heading">
                    <div>
                      <span>ROW INSPECTOR</span>
                      <h2>{row.values.sku || `Data row ${row.row}`}</h2>
                    </div>
                    <span className="row-index">#{row.row}</span>
                  </div>
                  <div
                    className={`inspector-verdict ${row.accepted ? "pass" : ""}`}
                  >
                    {row.accepted ? <CheckCircle /> : <WarningCircle />}
                    <div>
                      <strong>
                        {row.accepted
                          ? "All checks passed"
                          : `${row.issues.length} ${row.issues.length === 1 ? "issue needs" : "issues need"} a decision`}
                      </strong>
                      <span>
                        {row.accepted
                          ? "Included in accepted.csv"
                          : "Excluded from accepted.csv"}
                      </span>
                    </div>
                  </div>
                  {row.issues.map((issue, i) => (
                    <button
                      key={i}
                      className={`issue-card ${correction.field === issue.field ? "focused" : ""}`}
                      onClick={() =>
                        setCorrection({
                          field: issue.field,
                          value: "",
                          reason: "",
                        })
                      }
                    >
                      <strong>
                        {CONTRACT.find((f) => f.key === issue.field)?.label}
                      </strong>
                      <span>{issue.message}</span>
                    </button>
                  ))}
                  <h3 className="inspector-subhead">
                    Cell lineage <span>Original → output</span>
                  </h3>
                  <div className="lineage-list">
                    {row.traces.map((trace) => (
                      <button
                        className={
                          trace.field === correction.field ? "focused" : ""
                        }
                        key={trace.field}
                        onClick={() =>
                          setCorrection({
                            field: trace.field,
                            value: "",
                            reason: "",
                          })
                        }
                      >
                        <span className="trace-label">
                          {CONTRACT.find((f) => f.key === trace.field)?.label}
                          {trace.overridden && <small>reviewed</small>}
                        </span>
                        <div>
                          <code>{trace.original || "∅"}</code>
                          <ArrowRight />
                          <code
                            className={
                              trace.output !== trace.original ? "edited" : ""
                            }
                          >
                            {trace.output || "∅"}
                          </code>
                        </div>
                        {trace.steps.length > 0 && (
                          <span className="trace-steps">
                            {trace.steps.join(" · ")}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <form className="correction" onSubmit={saveCorrection}>
                    <h3>Record a correction</h3>
                    <label>
                      Target field
                      <select
                        value={correction.field}
                        onChange={(e) =>
                          setCorrection({
                            field: e.target.value,
                            value: "",
                            reason: "",
                          })
                        }
                      >
                        {CONTRACT.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Verified value
                      <input
                        aria-label="Verified value"
                        value={correction.value}
                        onChange={(e) =>
                          setCorrection((c) => ({
                            ...c,
                            value: e.target.value,
                          }))
                        }
                        placeholder={
                          correction.field === "restock_date"
                            ? "YYYY-MM-DD"
                            : "Canonical target value"
                        }
                      />
                    </label>
                    <label>
                      Why this is correct
                      <input
                        aria-label="Correction reason"
                        required
                        maxLength={250}
                        value={correction.reason}
                        onChange={(e) =>
                          setCorrection((c) => ({
                            ...c,
                            reason: e.target.value,
                          }))
                        }
                        placeholder="Your evidence or decision"
                      />
                    </label>
                    <button
                      className="button secondary full"
                      type="submit"
                      disabled={!correction.reason.trim()}
                    >
                      <Check /> Apply & recheck
                    </button>
                    <p>
                      Recorded as your assertion. Source values stay intact. Use
                      Undo to revert.
                    </p>
                  </form>
                </aside>
              </div>
              <div className="bottom-note">
                <Info />
                <span>
                  “Ready” means the row satisfies this import contract. It does
                  not independently verify the truth of the supplier’s data.
                </span>
              </div>
            </>
          )}
          {view === "recipe" && (
            <div className="recipe-layout">
              <section className="mapping-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Column mapping</h2>
                    <p>Six fields in the target inventory contract</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => recipeRef.current?.click()}
                  >
                    <UploadSimple /> Load recipe
                  </button>
                </div>
                {CONTRACT.map((field) => {
                  const mapping = plan.mappings.find(
                    (m) => m.target === field.key,
                  )!;
                  return (
                    <div className="mapping-row" key={field.key}>
                      <div className="target-field">
                        <strong>
                          {field.label}
                          <span className="type-tag">{field.type}</span>
                        </strong>
                        <p>{field.description}</p>
                        <span>
                          {field.required ? "Required" : "Optional"}
                          {field.unique ? " · Unique across all rows" : ""}
                        </span>
                      </div>
                      <div className="mapping-controls">
                        <label>
                          Source column
                          <select
                            aria-label={`Source for ${field.label}`}
                            value={mapping.source || ""}
                            onChange={(e) =>
                              changeMapping(field.key, {
                                source: e.target.value || null,
                              })
                            }
                          >
                            <option value="">— Not mapped —</option>
                            {data.headers.map((h) => (
                              <option key={h}>{h}</option>
                            ))}
                          </select>
                        </label>
                        <div className="field-options">
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={mapping.trim}
                              onChange={(e) =>
                                changeMapping(field.key, {
                                  trim: e.target.checked,
                                })
                              }
                            />
                            Trim whitespace
                          </label>
                          {["text", "enum"].includes(field.type) && (
                            <label>
                              Letter case
                              <select
                                aria-label={`Case for ${field.label}`}
                                value={mapping.casing}
                                onChange={(e) =>
                                  changeMapping(field.key, {
                                    casing: e.target.value as Mapping["casing"],
                                  })
                                }
                              >
                                <option value="keep">Keep original</option>
                                <option value="lower">Lowercase</option>
                                <option value="upper">Uppercase</option>
                              </select>
                            </label>
                          )}
                          {field.type === "decimal" && (
                            <label>
                              Number convention
                              <select
                                aria-label="Number convention"
                                value={mapping.decimal}
                                onChange={(e) =>
                                  changeMapping(field.key, {
                                    decimal: e.target
                                      .value as Mapping["decimal"],
                                  })
                                }
                              >
                                <option value="unconfirmed">
                                  Choose a convention…
                                </option>
                                <option value="dot">
                                  1,234.56 · decimal point
                                </option>
                                <option value="comma">
                                  1.234,56 · decimal comma
                                </option>
                              </select>
                            </label>
                          )}
                          {field.type === "date" && (
                            <label>
                              Date convention
                              <select
                                aria-label="Date convention"
                                value={mapping.dateOrder}
                                onChange={(e) =>
                                  changeMapping(field.key, {
                                    dateOrder: e.target
                                      .value as Mapping["dateOrder"],
                                  })
                                }
                              >
                                <option value="reject">
                                  Hold ambiguous dates
                                </option>
                                <option value="DMY">Day / Month / Year</option>
                                <option value="MDY">Month / Day / Year</option>
                              </select>
                            </label>
                          )}
                        </div>
                        {field.type === "enum" && (
                          <div className="alias-editor">
                            <label>
                              Explicit aliases{" "}
                              <span>One source=target pair per line</span>
                              <textarea
                                aria-label="Category aliases"
                                key={JSON.stringify(mapping.aliases)}
                                defaultValue={Object.entries(mapping.aliases)
                                  .map(([a, b]) => `${a}=${b}`)
                                  .join("\n")}
                                placeholder={"lamps=lighting\nchairs=furniture"}
                                onBlur={(e) => {
                                  try {
                                    const aliases = Object.fromEntries(
                                      e.target.value
                                        .split("\n")
                                        .filter((s) => s.trim())
                                        .map((line) => {
                                          const split = line.indexOf("=");
                                          if (split < 1)
                                            throw new Error(
                                              "Use source=target for each alias.",
                                            );
                                          return [
                                            line.slice(0, split).trim(),
                                            line.slice(split + 1).trim(),
                                          ];
                                        }),
                                    );
                                    const next = {
                                      ...plan,
                                      mappings: plan.mappings.map((m) =>
                                        m.target === field.key
                                          ? { ...m, aliases }
                                          : m,
                                      ),
                                    };
                                    validatePlan(next, data);
                                    if (
                                      JSON.stringify(aliases) !==
                                      JSON.stringify(mapping.aliases)
                                    )
                                      changeMapping(field.key, { aliases });
                                    setError("");
                                  } catch (err) {
                                    e.target.value = Object.entries(
                                      mapping.aliases,
                                    )
                                      .map(([a, b]) => `${a}=${b}`)
                                      .join("\n");
                                    setError((err as Error).message);
                                  }
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="mapping-footer">
                  <button
                    className="text-button"
                    onClick={undo}
                    disabled={!history.length}
                  >
                    <ArrowUUpLeft /> Undo last change
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setView("workbench")}
                  >
                    Review {result.rejected} held rows <ArrowRight />
                  </button>
                </div>
              </section>
              <aside className="model-panel">
                <div className="model-icon">
                  <Sparkle weight="duotone" />
                </div>
                <h2>
                  Let a model propose.
                  <br />
                  Keep the final say.
                </h2>
                <p>
                  Nebius + an NVIDIA open model can suggest semantic column
                  mappings. The same deterministic checks validate every
                  proposal.
                </p>
                <div
                  className={`model-status ${status?.configured ? "online" : ""}`}
                >
                  <i />
                  {status?.configured
                    ? `Configured · ${status.remainingCalls} calls left`
                    : "Live model not configured"}
                </div>
                <p className="small">
                  {status?.configured
                    ? status.model
                    : "Local column matching is active. This is not an AI-generated result."}
                </p>
                <div className="privacy-preview">
                  <h3>What would be sent</h3>
                  <ul>
                    <li>Column names and target contract</li>
                    <li>Counts and value-format statistics</li>
                    <li>
                      {shareSamples
                        ? "Up to 3 values per source column"
                        : "No row values or file contents"}
                    </li>
                  </ul>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={shareSamples}
                      onChange={(e) => setShareSamples(e.target.checked)}
                    />
                    Include a few sample values
                  </label>
                  <p>
                    Only enable this for data you are allowed to share with
                    Nebius.
                  </p>
                </div>
                <button
                  className="button primary full"
                  disabled={
                    busy || !status?.configured || status.remainingCalls <= 0
                  }
                  onClick={askModel}
                >
                  <Sparkle />
                  {busy ? "Proposing a recipe…" : "Propose with Nebius"}
                </button>
                <button
                  className="text-button full"
                  onClick={() => {
                    checkpoint();
                    setPlan(localPlan(data));
                    setProposal(null);
                    setModelReceipt("");
                    setNotice(
                      "Conservative local matching applied. Review the number and date conventions.",
                    );
                  }}
                >
                  Use local matching
                </button>
                {proposal && (
                  <div className="proposal">
                    <h3>Proposal ready for review</h3>
                    <p>
                      {proposal.model} ·{" "}
                      {(proposal.latencyMs / 1000).toFixed(1)}s
                    </p>
                    <p>
                      {proposal.sampleCount} sample values shared ·{" "}
                      {proposal.usage.inputTokens ?? "?"} input /{" "}
                      {proposal.usage.outputTokens ?? "?"} output tokens
                    </p>
                    <ul>
                      {proposal.plan.mappings.map((m) => (
                        <li key={m.target}>
                          <strong>{m.target}</strong> ←{" "}
                          {m.source || "not mapped"}
                          <span>
                            {m.target === "unit_price"
                              ? `Numbers: ${m.decimal} · `
                              : ""}
                            {m.dateOrder !== "reject"
                              ? m.dateOrder
                              : "Ambiguous dates held"}
                            {Object.keys(m.aliases).length
                              ? ` · ${Object.keys(m.aliases).length} aliases`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p>
                      Preview:{" "}
                      {evaluate(data, proposal.plan, resolutions).accepted} /{" "}
                      {data.rows.length} rows pass. Existing reviewed
                      corrections are retained.
                    </p>
                    <button
                      className="button secondary full"
                      onClick={() => {
                        checkpoint();
                        setPlan(proposal.plan);
                        setModelReceipt(
                          `${proposal.model} · ${proposal.latencyMs} ms · proposal reviewed and applied`,
                        );
                        setProposal(null);
                        setNotice(
                          "Model proposal applied. Inspect the resulting changes before export.",
                        );
                      }}
                    >
                      Apply this proposal
                    </button>
                    <button
                      className="text-button full"
                      onClick={() => setProposal(null)}
                    >
                      Discard proposal
                    </button>
                  </div>
                )}
                {modelReceipt && (
                  <p className="model-receipt">
                    <CheckCircle />
                    {modelReceipt}
                  </p>
                )}
              </aside>
            </div>
          )}
          {view === "audit" && (
            <div className="audit-layout">
              <section className="audit-main">
                <div className="panel-heading">
                  <div>
                    <h2>The path from source to handoff</h2>
                    <p>Counts are computed from the file currently open.</p>
                  </div>
                  <ShieldCheck size={26} />
                </div>
                <div className="audit-flow">
                  <div>
                    <span>01</span>
                    <FileCsv />
                    <strong>{data.rows.length} original rows</strong>
                    <p>Immutable source text retained in memory</p>
                  </div>
                  <ArrowRight />
                  <div>
                    <span>02</span>
                    <ListChecks />
                    <strong>{CONTRACT.length} explicit mappings</strong>
                    <p>{resolutions.length} reviewed cell corrections</p>
                  </div>
                  <ArrowRight />
                  <div>
                    <span>03</span>
                    <ShieldCheck />
                    <strong>
                      {result.accepted} accepted / {result.rejected} held
                    </strong>
                    <p>No silent drops, no generated defaults</p>
                  </div>
                </div>
                <div className="audit-section">
                  <h3>Outstanding checks</h3>
                  {Object.entries(result.issueCounts).length ? (
                    Object.entries(result.issueCounts).map(([code, count]) => (
                      <div className="issue-count" key={code}>
                        <span>
                          <WarningCircle />
                          {labels[code] || code}
                        </span>
                        <strong>{count}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="all-clear">
                      <CheckCircle /> All rows satisfy the current contract.
                    </p>
                  )}
                </div>
                <div className="audit-section">
                  <h3>Recorded human decisions</h3>
                  {resolutions.length ? (
                    resolutions.map((r) => (
                      <div className="decision" key={`${r.row}:${r.field}`}>
                        <span>
                          Row {r.row} · {r.field}
                        </span>
                        <strong>{r.value || "(empty)"}</strong>
                        <p>{r.reason}</p>
                        <button
                          className="text-button"
                          onClick={() => {
                            checkpoint();
                            setResolutions((rs) =>
                              rs.filter(
                                (v) =>
                                  !(v.row === r.row && v.field === r.field),
                              ),
                            );
                          }}
                        >
                          Remove correction
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="subtle">
                      No cell values have been manually replaced.
                    </p>
                  )}
                </div>
              </section>
              <aside className="bundle-panel">
                <h2>Everything travels together.</h2>
                <p>
                  A ZIP bundle you can review or reproduce outside this app.
                </p>
                {[
                  ["accepted.csv", "Only rows that pass every check"],
                  ["rejected.csv", "Every held row and its reasons"],
                  ["canonical.json", "Exact target values with source rows"],
                  ["recipe.json", "Mappings and reviewed corrections"],
                  ["lineage.json", "Original → output for every cell"],
                  ["manifest.json", "SHA-256 hashes and row counts"],
                  ["original.txt", "Unmodified source text"],
                ].map(([name, detail]) => (
                  <div className="bundle-file" key={name}>
                    <FileText />
                    <div>
                      <strong>{name}</strong>
                      <span>{detail}</span>
                    </div>
                  </div>
                ))}
                <button
                  className="button primary full"
                  disabled={exporting}
                  onClick={exportBundle}
                >
                  <DownloadSimple />
                  {exporting ? "Preparing…" : "Export review bundle"}
                </button>
                <p className="small">
                  CSV formula prefixes are neutralized. Exact strings remain in
                  canonical.json. Hashes confirm byte equality, not supplier
                  authenticity.
                </p>
                <div className="baseline">
                  <span>Conservative local baseline</span>
                  <strong>
                    {beforeStats.accepted} → {result.accepted} rows accepted
                  </strong>
                  <p>
                    This comparison describes the current recipe, not measured
                    model performance.
                  </p>
                </div>
              </aside>
            </div>
          )}
          <footer className="page-footer">
            <span>Originals preserved. Ambiguity made visible.</span>
            <span>
              Built for careful handoffs <span>↗</span>
            </span>
          </footer>
        </main>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values"
        hidden
        onChange={(e) => {
          importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={recipeRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          loadRecipe(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {dialog === "import" && (
        <Dialog title="Open an inventory CSV" onClose={() => setDialog(null)}>
          <p className="dialog-copy">
            UTF-8 CSV or TSV, up to 5 MB / 20,000 rows. Opening a file replaces
            the current in-memory session; export first if you need to keep it.
          </p>
          <button
            className="drop-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              importFile(e.dataTransfer.files[0]);
            }}
          >
            <UploadSimple size={32} />
            <strong>Choose a file or drop it here</strong>
            <span>The file is parsed in your browser.</span>
          </button>
          <div className="or-divider">or paste CSV text</div>
          <label>
            File name
            <input
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
          </label>
          <label>
            CSV contents
            <textarea
              className="paste-area"
              aria-label="CSV contents"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={
                "sku,product_name,quantity,unit_price,restock_date,category\nLT-01,Desk lamp,4,49.90,2026-10-04,lighting"
              }
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="text-button"
              onClick={() =>
                download(DEMO_CSV, "importproof-sample.csv", "text/csv")
              }
            >
              <ArrowDown /> Download sample
            </button>
            <button
              className="button primary"
              disabled={!pasted.trim()}
              onClick={() => importText(pasted, importName || "pasted.csv")}
            >
              Open pasted data <ArrowRight />
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "guide" && (
        <Dialog
          title="A careful import, in four steps"
          onClose={() => setDialog(null)}
        >
          <ol className="guide">
            <li>
              <strong>Open your source.</strong>
              <p>
                Use the synthetic sample or a UTF-8 inventory CSV. This version
                uses a six-field EUR inventory contract.
              </p>
            </li>
            <li>
              <strong>Review the recipe.</strong>
              <p>
                Confirm column mappings and number/date conventions. Optional
                model proposals do not rewrite your rows and are never applied
                automatically.
              </p>
            </li>
            <li>
              <strong>Resolve what you actually know.</strong>
              <p>
                Inspect each held row. Correct a value with a reason, or leave
                it out of the accepted export. Duplicate identifiers hold every
                copy.
              </p>
            </li>
            <li>
              <strong>Export a complete handoff.</strong>
              <p>
                The ZIP contains accepted and held rows, originals, lineage,
                recipe and hashes. Your in-memory session is not auto-saved;
                export before closing.
              </p>
            </li>
          </ol>
          <button
            className="button primary full"
            onClick={() => setDialog(null)}
          >
            Back to the workbench
          </button>
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
