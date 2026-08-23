import type { Finding, ReconPackage, ScanConfig, ScanResult, Severity } from "../engine/types.ts";
import { CHECK_CATALOG } from "../engine/registry.ts";
import { h } from "./dom.ts";
import { findingToText, money, moneyCompact, SEVERITY_ICON, SEVERITY_LABEL, yearText } from "./format.ts";

// ---------------------------------------------------------------------------
// Package picker
// ---------------------------------------------------------------------------

export function renderPicker(
  packages: readonly ReconPackage[],
  selectedId: string | null,
  onPick: (id: string) => void,
  onUpload: () => void,
  uploadOpen: boolean,
): HTMLElement[] {
  const cards = packages.map((p) =>
    h(
      "button",
      { type: "button", class: "card", "aria-pressed": String(p.meta.package_id === selectedId), onClick: () => onPick(p.meta.package_id) },
      h("span", { class: "card-id" }, p.meta.package_id),
      h("h3", {}, p.meta.tenant_name),
      h("p", {}, p.meta.story ?? `${p.years.length} years at ${p.meta.property_name}.`),
      h("span", { class: "card-meta" }, `${p.meta.property_name} · ${p.meta.premises_sf.toLocaleString("en-US")} sf · ${p.years[0]!.year}–${p.years[p.years.length - 1]!.year}`),
    ),
  );
  cards.push(
    h(
      "button",
      { type: "button", class: "card card-upload", "aria-pressed": String(uploadOpen), onClick: onUpload },
      h("span", { class: "card-id" }, "Upload"),
      h("h3", {}, "Upload your own"),
      h("p", {}, "An XLSX or CSV statement in wide format (one label column, one amount column per year). Parsed and scanned in this page — never uploaded anywhere."),
      h("span", { class: "card-meta" }, ".xlsx · .xls · .csv · or a JSON package"),
    ),
  );
  return cards;
}

// ---------------------------------------------------------------------------
// Summary band: stat tiles + severity-by-check strip
// ---------------------------------------------------------------------------

export function renderSummary(r: ScanResult, pkg: ReconPackage): HTMLElement {
  const impactTile = h(
    "div",
    { class: "tile tile-hero" },
    h("span", { class: "tile-label" }, "Estimated tenant impact"),
    h("span", { class: "tile-value num" }, moneyCompact(r.totals.estimated_impact_usd)),
    h("span", { class: "tile-note" }, r.totals.estimated_impact_usd > 0 ? `${money(r.totals.estimated_impact_usd)} — sum of quantified findings; estimated, not settled` : "no quantified overcharge"),
  );
  const sevTile = (sev: Severity, label: string, n: number, note: string) =>
    h(
      "div",
      { class: "tile" },
      h("span", { class: "tile-label" }, label),
      h("span", { class: "tile-value num" }, h("span", { class: `sev-dot ${sev}`, "aria-hidden": "true" }), String(n)),
      h("span", { class: "tile-note" }, note),
    );
  const tiles = h(
    "div",
    { class: "tiles" },
    impactTile,
    sevTile("high", "High", r.totals.high, "lease-terms or arithmetic violations, priced"),
    sevTile("review", "Review", r.totals.review, "patterns that warrant a document request"),
    sevTile("info", "Info", r.totals.info, "context, or below materiality"),
    h(
      "div",
      { class: "tile" },
      h("span", { class: "tile-label" }, "Checks run"),
      h("span", { class: "tile-value num" }, `${r.checks_run.length}`, h("span", { class: "tile-note" }, `of ${CHECK_CATALOG.length}`)),
      h("span", { class: "tile-note" }, r.skipped.length ? `${r.skipped.length} not run — see the footer` : "all checks ran"),
    ),
  );

  // Severity-by-check strip: one row per check, segments = findings by severity.
  const counts = new Map<string, Record<Severity, number>>();
  for (const c of CHECK_CATALOG) counts.set(c.id, { high: 0, review: 0, info: 0 });
  for (const f of r.findings) counts.get(f.check_id)![f.severity]++;
  const max = Math.max(1, ...[...counts.values()].map((c) => c.high + c.review + c.info));
  const rows = CHECK_CATALOG.map((c) => {
    const n = counts.get(c.id)!;
    const total = n.high + n.review + n.info;
    const skipped = r.skipped.find((s) => s.check_id === c.id);
    const bar = h("div", { class: "strip-bar", role: "img", "aria-label": `${c.id} ${c.title}: ${n.high} high, ${n.review} review, ${n.info} info${skipped ? "; not run" : ""}` });
    for (const sev of ["high", "review", "info"] as const) {
      if (!n[sev]) continue;
      const seg = h("span", { class: `strip-seg ${sev}`, title: `${n[sev]} ${SEVERITY_LABEL[sev].toLowerCase()}` });
      seg.style.width = `${(n[sev] / max) * 100}%`;
      bar.appendChild(seg);
    }
    return h(
      "div",
      { class: `strip-row${skipped ? " skipped" : ""}`, title: `${c.title} — ${c.concept}` },
      h("span", { class: "strip-id" }, `${c.id} `, h("span", { class: "sr-only" }, c.title)),
      bar,
      h("span", { class: "strip-n" }, skipped ? "n/a" : String(total)),
    );
  });
  const strip = h(
    "div",
    { class: "strip-wrap" },
    h(
      "div",
      { class: "strip-head" },
      h("span", {}, `Shape of the report — findings per check, ${pkg.years[0]!.year}–${pkg.years[pkg.years.length - 1]!.year}`),
      h(
        "span",
        { class: "legend", "aria-label": "legend" },
        h("span", {}, h("span", { class: "sev-dot high", "aria-hidden": "true" }), `${SEVERITY_ICON.high} High`),
        h("span", {}, h("span", { class: "sev-dot review", "aria-hidden": "true" }), `${SEVERITY_ICON.review} Review`),
        h("span", {}, h("span", { class: "sev-dot info", "aria-hidden": "true" }), `${SEVERITY_ICON.info} Info`),
        h("span", {}, "n/a = check not run"),
      ),
    ),
    h("div", { class: "strip" }, ...rows),
  );

  return h("div", {}, tiles, strip);
}

// ---------------------------------------------------------------------------
// Findings list
// ---------------------------------------------------------------------------

export function renderFindings(r: ScanResult, pkg: ReconPackage): HTMLElement[] {
  if (r.findings.length === 0) {
    return [h("li", { class: "empty-state" }, "No findings. Every check that could run came back clean — which is itself a result worth recording.")];
  }
  const ids = new Set(r.findings.map((f) => f.id));
  return r.findings.map((f) => renderFinding(f, pkg, ids));
}

function renderFinding(f: Finding, pkg: ReconPackage, allIds: Set<string>): HTMLElement {
  const sev = f.severity;
  const chip = h("span", { class: `chip ${sev}` }, h("span", { "aria-hidden": "true" }, SEVERITY_ICON[sev]), SEVERITY_LABEL[sev]);
  const meta = h(
    "span",
    { class: "f-meta" },
    chip,
    h("span", { class: "chip-check" }, f.check_id),
    h("span", {}, yearText(f.year)),
    f.category ? h("span", {}, f.category) : null,
    f.suppressed_by_materiality ? h("span", { class: "suppressed" }, "below materiality") : null,
  );
  const impact =
    f.tenant_impact_usd !== undefined
      ? h("span", { class: "f-impact" }, h("span", { class: "amt num" }, money(f.tenant_impact_usd)), h("span", { class: "lbl" }, "est. impact"))
      : f.tenant_exposure_usd !== undefined
        ? h("span", { class: "f-impact" }, h("span", { class: "amt num" }, money(f.tenant_exposure_usd)), h("span", { class: "lbl" }, "at stake"))
        : h("span", { class: "f-impact" }, h("span", { class: "lbl" }, "not priced"));

  const summary = h("summary", {}, h("p", { class: "f-title" }, f.title), meta, impact);

  const schedStart = f.working.findIndex((w) => w.label === "Full schedule");
  const rows = f.working.map((w, i) =>
    h("tr", { class: schedStart >= 0 && i >= schedStart ? "sched" : "" }, h("th", { scope: "row" }, w.label), h("td", {}, w.value)),
  );
  const related = (f.related ?? []).filter((id) => allIds.has(id));
  const copyBtn = h("button", { type: "button", class: "copy-btn" }, "Copy finding") as HTMLButtonElement;
  copyBtn.addEventListener("click", async () => {
    const text = findingToText(f, pkg);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("done");
      setTimeout(() => {
        copyBtn.textContent = "Copy finding";
        copyBtn.classList.remove("done");
      }, 1600);
    } catch {
      // Clipboard blocked (e.g. insecure context): fall back to a selectable textarea.
      const ta = h("textarea", { readonly: true, rows: 12, style: "width:100%" }, text) as HTMLTextAreaElement;
      copyBtn.replaceWith(ta);
      ta.select();
    }
  });

  const body = h(
    "div",
    { class: "f-body" },
    h("p", { class: "f-narrative" }, f.narrative),
    h("p", { class: "f-working-h" }, "Show the working"),
    h("div", { class: "table-scroll" }, h("table", { class: "working" }, h("tbody", {}, ...rows))),
    h(
      "div",
      { class: "f-foot" },
      h("p", { class: "f-refs" }, "Implements: ", f.refs.join(" · ")),
      related.length
        ? h(
            "p",
            { class: "f-related" },
            "Read with: ",
            ...related.flatMap((id, i) => [i ? ", " : "", h("a", { href: `#f-${cssId(id)}` }, id.split(":")[0] + " " + (id.split(":")[3] ?? id.split(":")[2] ?? ""))]),
          )
        : null,
      copyBtn,
    ),
  );
  const card = h("details", { class: `finding ${sev}`, id: `f-${cssId(f.id)}` }, summary, body);
  return h("li", {}, card);
}

export function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function renderSkips(r: ScanResult): HTMLElement | null {
  if (r.skipped.length === 0) return h("div", { class: "skips" }, h("h3", {}, "Checks not run"), h("p", { class: "hint" }, "Every check ran."));
  return h(
    "div",
    { class: "skips" },
    h("h3", {}, "Checks not run"),
    h("ul", {}, ...r.skipped.map((s) => h("li", {}, h("code", {}, s.check_id), ` ${s.title} — ${s.reason}`))),
  );
}

// ---------------------------------------------------------------------------
// Config drawer
// ---------------------------------------------------------------------------

export function renderConfig(cfg: ScanConfig, defaults: ScanConfig, onChange: (c: Partial<ScanConfig>) => void, onReset: () => void): HTMLElement {
  const field = (key: keyof ScanConfig, label: string, note: string, step: number) => {
    const input = h("input", { type: "number", id: `cfg-${key}`, min: 0, step, value: String(cfg[key]) }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) onChange({ [key]: v });
    });
    return h("div", { class: "field" }, h("label", { for: `cfg-${key}` }, label), input, h("p", { class: "field-note" }, note));
  };
  return h(
    "div",
    {},
    h(
      "div",
      { class: "config-grid" },
      field("materiality_usd", "Materiality (tenant $)", `Quantified findings below this drop to Info; year-over-year swings below it are not raised. Default ${defaults.materiality_usd}.`, 50),
      field("yoy_pct_threshold", "Year-over-year swing (%)", `Flag a line when it moves at least this much against the prior year. Default ${defaults.yoy_pct_threshold}%.`, 1),
      field("round_number_min_usd", "Round-number floor (pool $)", `Test only pool amounts at or above this for suspiciously round figures. Default ${defaults.round_number_min_usd}.`, 500),
    ),
    h("div", { class: "config-actions" }, h("button", { type: "button", class: "ghost-btn", onClick: onReset }, "Reset to defaults")),
  );
}
