import { describe, expect, it } from "vitest";

import { CanonicalizationError, canonicalize } from "./canonical.js";

describe("canonicalize", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalize({ z: 1, a: 2, m: "x" })).toBe('{"a":2,"m":"x","z":1}');
  });

  it("sorts nested object keys while preserving array order", () => {
    const left = canonicalize({
      content: [{ z: true, a: null }],
      tenant: "stacy/acme",
    });
    const right = canonicalize({
      tenant: "stacy/acme",
      content: [{ a: null, z: true }],
    });

    expect(left).toBe(right);
    expect(left).toBe('{"content":[{"a":null,"z":true}],"tenant":"stacy/acme"}');
  });

  it("rejects unsupported JSON values instead of silently dropping them", () => {
    expect(() => canonicalize({ a: undefined } as never)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.NaN as never)).toThrow(CanonicalizationError);
    expect(() => canonicalize((() => undefined) as never)).toThrow(
      CanonicalizationError,
    );
  });

  it("rejects circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => canonicalize(circular as never)).toThrow(CanonicalizationError);
  });
});
