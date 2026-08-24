/**
 * Renders the model lease as a document. DOM only — every word comes from
 * `src/lease/doc.ts`, and every tinted span is a value of the lease abstract
 * the scan actually ran on.
 */

import type { LeaseArticle, LeaseDoc, LeaseSection, Paragraph } from "../lease/doc.ts";
import { anchorFor } from "../lease/sections.ts";
import { h } from "./dom.ts";

export interface LeaseViewOptions {
  /** Section ref to highlight briefly, when a citation chip sends the reader here. */
  flashRef?: string | null;
}

function renderParagraph(p: Paragraph): HTMLElement {
  return h(
    "p",
    { class: "lease-p" },
    ...p.runs.map((r) => ("field" in r ? h("span", { class: "param", title: `lease abstract: ${r.field}` }, r.text) : document.createTextNode(r.text))),
  );
}

function renderSection(s: LeaseSection, opts: LeaseViewOptions): HTMLElement {
  const classes = ["lease-section"];
  if (!s.present) classes.push("absent");
  if (s.source === "shell") classes.push("shell");
  if (opts.flashRef === s.ref) classes.push("flash");
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
    ...s.paragraphs.map(renderParagraph),
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

export function renderLeaseDoc(doc: LeaseDoc, opts: LeaseViewOptions = {}): HTMLElement {
  return h(
    "div",
    { class: "panel lease-doc" },
    h("p", { class: "lease-notice" }, doc.notice),
    h("h2", { class: "lease-title" }, doc.title),
    h("p", { class: "lease-parties" }, doc.parties),
    h("p", { class: "lease-legend" }, "Tinted values are the lease abstract the scan ran on — the same numbers the checks read."),
    ...doc.articles.map((a) => renderArticle(a, opts)),
  );
}
