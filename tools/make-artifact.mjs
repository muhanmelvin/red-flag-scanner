/**
 * Turns dist-single/index.html into the body-only page a claude.ai artifact
 * expects (the host supplies <!doctype>/<html>/<head>/<body>): title + style +
 * body + inline module script. Quick-share only — the employer-facing URL is
 * the public repo + static host.
 *
 *   npm run build:single && node tools/make-artifact.mjs [out.html]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "dist-single/index.html");
const out = resolve(root, process.argv[2] ?? "dist-single/artifact.html");
const s = readFileSync(src, "utf8");

const title = /<title>.*?<\/title>/s.exec(s)?.[0] ?? "<title>Recon Red-Flag Scanner</title>";
const si = s.indexOf('<script type="module" crossorigin>');
const lh = s.lastIndexOf("</head>");
const se = s.lastIndexOf("</script>", lh) + "</script>".length;
const script = s.slice(si, se).replace('<script type="module" crossorigin>', '<script type="module">');
let style = s.slice(s.lastIndexOf("<style", lh), lh);
style = style.slice(0, style.lastIndexOf("</style>") + "</style>".length);
const lb = s.lastIndexOf("<body>");
const body = s.slice(lb + "<body>".length, s.lastIndexOf("</body>"));
if (si < 0 || lb < 0 || !style) throw new Error("make-artifact: unexpected single-file layout");
writeFileSync(out, `${title}\n${style}\n${body}\n${script}\n`, "utf8");
console.log(`make-artifact: wrote ${out}`);
