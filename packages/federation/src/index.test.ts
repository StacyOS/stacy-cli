import { describe, expect, it } from "vitest";
import { federationPackageName } from "./index.js";

describe("federation package scaffold", () => {
  it("loads as the sealed StacyOS federation workspace package", () => {
    expect(federationPackageName).toBe("@arpanstacy/stacy-federation");
  });
});
