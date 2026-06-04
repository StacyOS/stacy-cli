import { describe, expect, it } from "vitest";

import { resolveFederationIdentityPath } from "./paths.js";

describe("federation identity paths", () => {
  it("stores the federation install identity under the Stacy instance secrets directory", () => {
    expect(resolveFederationIdentityPath("/tmp/stacy/instances/demo")).toBe(
      "/tmp/stacy/instances/demo/secrets/federation-install-identity.json",
    );
  });
});
