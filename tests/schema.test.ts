import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import schema from "../schema/recon-package.schema.json";
import { PACKAGES } from "../src/data/index.ts";

const ajv = new Ajv({ allErrors: true, strict: true, multipleOfPrecision: 6 });
const validate = ajv.compile(schema);

describe("JSON schema", () => {
  it.each(PACKAGES.map((p) => [p.meta.package_id, p] as const))("%s validates against recon-package.schema.json", (_id, pkg) => {
    const ok = validate(pkg);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("rejects a package with a non-money amount and an unknown field", () => {
    const bad = JSON.parse(JSON.stringify(PACKAGES[0]));
    bad.years[0].lines[0].amount = 1.234;
    bad.meta.client_code = "x";
    expect(validate(bad)).toBe(false);
    const paths = (validate.errors ?? []).map((e) => e.instancePath + " " + e.message);
    expect(paths.some((p) => p.includes("amount"))).toBe(true);
    expect(paths.some((p) => p.includes("additional properties"))).toBe(true);
  });
});
