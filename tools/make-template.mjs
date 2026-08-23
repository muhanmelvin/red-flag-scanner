/**
 * Writes public/template.xlsx and public/template.csv — the wide-format
 * upload template (one label column, one amount column per year, optional
 * Section column, section header rows understood). Generic synthetic figures.
 *
 *   node tools/make-template.mjs
 */
import * as XLSX from "xlsx";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = resolve(root, "public");
await mkdir(pub, { recursive: true });

const rows = [
  ["Line item", "Section", 2024, 2025],
  ["Controllable CAM", "", null, null],
  ["Landscaping & grounds", "CAM", 14362.18, 14905.7],
  ["Repairs & maintenance", "CAM", 22918.4, 21466.15],
  ["Security", "CAM", 18204.0, 18750.12],
  ["Trash removal", "CAM", 7381.52, 7602.96],
  ["Non-controllable CAM", "", null, null],
  ["Common area lighting – electricity", "CAM", 11926.77, 12488.03],
  ["Snow removal", "CAM", 15212.4, 17950.63],
  ["Fees", "", null, null],
  ["Management fee (3%)", "Fees", 2712.16, 2794.91],
  ["Taxes", "", null, null],
  ["Real estate taxes", "Taxes", 112318.92, 115802.47],
  ["Insurance", "", null, null],
  ["Insurance", "Insurance", 53118.44, 57770.3],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
ws["!cols"] = [{ wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");
const notes = XLSX.utils.aoa_to_sheet([
  ["How to use this template"],
  ["One row per expense line. One column per reconciliation year, headed by the year."],
  ["Rows with a label but no amounts are treated as section headers (e.g. 'Controllable CAM') and carried into the lines below."],
  ["The Section column is optional; bucket (controllable / non-controllable) is inferred from section names and can be changed on the mapping screen."],
  ["Amounts are the property-level pool figures as billed. Do not include subtotal rows (they are skipped if labelled 'Total')."],
  ["Everything is parsed in your browser. Nothing is uploaded."],
]);
XLSX.utils.book_append_sheet(wb, notes, "Notes");
const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
await writeFile(resolve(pub, "template.xlsx"), out);

const csv = rows.map((r) => r.map((c) => (c === null ? "" : typeof c === "string" && /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(",")).join("\n") + "\n";
await writeFile(resolve(pub, "template.csv"), csv, "utf8");
console.log("wrote public/template.xlsx and public/template.csv");
