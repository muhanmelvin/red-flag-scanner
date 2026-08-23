/**
 * UI entry. DOM code only — imports the engine, never the reverse.
 * State: which package is selected, the scan config, the last result.
 */

import "./styles.css";
import type { ReconPackage, ScanConfig, ScanResult } from "../engine/types.ts";
import { DEFAULT_CONFIG } from "../engine/types.ts";
import { scan } from "../engine/scan.ts";
import { PACKAGES, packageById } from "../data/index.ts";
import { $, clear } from "./dom.ts";
import { renderConfig, renderFindings, renderPicker, renderSkips, renderSummary } from "./render.ts";
import { mountUploadPanel } from "./upload.ts";

interface State {
  selectedId: string | null;
  pkg: ReconPackage | null;
  config: ScanConfig;
  result: ScanResult | null;
  uploadOpen: boolean;
  configOpen: boolean;
}

const state: State = {
  selectedId: null,
  pkg: null,
  config: { ...DEFAULT_CONFIG },
  result: null,
  uploadOpen: false,
  configOpen: false,
};

const uploaded = new Map<string, ReconPackage>();

function allPackages(): ReconPackage[] {
  return [...PACKAGES, ...uploaded.values()];
}

function pick(id: string, scrollTo = true): void {
  const pkg = packageById(id) ?? uploaded.get(id) ?? null;
  state.selectedId = pkg ? id : null;
  state.pkg = pkg;
  state.uploadOpen = false;
  rescan();
  renderAll();
  if (pkg && scrollTo) $("summary").scrollIntoView({ block: "start" });
  if (pkg) history.replaceState(null, "", `#${encodeURIComponent(id)}`);
}

function rescan(): void {
  if (!state.pkg) {
    state.result = null;
    return;
  }
  const t0 = performance.now();
  state.result = scan(state.pkg, state.config);
  const ms = performance.now() - t0;
  $("build-info").textContent = `Last scan: ${state.pkg.meta.package_id}, ${state.result.findings.length} findings in ${ms.toFixed(1)} ms. ${import.meta.env.DEV ? "dev build" : "production build"}.`;
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
  if (!state.result || !state.pkg) {
    summary.hidden = true;
    findings.hidden = true;
    return;
  }
  summary.hidden = false;
  findings.hidden = false;
  const sb = $("summary-body");
  clear(sb);
  sb.append(renderSummary(state.result, state.pkg));
  $("summary-h").textContent = `Summary — ${state.pkg.meta.package_id}: ${state.pkg.meta.tenant_name}, ${state.pkg.meta.property_name}`;

  const list = $("findings-list");
  clear(list);
  list.append(...renderFindings(state.result, state.pkg));

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
