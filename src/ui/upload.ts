/**
 * Upload panel: file → parse (SheetJS, in-browser) → explicit mapping screen →
 * lease-lite form → ReconPackage → scan. JSON packages skip the mapping.
 */

import type { Bucket, ReconPackage } from "../engine/types.ts";
import { scan } from "../engine/scan.ts";
import { h, clear } from "./dom.ts";
import type { ColumnGuess, DraftLine, LeaseForm, ParsedSheet } from "../ingest/parse.ts";

// SheetJS is ~400 kB; load the ingest module only when someone actually uploads.
type Ingest = typeof import("../ingest/parse.ts");
let ingestPromise: Promise<Ingest> | null = null;
function ingest(): Promise<Ingest> {
  ingestPromise ??= import("../ingest/parse.ts");
  return ingestPromise;
}

interface UploadState {
  step: "idle" | "map" | "error";
  filename: string;
  workbook: Awaited<ReturnType<Ingest["readWorkbook"]>>["workbook"] | null;
  sheet: ParsedSheet | null;
  columns: ColumnGuess[];
  lines: DraftLine[] | null;
  lineWarnings: string[];
  error: string | null;
  form: LeaseForm;
  capOn: boolean;
  feeOn: boolean;
  grossOn: boolean;
}

const BASE = import.meta.env.BASE_URL;

export function mountUploadPanel(container: HTMLElement, onPackage: (pkg: ReconPackage) => void): void {
  const st: UploadState = {
    step: "idle", filename: "", workbook: null, sheet: null, columns: [], lines: null, lineWarnings: [], error: null,
    form: { tenant_name: "", property_name: "", premises_sf: 10_000 },
    capOn: false, feeOn: false, grossOn: false,
  };

  async function handleFile(file: File): Promise<void> {
    st.filename = file.name;
    st.error = null;
    try {
      if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        const pkg = JSON.parse(text) as ReconPackage;
        scan(pkg); // throws with a message on malformed shape
        onPackage({ ...pkg, meta: { ...pkg.meta, package_id: pkg.meta.package_id || "UPLOAD" } });
        st.step = "idle";
        render();
        return;
      }
      const buf = await file.arrayBuffer();
      const { readWorkbook } = await ingest();
      const { workbook, sheetNames } = readWorkbook(buf, file.name);
      st.workbook = workbook;
      await selectSheet(sheetNames[0]!, sheetNames);
    } catch (err) {
      st.step = "error";
      st.error = `Could not read ${file.name}: ${(err as Error).message}`;
      render();
    }
  }

  async function selectSheet(name: string, sheetNames: string[]): Promise<void> {
    const { parseSheet } = await ingest();
    st.sheet = parseSheet(st.workbook!, name, sheetNames);
    st.columns = st.sheet.columns.map((c) => ({ ...c }));
    st.step = "map";
    await recomputeLines();
    render();
  }

  async function recomputeLines(): Promise<void> {
    if (!st.sheet) return;
    try {
      const { extractLines } = await ingest();
      const { lines, warnings } = extractLines(st.sheet.grid, st.sheet.headerRow, st.columns);
      st.lines = lines;
      st.lineWarnings = warnings;
      st.error = null;
    } catch (err) {
      st.lines = null;
      st.lineWarnings = [];
      st.error = (err as Error).message;
    }
  }

  function render(): void {
    clear(container);
    container.append(
      h("h3", {}, "Upload your own statement"),
      h("p", { class: "privacy-line" }, "Runs entirely in your browser. Your file is never uploaded to any server — this page cannot open a network connection."),
      renderDrop(),
    );
    if (st.step === "error" && st.error) {
      container.append(h("div", { class: "error" }, st.error, " ", h("a", { href: `${BASE}template.xlsx`, download: "recon-template.xlsx" }, "Download the template")));
    }
    if (st.step === "map" && st.sheet) {
      container.append(renderMapping(), renderPreview(), renderLeaseForm(), renderActions());
    }
  }

  function renderDrop(): HTMLElement {
    const input = h("input", { type: "file", accept: ".xlsx,.xls,.csv,.json,application/json,text/csv" }) as HTMLInputElement;
    input.addEventListener("change", () => { const f = input.files?.[0]; if (f) void handleFile(f); });
    const drop = h(
      "div",
      { class: "drop" },
      h("span", {}, st.filename ? `Loaded: ${st.filename}` : "Drop an .xlsx, .xls or .csv here, or choose a file"),
      input,
      h("p", { class: "hint" }, "Wide format works best: one label column, one amount column per year headed by the year. Section header rows (e.g. “Controllable CAM”) are understood. ", h("a", { href: `${BASE}template.xlsx`, download: "recon-template.xlsx" }, "Download the template (.xlsx)"), " · ", h("a", { href: `${BASE}template.csv`, download: "recon-template.csv" }, "CSV"), " · a JSON package in the canonical schema also works."),
    );
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) void handleFile(f); });
    return drop;
  }

  function renderMapping(): HTMLElement {
    const sheet = st.sheet!;
    const sheetPicker = sheet.sheetNames.length > 1
      ? h("div", { class: "field" }, h("label", { for: "sheet-pick" }, "Sheet"), (() => {
          const sel = h("select", { id: "sheet-pick" }, ...sheet.sheetNames.map((n) => h("option", { value: n, selected: n === sheet.sheetName }, n))) as HTMLSelectElement;
          sel.addEventListener("change", () => { void selectSheet(sel.value, sheet.sheetNames); });
          return sel;
        })())
      : null;
    const rows = st.columns.map((col) => {
      const sel = h("select", { "aria-label": `role for ${col.header}` },
        h("option", { value: "ignore", selected: col.role.kind === "ignore" }, "Ignore"),
        h("option", { value: "label", selected: col.role.kind === "label" }, "Label (line item)"),
        h("option", { value: "section", selected: col.role.kind === "section" }, "Section"),
        h("option", { value: "bucket", selected: col.role.kind === "bucket" }, "Bucket (controllable / non-controllable)"),
        h("option", { value: "amount", selected: col.role.kind === "amount" }, "Amount for year →"),
      ) as HTMLSelectElement;
      const yearInput = h("input", { type: "number", min: 1980, max: 2100, "aria-label": `year for ${col.header}`, value: col.role.kind === "amount" ? String(col.role.year) : "", placeholder: "year", hidden: col.role.kind !== "amount" }) as HTMLInputElement;
      sel.addEventListener("change", () => {
        const k = sel.value;
        if (k === "amount") col.role = { kind: "amount", year: Number(yearInput.value) || new Date().getFullYear() - 1 };
        else col.role = { kind: k as "ignore" | "label" | "section" | "bucket" };
        yearInput.hidden = k !== "amount";
        if (k === "amount" && !yearInput.value) yearInput.value = String((col.role as { year: number }).year);
        void recomputeLines().then(rerenderBelow);
      });
      yearInput.addEventListener("change", () => { if (col.role.kind === "amount") { col.role = { kind: "amount", year: Number(yearInput.value) }; void recomputeLines().then(rerenderBelow); } });
      return h("div", { class: "map-row" },
        h("span", {}, h("span", { class: "col-name" }, col.header), h("span", { class: "col-sample" }, col.sample || "—")),
        h("span", { style: "display:flex;gap:6px;align-items:center" }, sel, yearInput),
      );
    });
    return h("div", { class: "panel", style: "box-shadow:none" },
      h("p", { class: "label" }, `Step 1 · Confirm the columns (header row ${sheet.headerRow + 1}, ${sheet.grid.length - sheet.headerRow - 1} data rows)`),
      sheetPicker,
      ...sheet.warnings.map((w) => h("p", { class: "hint" }, "⚠ ", w)),
      h("div", { class: "map-grid" }, ...rows),
    );
  }

  let previewEl: HTMLElement | null = null;
  let leaseEl: HTMLElement | null = null;
  let actionsEl: HTMLElement | null = null;
  function rerenderBelow(): void {
    const p = renderPreview(); const l = renderLeaseForm(); const a = renderActions();
    previewEl?.replaceWith(p); leaseEl?.replaceWith(l); actionsEl?.replaceWith(a);
    previewEl = p; leaseEl = l; actionsEl = a;
  }

  function renderPreview(): HTMLElement {
    if (st.error) { previewEl = h("div", { class: "error" }, st.error); return previewEl; }
    const lines = st.lines!;
    const years = [...new Set(lines.flatMap((l) => Object.keys(l.amounts).map(Number)))].sort();
    const bucketSel = (l: DraftLine) => {
      const sel = h("select", { "aria-label": `bucket for ${l.label}` },
        ...(["controllable", "non_controllable", "unknown"] as Bucket[]).map((b) => h("option", { value: b, selected: l.bucket === b }, b.replace("_", "-"))),
      ) as HTMLSelectElement;
      sel.addEventListener("change", () => { l.bucket = sel.value as Bucket; });
      return sel;
    };
    const feeBox = (l: DraftLine) => {
      const cb = h("input", { type: "checkbox", "aria-label": `fee line: ${l.label}`, checked: l.is_fee }) as HTMLInputElement;
      cb.addEventListener("change", () => { l.is_fee = cb.checked; });
      return cb;
    };
    previewEl = h("div", { class: "panel", style: "box-shadow:none" },
      h("p", { class: "label" }, `Step 2 · ${lines.length} lines across ${years.join(", ")} — confirm each line's bucket and fee flag`),
      ...st.lineWarnings.map((w) => h("p", { class: "hint" }, "⚠ ", w)),
      h("div", { class: "preview-scroll" },
        h("table", { class: "preview" },
          h("thead", {}, h("tr", {}, h("th", {}, "Label"), h("th", {}, "Section"), h("th", {}, "Bucket"), h("th", {}, "Fee?"), ...years.map((y) => h("th", { style: "text-align:right" }, String(y))))),
          h("tbody", {}, ...lines.map((l) => h("tr", {},
            h("td", {}, l.label), h("td", {}, l.section), h("td", { class: "bucket-cell" }, bucketSel(l)), h("td", {}, feeBox(l)),
            ...years.map((y) => h("td", { style: "text-align:right" }, l.amounts[y] !== undefined ? l.amounts[y]!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—")),
          ))),
        ),
      ),
    );
    return previewEl;
  }

  function num(id: string, label: string, value: number | undefined, onChange: (v: number | undefined) => void, note?: string, step = 1): HTMLElement {
    const input = h("input", { type: "number", id, step, value: value === undefined ? "" : String(value) }) as HTMLInputElement;
    input.addEventListener("change", () => { const v = input.value === "" ? undefined : Number(input.value); onChange(v !== undefined && Number.isFinite(v) ? v : undefined); });
    return h("div", { class: "field" }, h("label", { for: id }, label), input, note ? h("p", { class: "field-note" }, note) : null);
  }
  function text(id: string, label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const input = h("input", { type: "text", id, value }) as HTMLInputElement;
    input.addEventListener("change", () => onChange(input.value));
    return h("div", { class: "field" }, h("label", { for: id }, label), input);
  }
  function select<T extends string>(id: string, label: string, value: T, options: Array<[T, string]>, onChange: (v: T) => void): HTMLElement {
    const sel = h("select", { id }, ...options.map(([v, t]) => h("option", { value: v, selected: v === value }, t))) as HTMLSelectElement;
    sel.addEventListener("change", () => onChange(sel.value as T));
    return h("div", { class: "field" }, h("label", { for: id }, label), sel);
  }
  function toggle(id: string, label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const cb = h("input", { type: "checkbox", id, checked }) as HTMLInputElement;
    cb.addEventListener("change", () => onChange(cb.checked));
    return h("div", { class: "field" }, h("label", { for: id, style: "display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:.86rem" }, cb, label));
  }

  function renderLeaseForm(): HTMLElement {
    const f = st.form;
    const rerender = () => { const l = renderLeaseForm(); leaseEl?.replaceWith(l); leaseEl = l; };
    const cap = f.cap ?? { applies_to: "controllable" as const, pct: 5, method: "non_cumulative" as const, basis: "amount_paid" as const, fee_treatment: "outside_cap" as const };
    const fee = f.fee ?? { kind: "management" as const, rate_pct: 3, base: "cam_only" as const };
    const gu = f.gross_up ?? { allowed: true, to_pct: 95 };
    leaseEl = h("div", { class: "panel", style: "box-shadow:none" },
      h("p", { class: "label" }, "Step 3 · Lease terms the checks need (compact abstract)"),
      h("div", { class: "lease-form" },
        text("lf-tenant", "Tenant", f.tenant_name, (v) => { f.tenant_name = v; }),
        text("lf-prop", "Property", f.property_name, (v) => { f.property_name = v; }),
        num("lf-sf", "Premises sf", f.premises_sf, (v) => { f.premises_sf = v ?? 0; }),
        num("lf-den", "Denominator sf (landlord's)", f.denominator_sf, (v) => { f.denominator_sf = v; }, "Leave blank if the statement does not state one."),
        num("lf-billed", "Billed share %", f.billed_pct, (v) => { f.billed_pct = v; }, "As shown on the statement.", 0.0001),
        num("lf-stated", "Lease stated share %", f.stated_pct, (v) => { f.stated_pct = v; }, "Only if the lease fixes a percentage.", 0.01),
        toggle("lf-cap-on", "Lease caps controllable expenses", st.capOn, (v) => { st.capOn = v; f.cap = v ? cap : undefined; rerender(); }),
        ...(st.capOn ? [
          num("lf-cap-pct", "Cap %", cap.pct, (v) => { cap.pct = v ?? 5; f.cap = cap; }, undefined, 0.5),
          select("lf-cap-method", "Method", cap.method, [["non_cumulative", "Non-cumulative (year over prior year)"], ["cumulative", "Cumulative (simple over base)"], ["compounded", "Compounded over base"]], (v) => { cap.method = v; f.cap = cap; }),
          select("lf-cap-basis", "Basis of the increase", cap.basis, [["amount_paid", "Amount paid (lesser of actual and cap)"], ["actual_expenses", "Prior year actual expenses"], ["prior_cap", "Prior year cap (cap on cap)"]], (v) => { cap.basis = v; f.cap = cap; }),
          num("lf-cap-base", "Base year amount (pool $)", cap.base_year_amount, (v) => { cap.base_year_amount = v; f.cap = cap; }, "The capped pool for the year before your first year. Blank = treat the first year as the base.", 0.01),
          num("lf-cap-baseyr", "Base year", cap.base_year, (v) => { cap.base_year = v; f.cap = cap; }),
          select("lf-cap-fee", "Fee placement", cap.fee_treatment, [["outside_cap", "Outside the cap"], ["inside_cap", "Inside the cap"]], (v) => { cap.fee_treatment = v; f.cap = cap; }),
        ] : []),
        toggle("lf-fee-on", "Lease provides for a management / admin fee", st.feeOn, (v) => { st.feeOn = v; f.fee = v ? fee : undefined; rerender(); }),
        ...(st.feeOn ? [
          select("lf-fee-kind", "Fee kind", fee.kind, [["management", "Management"], ["administrative", "Administrative"]], (v) => { fee.kind = v; f.fee = fee; }),
          num("lf-fee-rate", "Rate %", fee.rate_pct, (v) => { fee.rate_pct = v ?? 0; f.fee = fee; }, undefined, 0.25),
          select("lf-fee-base", "Permitted base", fee.base, [["cam_only", "CAM only"], ["cam_plus_insurance", "CAM + insurance"], ["all_opex", "All operating expenses"], ["receipts", "Gross receipts (not testable from a statement)"]], (v) => { fee.base = v; f.fee = fee; }),
        ] : []),
        num("lf-cap-thr", "Capital threshold $", f.capital_threshold, (v) => { f.capital_threshold = v; }, "Items above this must be amortized, if the lease says so.", 100),
        num("lf-cap-life", "Capital life (years)", f.capital_life_years, (v) => { f.capital_life_years = v; }, "Lease-stated amortization life, if any."),
        toggle("lf-gu-on", "Lease allows an occupancy gross-up", st.grossOn, (v) => { st.grossOn = v; f.gross_up = v ? gu : undefined; rerender(); }),
        ...(st.grossOn ? [num("lf-gu-to", "Gross up to %", gu.to_pct, (v) => { gu.to_pct = v; f.gross_up = gu; })] : []),
      ),
    );
    return leaseEl;
  }

  function renderActions(): HTMLElement {
    const btn = h("button", { type: "button", class: "primary-btn", disabled: !st.lines }, "Scan this statement") as HTMLButtonElement;
    btn.addEventListener("click", async () => {
      try {
        const { buildPackage } = await ingest();
        const pkg = buildPackage(st.lines!, st.form, `UPLOAD-${st.filename.replace(/\.[^.]+$/, "").slice(0, 24)}`);
        scan(pkg);
        onPackage(pkg);
      } catch (err) {
        st.error = (err as Error).message;
        rerenderBelow();
      }
    });
    actionsEl = h("div", { class: "config-actions" }, btn, h("p", { class: "hint" }, "The scan runs here, instantly. Change a bucket or a lease term and scan again."));
    return actionsEl;
  }

  render();
}
