/**
 * UI entry. DOM code only — imports the engine, never the reverse.
 * State: which package is selected, which view is showing, the scan config,
 * the last result and the statement model built from it.
 */

import "./styles.css";
import type { Finding, ReconPackage, ScanConfig, ScanResult } from "../engine/types.ts";
import { DEFAULT_CONFIG } from "../engine/types.ts";
import { scan } from "../engine/scan.ts";
import { PACKAGES, packageById } from "../data/index.ts";
import { $, clear, h } from "./dom.ts";
import type { ViewId } from "./render.ts";
import { renderConfig, renderFindings, renderPicker, renderSkips, renderSummary, renderViewTabs } from "./render.ts";
import type { ReconTableModel } from "./recon-model.ts";
import { buildReconModel, rowKeysForFinding, yearsOfFinding } from "./recon-model.ts";
import { renderReconTable } from "./recon-table.ts";
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
  view: ViewId;
  highlight: Highlight | null;
  /** A statement row key: the findings list narrows to findings about that row. */
  findingFilter: string | null;
  uploadOpen: boolean;
  configOpen: boolean;
}

const state: State = {
  selectedId: null,
  pkg: null,
  config: { ...DEFAULT_CONFIG },
  result: null,
  model: null,
  view: "findings",
  highlight: null,
  findingFilter: null,
  uploadOpen: false,
  configOpen: false,
};

const uploaded = new Map<string, ReconPackage>();

const TABS: ReadonlyArray<{ id: ViewId; label: string; note: string }> = [
  { id: "findings", label: "Findings", note: "what the checks found" },
  { id: "recon", label: "Statement", note: "the landlord's reconciliation" },
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
  rescan();
  renderAll();
  if (pkg && scrollTo) $("summary").scrollIntoView({ block: "start" });
  if (pkg) history.replaceState(null, "", `#${encodeURIComponent(id)}`);
}

function rescan(): void {
  if (!state.pkg) {
    state.result = null;
    state.model = null;
    return;
  }
  const t0 = performance.now();
  state.result = scan(state.pkg, state.config);
  const ms = performance.now() - t0;
  state.model = buildReconModel(state.pkg, state.result);
  $("build-info").textContent = `Last scan: ${state.pkg.meta.package_id}, ${state.result.findings.length} findings in ${ms.toFixed(1)} ms. ${import.meta.env.DEV ? "dev build" : "production build"}.`;
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
  renderAll();
  $(view === "recon" ? "recon" : "findings").scrollIntoView({ block: "start" });
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
  const tabs = $("view-tabs");
  if (!state.result || !state.pkg || !state.model) {
    summary.hidden = true;
    findings.hidden = true;
    recon.hidden = true;
    tabs.hidden = true;
    return;
  }
  summary.hidden = false;
  findings.hidden = state.view !== "findings";
  recon.hidden = state.view !== "recon";
  tabs.hidden = false;
  clear(tabs);
  tabs.append(...renderViewTabs(state.view, TABS, setView));

  const sb = $("summary-body");
  clear(sb);
  sb.append(renderSummary(state.result, state.pkg));
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

  // --- findings view
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
