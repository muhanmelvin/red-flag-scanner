/**
 * The lease, reconstructed — a model lease generated from the package's
 * `lease_lite` abstract.
 *
 * The operative clauses (Article IV and Article VI) are written from the
 * abstract's own values, so the document, the parameters and the findings can
 * never disagree: change a value and the sentence changes with it. The rest is
 * a thin static shell (parties, premises, rent and boilerplate stubs) so the
 * operative clauses read in context.
 *
 * Clauses the abstract is silent on are still rendered, as **negative
 * clauses** — "This Lease contains no cap on Operating Expenses." That keeps
 * every citation anchor alive for every package, including uploads, and gives
 * the designer somewhere to put "Add this clause".
 *
 * Pure and deterministic: no clock, no DOM, no I/O.
 */

import type { LeaseLite, ReconPackage } from "../engine/types.ts";
import type { ClauseId, FieldId } from "./fields.ts";
import { fieldById } from "./fields.ts";
import { ARTICLES, SECTION_TITLE } from "./sections.ts";

export type Run = { text: string } | { field: FieldId; text: string };

export interface Paragraph {
  runs: Run[];
}

export interface LeaseSection {
  ref: string;
  title: string;
  /** False when the abstract is silent and the section renders as a negative clause. */
  present: boolean;
  /** Where the text comes from: the typed abstract, or the document's static shell. */
  source: "abstract" | "shell";
  /** The clause the designer can strike or add here. */
  clause?: ClauseId;
  /** Whether that clause is currently in force (differs from `present` at §4.01). */
  clauseOn?: boolean;
  paragraphs: Paragraph[];
}

export interface LeaseArticle {
  numeral: string;
  title: string;
  sections: LeaseSection[];
}

export interface LeaseDoc {
  title: string;
  parties: string;
  notice: string;
  articles: LeaseArticle[];
}

export const MODEL_LEASE_NOTICE =
  "Model lease — generated from the typed lease abstract this scan runs on. Illustrative; not an executed document.";

// ---------------------------------------------------------------------------

const t = (text: string): Run => ({ text });
const para = (...runs: Array<Run | null>): Paragraph => ({ runs: runs.filter((r): r is Run => r !== null) });

function fld(lease: LeaseLite, id: FieldId): Run {
  const d = fieldById(id);
  return d ? { field: id, text: d.prose(lease) } : t("—");
}

function ordinalYearList(years: number[]): string {
  if (years.length === 1) return `the Lease Year ended December 31, ${years[0]}`;
  return `the Lease Years ended December 31, ${years[0]} through December 31, ${years[years.length - 1]}`;
}

// ---------------------------------------------------------------------------

export function buildLeaseDoc(pkg: ReconPackage): LeaseDoc {
  const lease = pkg.lease_lite;
  const property = pkg.meta.property_name;
  const landlord = /^maplewood\b/i.test(property) ? "MAPLEWOOD OWNER, L.L.C." : `${property.toUpperCase()} OWNER, LLC`;
  const tenant = pkg.meta.tenant_name;
  const years = [...pkg.years].map((y) => y.year).sort((a, b) => a - b);

  const S: Record<string, LeaseSection> = {};
  const put = (ref: string, s: Omit<LeaseSection, "ref" | "title">) => {
    S[ref] = { ref, title: SECTION_TITLE[ref] ?? ref, ...s };
  };

  // --- Article I & II & III & V & VII: the static shell.
  put("1.01", {
    present: true,
    source: "shell",
    paragraphs: [
      para(t(`This Lease is made between ${landlord} ("Landlord") and ${tenant} ("Tenant") for premises at ${property} (the "Property").`)),
    ],
  });
  put("1.02", {
    present: true,
    source: "shell",
    paragraphs: [
      para(t('"Lease Year" means each calendar year falling within the Term. "Operating Expenses" has the meaning given in Section 6.01. "Taxes" means real property taxes and assessments levied against the Property.')),
    ],
  });
  put("2.01", {
    present: true,
    source: "abstract",
    paragraphs: [
      para(t("Landlord leases to Tenant premises of approximately "), fld(lease, "share.numerator_sf"), t(' (the "Premises") within the Property.')),
    ],
  });
  put("2.02", {
    present: true,
    source: "abstract",
    paragraphs: [para(t(`The Term includes ${ordinalYearList(years)}, being the periods reconciled under Section 6.06.`))],
  });
  put("3.01", {
    present: true,
    source: "shell",
    paragraphs: [
      para(t("Tenant shall pay Base Rent monthly in advance in the amounts set out in the Basic Provisions. Base Rent is not an Operating Expense and is not subject to reconciliation.")),
    ],
  });
  put("5.01", {
    present: true,
    source: "shell",
    paragraphs: [para(t("Tenant shall use the Premises for retail sales and lawful uses incidental thereto, and for no other purpose."))],
  });
  put("5.02", {
    present: true,
    source: "shell",
    paragraphs: [
      para(t("Landlord shall provide the common area services described in Section 6.01. Utilities separately metered to the Premises are paid by Tenant directly and are not Operating Expenses.")),
    ],
  });
  put("7.01", {
    present: true,
    source: "shell",
    paragraphs: [para(t("Notices under this Lease shall be in writing and delivered to the addresses set out in the Basic Provisions."))],
  });
  put("7.02", {
    present: true,
    source: "shell",
    paragraphs: [
      para(t("This Lease is the entire agreement of the parties as to its subject matter. No statement on a reconciliation, and no course of billing, amends it.")),
    ],
  });

  // --- 4.01 Proportionate Share.
  const statedOn = lease.share.stated_pct !== undefined;
  put("4.01", {
    present: true,
    source: "abstract",
    clause: "stated_share",
    clauseOn: statedOn,
    paragraphs: statedOn
      ? [
          para(t("Tenant's Proportionate Share is fixed at "), fld(lease, "share.stated_pct"), t(" for the Term, and is not subject to adjustment for changes in occupancy or in the area of the Property.")),
          para(t("The Premises comprise "), fld(lease, "share.numerator_sf"), t(".")),
        ]
      : [
          para(
            t("Tenant's Proportionate Share is the quotient obtained by dividing the rentable area of the Premises ("),
            fld(lease, "share.numerator_sf"),
            t(") by "),
            fld(lease, "share.denominator_basis"),
            t(", expressed as a percentage."),
          ),
          para(t("This Lease fixes no Proportionate Share percentage; the share is computed for each Lease Year, and Landlord shall state on each reconciliation the denominator used.")),
        ],
  });

  // --- 6.01 Definition and exclusions.
  const feesOutside = lease.cap?.fee_treatment === "outside_cap";
  put("6.01", {
    present: true,
    source: "abstract",
    paragraphs: [
      para(
        t('"Operating Expenses" means the costs Landlord actually incurs in owning, operating, maintaining, repairing and insuring the Property, together with Taxes, computed on an accrual basis and without duplication.'),
      ),
      para(
        t('Operating Expenses are of two classes. "Non-Controllable Operating Expenses" means only Taxes, insurance premiums, utility charges and snow and ice removal'),
        feesOutside ? t(", and any fee permitted by Section 6.03") : null,
        t('. All other Operating Expenses are "Controllable Operating Expenses." A cost\'s class is fixed by this Section and is not changed by the caption, the grouping or the vendor under which Landlord presents it on a statement.'),
      ),
      para(
        t("Operating Expenses exclude: Landlord's general overhead and the salaries of personnel above the level of on-site manager; leasing commissions, marketing and tenant improvement costs; costs reimbursed by insurance, warranty or a particular tenant; costs of correcting defective construction; capital items except as Section 6.04 permits; and any fee beyond the one permitted by Section 6.03."),
      ),
    ],
  });

  // --- 6.02 Cap.
  const cap = lease.cap;
  put("6.02", {
    present: cap !== undefined,
    source: "abstract",
    clause: "cap",
    clauseOn: cap !== undefined,
    paragraphs: cap
      ? [
          para(
            t("Notwithstanding anything in this Article to the contrary, the "),
            fld(lease, "cap.applies_to"),
            t(" payable by Tenant shall not increase by more than "),
            fld(lease, "cap.pct"),
            t(" per Lease Year, "),
            fld(lease, "cap.method"),
            t("."),
          ),
          para(
            t("The increase is measured against "),
            fld(lease, "cap.basis"),
            t(". The base for the Lease Year ended December 31, "),
            fld(lease, "cap.base_year"),
            t(" is "),
            fld(lease, "cap.base_year_amount"),
            t("."),
          ),
          para(
            t("Any fee permitted by Section 6.03 is "),
            fld(lease, "cap.fee_treatment"),
            t(" the capped amount. In no Lease Year shall Tenant be charged more than the lesser of the actual expense and the amount permitted by this Section."),
          ),
        ]
      : [
          para(
            t("This Lease contains no cap on Operating Expenses. Tenant pays its Proportionate Share of the actual costs Landlord incurs, without ceiling and without a Base Year."),
          ),
        ],
  });

  // --- 6.03 Fees.
  put("6.03", {
    present: lease.fees.length > 0,
    source: "abstract",
    clause: "fee",
    clauseOn: lease.fees.length > 0,
    paragraphs: lease.fees.length
      ? [
          ...lease.fees.map((_, i) =>
            para(
              t(i === 0 ? "Landlord may include in Operating Expenses a " : "Landlord may also include a "),
              fld(lease, `fee.${i}.kind`),
              t(" of "),
              fld(lease, `fee.${i}.rate_pct`),
              t(" of "),
              fld(lease, `fee.${i}.base`),
              t("."),
            ),
          ),
          para(
            t("A fee permitted by this Section is computed on the base stated for it and on no other amount. No fee is chargeable on Taxes, on insurance premiums, on any capital item, or on any other fee, and Landlord shall not charge both a management fee and an administrative fee for the same service."),
          ),
        ]
      : [
          para(
            t("This Lease provides for no management or administrative fee. Landlord's cost of managing the Property is part of its general overhead and is excluded from Operating Expenses by Section 6.01."),
          ),
        ],
  });

  // --- 6.04 Capital.
  const capitalOn = lease.capital_threshold !== undefined || lease.capital_life_years !== undefined;
  put("6.04", {
    present: capitalOn,
    source: "abstract",
    clause: "capital",
    clauseOn: capitalOn,
    paragraphs: capitalOn
      ? [
          para(
            t("Any item costing more than "),
            fld(lease, "capital_threshold"),
            t(" that is properly classified as a capital expenditure shall be capitalized and amortized on a straight-line basis over "),
            fld(lease, "capital_life_years"),
            t("."),
          ),
          para(
            t("Only the amortization installment attributable to the Lease Year, prorated for any partial year from the date the item is placed in service, may be included in Operating Expenses. No part of the cost may be charged in the year incurred, and no installment may be charged after the amortization period ends. Landlord shall furnish the invoice, the in-service date and the amortization schedule on request."),
          ),
        ]
      : [
          para(
            t("This Lease states no capital threshold and no amortization period. Capital items are excluded from Operating Expenses by Section 6.01, and Landlord may not recover them by charging the cost in the year incurred."),
          ),
        ],
  });

  // --- 6.05 Gross-up.
  const gu = lease.gross_up;
  put("6.05", {
    present: gu !== undefined,
    source: "abstract",
    clause: "gross_up",
    clauseOn: gu !== undefined,
    paragraphs:
      gu === undefined
        ? [
            para(
              t("This Lease permits no occupancy gross-up. Tenant pays its Proportionate Share of the costs Landlord actually incurred, and no cost may be inflated to what it would have been at a higher level of occupancy."),
            ),
          ]
        : gu.allowed
          ? [
              para(
                t("If the Property is less than "),
                fld(lease, "gross_up.to_pct"),
                t(" occupied during any Lease Year, Landlord may gross up those components of Operating Expenses that vary with occupancy to the amount that would have been incurred at "),
                fld(lease, "gross_up.to_pct"),
                t(" occupancy."),
              ),
              para(
                t("Costs that do not vary with occupancy — including Taxes, insurance premiums and fixed contract charges — shall not be grossed up, and no cost shall be grossed up beyond that level of occupancy. Landlord shall state on each reconciliation the occupancy used and the components grossed up."),
              ),
            ]
          : [
              para(
                t("Landlord shall not gross up Operating Expenses for vacancy. Tenant pays its Proportionate Share of the costs actually incurred."),
              ),
            ],
  });

  // --- 6.06 Reconciliation.
  put("6.06", {
    present: true,
    source: "abstract",
    paragraphs: [
      para(
        t("Landlord shall bill Tenant monthly estimates of Tenant's Proportionate Share of Operating Expenses, and within one hundred twenty (120) days after the end of each Lease Year shall deliver a statement showing Operating Expenses by category, Tenant's Proportionate Share, the estimates paid and the balance owing or refundable."),
      ),
      para(
        t("Each statement shall be arithmetically correct: each subtotal shall equal the sum of the amounts it comprises, the amount charged to Tenant shall equal the reconciled pool multiplied by Tenant's Proportionate Share, and the balance shall equal that amount less the estimates paid for the Lease Year. Any overpayment is credited or refunded within thirty (30) days."),
      ),
    ],
  });

  // --- 6.07 Audit rights.
  put("6.07", {
    present: true,
    source: "abstract",
    paragraphs: [
      para(
        t("Tenant may, within twenty-four (24) months after receiving a statement, examine Landlord's books and records for the Lease Year covered by it, by an examiner of Tenant's choosing, including one compensated in whole or in part on the basis of the recovery obtained."),
      ),
      para(
        t("Landlord shall make available the general ledger detail supporting each category, the invoices for any category examined, the amortization schedule for any item recovered under Section 6.04, and the occupancy and area figures used. If the examination shows Operating Expenses overstated by more than three percent (3%), Landlord shall bear the reasonable cost of the examination and shall refund the overcharge within thirty (30) days."),
      ),
    ],
  });

  const articles: LeaseArticle[] = ARTICLES.map((a) => ({
    numeral: a.numeral,
    title: a.title,
    sections: a.sections.map((s) => S[s.ref] ?? { ref: s.ref, title: s.title, present: false, source: "shell" as const, paragraphs: [] }),
  }));

  return {
    title: `Retail Lease — ${property}`,
    parties: `${landlord} (Landlord) and ${tenant} (Tenant)`,
    notice: MODEL_LEASE_NOTICE,
    articles,
  };
}

/** Flatten the document to sections, in numbering order. */
export function sectionsOf(doc: LeaseDoc): LeaseSection[] {
  return doc.articles.flatMap((a) => a.sections);
}

/** Plain text of one section — used by tests and by the copy-a-finding path. */
export function sectionText(s: LeaseSection): string {
  return s.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n\n");
}
