/**
 * The one place in this repo that names a sibling application's address.
 *
 * Recon Foundry forges complete synthetic reconciliation packages, and one of
 * the files it emits is a ReconPackage in this engine's own shape — so the
 * honest answer to "I want to try this but I can't upload a client's file" is a
 * link to it. The interchange is a *file*: downloaded there, uploaded here.
 * Nothing in this module opens a connection; it produces an `href`, and the
 * page's Content-Security-Policy still forbids every outbound request.
 *
 * A hostname switch rather than a build-time constant so that `npm run dev`
 * sends you to Foundry's dev server. The family pins one port per app; Foundry's
 * is 5174, because this app already had 5173.
 */

const FOUNDRY_DEV = "http://localhost:5174/";
const FOUNDRY_LIVE = "https://foundry.petriumalpha.com/";

export function foundryUrl(): string {
  const host = typeof location === "undefined" ? "" : location.hostname;
  return host === "localhost" || host === "127.0.0.1" ? FOUNDRY_DEV : FOUNDRY_LIVE;
}
