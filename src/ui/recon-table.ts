/**
 * Renders the recon table model as a document-styled statement. DOM only —
 * every number and every row key comes from `recon-model.ts`.
 */

import type { ReconPackage } from "../engine/types.ts";
import type { ReconRow, ReconTableModel } from "./recon-model.ts";
import { h } from "./dom.ts";
import { money } from "./format.ts";

export interface ReconTableOptions {
  /** Rows and years to tint, set when a finding sends the reader here. */
  highlight?: { rowKeys: string[]; years: number[]; label?: string } | null;
  /** Rows that at least one finding is about; only these are clickable. */
  linkedKeys?: ReadonlySet<string>;
  onRowPick?: (row: ReconRow) => void;
  onClearHighlight?: () => void;
}

function cellText(row: ReconRow, i: number): string {
  const c = row.cells[i]!;
  if (c.text !== undefined) return c.text;
  if (c.amount === null) return "—";
  return money(c.amount);
}

export function renderReconTable(model: ReconTableModel, pkg: ReconPackage, opts: ReconTableOptions = {}): HTMLElement {
  const hlRows = new Set(opts.highlight?.rowKeys ?? []);
  const hlYears = new Set(opts.highlight?.years ?? []);
  const linked = opts.linkedKeys ?? new Set<string>();
  let firstHighlighted = true;

  const head = h(
    "thead",
    {},
    h(
      "tr",
      {},
      h("th", { scope: "col", class: "rt-line" }, "Line"),
      ...model.years.map((y) => h("th", { scope: "col", class: "rt-num" }, String(y))),
    ),
  );

  const body = h("tbody", {});
  for (const block of model.blocks) {
    body.appendChild(
      h("tr", { class: "rt-block" }, h("th", { scope: "colgroup", colspan: model.years.length + 1 }, block.title)),
    );
    for (const row of block.rows) body.appendChild(renderRow(row));
  }

  function renderRow(row: ReconRow): HTMLElement {
    const isHl = hlRows.has(row.key);
    const classes = ["rt-row", `rt-${row.kind}`];
    if (isHl) classes.push("hl-row");
    if (linked.has(row.key)) classes.push("rt-linked");
    const attrs: Record<string, string> = { class: classes.join(" ") };
    if (isHl && firstHighlighted) {
      attrs.id = "recon-hl-target";
      firstHighlighted = false;
    }
    const label = h(
      "th",
      { scope: "row", class: "rt-line" },
      h("span", { class: "rt-label" }, row.label),
      row.kind === "line" && row.bucket ? h("span", { class: `rt-bucket ${row.bucket}` }, row.bucket === "non_controllable" ? "non-controllable" : row.bucket === "controllable" ? "controllable" : "unclassified") : null,
    );
    const cells = model.years.map((y, i) => {
      const c = row.cells[i]!;
      const tint = isHl && hlYears.has(y);
      return h(
        "td",
        { class: `rt-num${tint ? " hl" : ""}${c.amount === null && c.text === undefined ? " rt-gap" : ""}` },
        h("span", { class: "rt-val" }, cellText(row, i)),
        c.note ? h("span", { class: "rt-note" }, c.note) : null,
      );
    });
    const tr = h("tr", attrs, label, ...cells);
    if (linked.has(row.key) && opts.onRowPick) {
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.title = `${row.label} — show the findings on this line`;
      tr.addEventListener("click", () => opts.onRowPick!(row));
      tr.addEventListener("keydown", (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === "Enter" || k === " ") {
          e.preventDefault();
          opts.onRowPick!(row);
        }
      });
    }
    return tr;
  }

  const banner = opts.highlight && opts.highlight.rowKeys.length
    ? h(
        "p",
        { class: "rt-banner" },
        h("span", {}, opts.highlight.label ?? "Showing the lines behind a finding."),
        opts.onClearHighlight ? h("button", { type: "button", class: "ghost-btn", onClick: opts.onClearHighlight }, "Clear") : null,
      )
    : null;

  return h(
    "div",
    { class: "panel recon-panel" },
    h(
      "p",
      { class: "rt-caption" },
      `${pkg.meta.package_id} — ${pkg.meta.property_name}, ${pkg.meta.premises_sf.toLocaleString("en-US")} sf premises. `,
      "Every figure the checks read, in the statement's own sections. Nothing here is recomputed except the subtotals.",
    ),
    banner,
    h("div", { class: "table-scroll rt-scroll" }, h("table", { class: "recon-table" }, head, body)),
  );
}
