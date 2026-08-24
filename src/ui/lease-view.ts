/**
 * Renders the model lease as a document, and — in edit mode — as a document
 * you can redline.
 *
 * DOM only. Every word comes from `src/lease/doc.ts`, and every tinted span is
 * a value of the lease abstract the scan actually ran on. In edit mode the
 * span becomes the widget its field descriptor asks for, so the reader edits
 * the sentence rather than a form beside it; the caller rescans and the prose
 * rewrites itself.
 */

import type { LeaseLite } from "../engine/types.ts";
import type { LeaseArticle, LeaseDoc, LeaseSection, Paragraph, Run } from "../lease/doc.ts";
import type { ClauseId, FieldId, FieldValue } from "../lease/fields.ts";
import { CLAUSE_LABEL, fieldById } from "../lease/fields.ts";
import { anchorFor } from "../lease/sections.ts";
import { h } from "./dom.ts";

export interface LeaseViewOptions {
  /** Section ref to highlight briefly, when a citation chip sends the reader here. */
  flashRef?: string | null;
  editing?: boolean;
  /** True when a draft differs from the signed lease. */
  edited?: boolean;
  /** The abstract behind the document — the source of the widgets' values. */
  lease?: LeaseLite;
  onToggleEdit?: (on: boolean) => void;
  onReset?: () => void;
  onField?: (id: FieldId, value: FieldValue) => void;
  onClause?: (clause: ClauseId, on: boolean) => void;
}

function widgetFor(run: Extract<Run, { field: FieldId }>, opts: LeaseViewOptions): HTMLElement {
  const d = fieldById(run.field);
  const lease = opts.lease;
  if (!d || !lease || !opts.onField) return h("span", { class: "param" }, run.text);
  const id = `lw-${run.field.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const value = d.get(lease);

  if (d.widget.kind === "select") {
    const sel = h(
      "select",
      { id, class: "param-edit", "aria-label": d.label },
      ...d.widget.options.map(([v, label]) => h("option", { value: v, selected: v === value }, label)),
    ) as HTMLSelectElement;
    sel.addEventListener("change", () => opts.onField!(run.field, sel.value));
    return sel;
  }

  const w = d.widget;
  const input = h("input", {
    id,
    class: "param-edit num",
    type: "number",
    step: w.step,
    min: w.min,
    max: w.max,
    "aria-label": d.label,
    value: value === undefined ? "" : String(value),
  }) as HTMLInputElement;
  input.style.width = `${Math.max(6, String(value ?? "").length + 4)}ch`;
  input.addEventListener("change", () => {
    const raw = input.value.trim();
    const v = raw === "" ? undefined : Number(raw);
    opts.onField!(run.field, v !== undefined && Number.isFinite(v) ? v : undefined);
  });
  return h("span", { class: "param-wrap" }, input, w.unit ? h("span", { class: "param-unit" }, w.unit) : null);
}

function renderParagraph(p: Paragraph, opts: LeaseViewOptions): HTMLElement {
  return h(
    "p",
    { class: "lease-p" },
    ...p.runs.map((r) => {
      if (!("field" in r)) return document.createTextNode(r.text);
      if (opts.editing) return widgetFor(r, opts);
      return h("span", { class: "param", title: `lease abstract: ${r.field}` }, r.text);
    }),
  );
}

function renderSection(s: LeaseSection, opts: LeaseViewOptions): HTMLElement {
  const classes = ["lease-section"];
  if (!s.present) classes.push("absent");
  if (s.source === "shell") classes.push("shell");
  if (opts.flashRef === s.ref) classes.push("flash");

  const clauseBtn =
    opts.editing && s.clause && opts.onClause
      ? h(
          "button",
          {
            type: "button",
            id: `clause-${s.clause}`,
            class: `clause-btn${s.clauseOn ? " strike" : " add"}`,
            onClick: () => opts.onClause!(s.clause!, !s.clauseOn),
          },
          s.clauseOn ? `Strike ${CLAUSE_LABEL[s.clause]}` : `Add ${CLAUSE_LABEL[s.clause]}`,
        )
      : null;

  return h(
    "div",
    { class: classes.join(" "), id: anchorFor(s.ref) },
    h(
      "h4",
      { class: "lease-sec-h" },
      h("span", { class: "sec-ref" }, s.ref),
      h("span", { class: "sec-title" }, s.title),
      !s.present ? h("span", { class: "sec-tag" }, "not in this lease") : null,
    ),
    ...s.paragraphs.map((p) => renderParagraph(p, opts)),
    clauseBtn,
  );
}

function renderArticle(a: LeaseArticle, opts: LeaseViewOptions): HTMLElement {
  return h(
    "section",
    { class: "lease-article" },
    h("h3", { class: "lease-art-h" }, `Article ${a.numeral} — ${a.title}`),
    ...a.sections.map((s) => renderSection(s, opts)),
  );
}

function renderToolbar(opts: LeaseViewOptions): HTMLElement | null {
  if (!opts.onToggleEdit) return null;
  return h(
    "div",
    { class: "lease-toolbar" },
    h(
      "button",
      { type: "button", id: "lease-edit-toggle", class: opts.editing ? "primary-btn" : "ghost-btn", "aria-pressed": String(!!opts.editing), onClick: () => opts.onToggleEdit!(!opts.editing) },
      opts.editing ? "Done editing" : "Edit this lease",
    ),
    opts.edited
      ? h(
          "span",
          { class: "edited-pill" },
          h("span", {}, "Redlined — the report below is scanned against this lease, not the signed one."),
          opts.onReset ? h("button", { type: "button", class: "ghost-btn", onClick: opts.onReset }, "Reset to signed lease") : null,
        )
      : null,
  );
}

export function renderLeaseDoc(doc: LeaseDoc, opts: LeaseViewOptions = {}): HTMLElement {
  return h(
    "div",
    { class: `panel lease-doc${opts.editing ? " editing" : ""}` },
    h("p", { class: "lease-notice" }, doc.notice),
    renderToolbar(opts),
    h("h2", { class: "lease-title" }, doc.title),
    h("p", { class: "lease-parties" }, doc.parties),
    h(
      "p",
      { class: "lease-legend" },
      opts.editing
        ? "Change a tinted value, or strike a clause outright. The scan reruns on every change and the findings move with it."
        : "Tinted values are the lease abstract the scan ran on — the same numbers the checks read.",
    ),
    ...doc.articles.map((a) => renderArticle(a, opts)),
  );
}
