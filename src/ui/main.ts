/**
 * UI entry. DOM code only — imports the engine, never the reverse.
 * State: which package is selected, which view is showing, the scan config,
 * the last result and the statement model built from it.
 */

import "./styles.css";
import type { Finding, LeaseLite, ReconPackage, ScanConfig, ScanResult } from "../engine/types.ts";
import { DEFAULT_CONFIG } from "../engine/types.ts";
import { scan } from "../engine/scan.ts";
import { PACKAGES, packageById } from "../data/index.ts";
import { $, clear, h } from "./dom.ts";
import type { ViewId } from "./render.ts";
import { renderConfig, renderDiffPanel, renderFindings, renderPicker, renderSkips, renderSummary, renderViewTabs } from "./render.ts";
import type { ReconTableModel } from "./recon-model.ts";
import { buildReconModel, rowKeysForFinding, yearsOfFinding } from "./recon-model.ts";
import { renderReconTable } from "./recon-table.ts";
import type { LeaseDoc } from "../lease/doc.ts";
import { buildLeaseDoc } from "../lease/doc.ts";
import type { ClauseId, FieldId, FieldValue } from "../lease/fields.ts";
import { CLAUSE_DEFAULTS, CLAUSE_REMOVE, cloneLease, fieldById, leaseEquals } from "../lease/fields.ts";
import { anchorFor } from "../lease/sections.ts";
import { renderLeaseDoc } from "./lease-view.ts";
import type { ScanDiff } from "./scan-diff.ts";
import { diffScan } from "./scan-diff.ts";
import { mountUploadPanel } from "./upload.ts";

interface Highlight {
  rowKeys: string[];
  years: number[];
  label: string;
}

interface State {
  selectedId: string | null;
  pkg: ReconPackage | null;
  config: ScanConfig;
  result: ScanResult | null;
  model: ReconTableModel | null;
  doc: LeaseDoc | null;
  /** The same statement scanned against the *signed* lease — null when no redline. */
  baseline: ScanResult | null;
  diff: ScanDiff | null;
  editingLease: boolean;
  view: ViewId;
  highlight: Highlight | null;
  /** A statement row key: the findings list narrows to findings about that row. */
  findingFilter: string | null;
  /** A lease section ref to flash after a citation jump. */
  flashRef: string | null;
  uploadOpen: boolean;
  configOpen: boolean;
}

const state: State = {
  selectedId: null,
  pkg: null,
  config: { ...DEFAULT_CONFIG },
  result: null,
  model: null,
  doc: null,
  baseline: null,
  diff: null,
  editingLease: false,
  view: "findings",
  highlight: null,
  findingFilter: null,
  flashRef: null,
  uploadOpen: false,
  configOpen: false,
};

const uploaded = new Map<string, ReconPackage>();

/**
 * Redlined leases, by package id. Session-only, and always a *copy*: the
 * authored packages are never handed to an editor and never mutated, so the
 * golden baselines are safe by construction.
 */
const drafts = new Map<string, LeaseLite>();

const TABS: ReadonlyArray<{ id: ViewId; label: string; note: string }> = [
  { id: "findings", label: "Findings", note: "what the checks found" },
  { id: "recon", label: "Statement", note: "the landlord's reconciliation" },
  { id: "lease", label: "Lease", note: "the clauses the checks read" },
];

function allPackages(): ReconPackage[] {
  return [...PACKAGES, ...uploaded.values()];
}

function pick(id: string, scrollTo = true): void {
  const pkg = packageById(id) ?? uploaded.get(id) ?? null;
  state.selectedId = pkg ? id : null;
  state.pkg = pkg;
  state.uploadOpen = false;
  state.view = "findings";
  state.highlight = null;
  state.findingFilter = null;
  state.flashRef = null;
  state.editingLease = false;
  rescan();
  renderAll();
  if (pkg && scrollTo) $("summary").scrollIntoView({ block: "start" });
  if (pkg) history.replaceState(null, "", `#${encodeURIComponent(id)}`);
}

/** The package as it currently reads: the authored one, or the redline over it. */
function effectivePkg(): ReconPackage | null {
  if (!state.pkg) return null;
  const draft = drafts.get(state.pkg.meta.package_id);
  return draft ? { ...state.pkg, lease_lite: draft } : state.pkg;
}

function rescan(): void {
  const pkg = effectivePkg();
  if (!state.pkg || !pkg) {
    state.result = null;
    state.model = null;
    state.doc = null;
    state.baseline = null;
    state.diff = null;
    return;
  }
  const t0 = performance.now();
  state.result = scan(pkg, state.config);
  const ms = performance.now() - t0;
  state.model = buildReconModel(pkg, state.result);
  state.doc = buildLeaseDoc(pkg);
  // The diff stays apples-to-apples: the baseline is rescanned under the same config.
  const redlined = pkg !== state.pkg;
  state.baseline = redlined ? scan(state.pkg, state.config) : null;
  state.diff = state.baseline ? diffScan(state.baseline, state.result) : null;
  $("build-info").textContent = `Last scan: ${pkg.meta.package_id}${redlined ? " (redlined lease)" : ""}, ${state.result.findings.length} findings in ${ms.toFixed(1)} ms. ${import.meta.env.DEV ? "dev build" : "production build"}.`;
}

// ---------------------------------------------------------------------------
// The lease designer
// ---------------------------------------------------------------------------

/** Re-render without losing the reader's place, their open cards or their focus. */
function renderKeepingPlace(): void {
  const y = window.scrollY;
  const open = [...document.querySelectorAll("details[open]")].map((d) => d.id).filter(Boolean);
  const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
  renderAll();
  for (const id of open) {
    const el = document.getElementById(id);
    if (el instanceof HTMLDetailsElement) el.open = true;
  }
  if (focusId) document.getElementById(focusId)?.focus();
  // "auto" overrides the page's smooth scrolling: this is a redraw, not a jump.
  window.scrollTo({ top: y, behavior: "auto" });
}

function editLease(mutate: (l: LeaseLite) => void): void {
  if (!state.pkg) return;
  const id = state.pkg.meta.package_id;
  const draft = drafts.get(id) ?? cloneLease(state.pkg.lease_lite);
  mutate(draft);
  if (leaseEquals(draft, state.pkg.lease_lite)) drafts.delete(id);
  else drafts.set(id, draft);
  rescan();
  renderKeepingPlace();
}

function resetLease(): void {
  if (!state.pkg) return;
  drafts.delete(state.pkg.meta.package_id);
  rescan();
  renderKeepingPlace();
}

/** What the designer knows about this statement when drafting a fresh clause. */
function clauseHint(): { sharePct?: number; baseYear?: number; baseAmount?: number } {
  const pkg = state.pkg;
  if (!pkg) return {};
  const first = [...pkg.years].sort((a, b) => a.year - b.year)[0];
  const share = state.result?.share_by_year[first?.year ?? 0];
  const hint: { sharePct?: number; baseYear?: number; baseAmount?: number } = {};
  if (share) hint.sharePct = share.pct;
  if (first) {
    hint.baseYear = first.year - 1;
    const pool = first.cap_summary?.pool_actual;
    if (pool !== undefined) hint.baseAmount = pool;
  }
  return hint;
}

/** Statement rows per finding, computed once per render pass. */
function rowKeyIndex(): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  if (!state.result || !state.model) return idx;
  for (const f of state.result.findings) idx.set(f.id, rowKeysForFinding(f, state.model));
  return idx;
}

function setView(view: ViewId): void {
  state.view = view;
  if (view !== "lease") state.flashRef = null;
  renderAll();
  $(view).scrollIntoView({ block: "start" });
}

function cite(ref: string): void {
  state.view = "lease";
  state.flashRef = ref;
  renderAll();
  (document.getElementById(anchorFor(ref)) ?? $("lease")).scrollIntoView({ block: "center" });
}

function showInStatement(f: Finding): void {
  if (!state.model) return;
  const rowKeys = rowKeysForFinding(f, state.model);
  if (rowKeys.length === 0) return;
  state.highlight = { rowKeys, years: yearsOfFinding(f), label: `${f.check_id} · ${f.title}` };
  state.findingFilter = null;
  state.view = "recon";
  renderAll();
  (document.getElementById("recon-hl-target") ?? $("recon")).scrollIntoView({ block: "center" });
}

function renderAll(): void {
  const picker = $("picker-cards");
  clear(picker);
  picker.append(
    ...renderPicker(
      allPackages(),
      state.selectedId,
      (id) => pick(id),
      () => {
        state.uploadOpen = !state.uploadOpen;
        renderAll();
        if (state.uploadOpen) $("upload-panel").scrollIntoView({ block: "nearest" });
      },
      state.uploadOpen,
    ),
  );
  const up = $("upload-panel");
  up.hidden = !state.uploadOpen;

  const summary = $("summary");
  const findings = $("findings");
  const recon = $("recon");
  const lease = $("lease");
  const tabs = $("view-tabs");
  if (!state.result || !state.pkg || !state.model || !state.doc) {
    summary.hidden = true;
    findings.hidden = true;
    recon.hidden = true;
    lease.hidden = true;
    tabs.hidden = true;
    return;
  }
  summary.hidden = false;
  findings.hidden = state.view !== "findings";
  recon.hidden = state.view !== "recon";
  lease.hidden = state.view !== "lease";
  tabs.hidden = false;
  clear(tabs);
  tabs.append(...renderViewTabs(state.view, TABS, setView));

  const sb = $("summary-body");
  clear(sb);
  sb.append(renderSummary(state.result, state.pkg, state.diff));
  $("summary-h").textContent = `Summary — ${state.pkg.meta.package_id}: ${state.pkg.meta.tenant_name}, ${state.pkg.meta.property_name}`;

  const index = rowKeyIndex();
  const linkedKeys = new Set<string>();
  for (const keys of index.values()) for (const k of keys) linkedKeys.add(k);

  // --- statement view
  const rb = $("recon-body");
  clear(rb);
  rb.append(
    renderReconTable(state.model, state.pkg, {
      highlight: state.highlight,
      linkedKeys,
      onRowPick: (row) => {
        state.findingFilter = row.key;
        state.highlight = null;
        setView("findings");
      },
      onClearHighlight: () => {
        state.highlight = null;
        renderAll();
      },
    }),
  );

  // --- lease view
  const lb = $("lease-body");
  const effective = effectivePkg()!;
  clear(lb);
  lb.append(
    renderLeaseDoc(state.doc, {
      flashRef: state.flashRef,
      editing: state.editingLease,
      edited: drafts.has(state.pkg.meta.package_id),
      lease: effective.lease_lite,
      onToggleEdit: (on) => {
        state.editingLease = on;
        state.flashRef = null;
        renderKeepingPlace();
      },
      onReset: resetLease,
      onField: (id: FieldId, value: FieldValue) => editLease((l) => fieldById(id)?.set(l, value)),
      onClause: (clause: ClauseId, on: boolean) =>
        editLease((l) => (on ? CLAUSE_DEFAULTS[clause](l, clauseHint()) : CLAUSE_REMOVE[clause](l))),
    }),
  );

  // --- findings view
  const diffBox = $("scan-diff");
  clear(diffBox);
  diffBox.hidden = state.diff === null;
  if (state.diff) {
    const panel = renderDiffPanel(state.diff, resetLease);
    if (panel) diffBox.append(panel);
  }

  const filterNote = $("findings-filter");
  clear(filterNote);
  const shown = state.findingFilter
    ? state.result.findings.filter((f) => (index.get(f.id) ?? []).includes(state.findingFilter!))
    : state.result.findings;
  filterNote.hidden = state.findingFilter === null;
  if (state.findingFilter) {
    const label = state.model.blocks.flatMap((b) => b.rows).find((r) => r.key === state.findingFilter)?.label ?? state.findingFilter;
    filterNote.append(
      h("span", {}, `Showing ${shown.length} of ${state.result.findings.length} findings — those about ${label}.`),
      h(
        "button",
        {
          type: "button",
          class: "ghost-btn",
          onClick: () => {
            state.findingFilter = null;
            renderAll();
          },
        },
        "Show all",
      ),
    );
  }

  const list = $("findings-list");
  clear(list);
  list.append(
    ...renderFindings(
      state.result,
      state.pkg,
      {
        canShowInStatement: (f) => (index.get(f.id) ?? []).length > 0,
        onShowInStatement: showInStatement,
        onCite: cite,
        newIds: new Set((state.diff?.added ?? []).map((f) => f.id)),
      },
      shown,
    ),
  );

  const skips = $("skips");
  clear(skips);
  const sk = renderSkips(state.result);
  if (sk) skips.append(sk);

  const drawer = $("config-drawer");
  drawer.hidden = !state.configOpen;
  $("config-toggle").setAttribute("aria-expanded", String(state.configOpen));
  clear(drawer);
  drawer.append(
    renderConfig(
      state.config,
      DEFAULT_CONFIG,
      (patch) => {
        state.config = { ...state.config, ...patch };
        rescan();
        renderAll();
      },
      () => {
        state.config = { ...DEFAULT_CONFIG };
        rescan();
        renderAll();
      },
    ),
  );
}

function init(): void {
  $("config-toggle").addEventListener("click", () => {
    state.configOpen = !state.configOpen;
    renderAll();
  });

  mountUploadPanel($("upload-panel"), (pkg) => {
    uploaded.set(pkg.meta.package_id, pkg);
    pick(pkg.meta.package_id);
  });

  renderAll();

  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  // Land on a scanned package immediately — the demo should need no instructions.
  pick(hash && packageById(hash) ? hash : PACKAGES[0]!.meta.package_id, false);
}

init();
