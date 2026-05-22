import { describe, expect, it } from "vitest";

import { assertFederationTransportUrl, isLoopbackHostname } from "./transport-policy.js";

describe("federation transport policy", () => {
  it("allows https federation URLs", () => {
    expect(() => {
      assertFederationTransportUrl("https://stacy.example/api/federation", "federation delivery");
    }).not.toThrow();
  });

  it("allows http loopback URLs for the local demo", () => {
    for (const url of [
      "http://127.0.0.1:3100/api/federation",
      "http://127.10.20.30:3100/api/federation",
      "http://localhost:3100/api/federation",
      "http://[::1]:3100/api/federation",
    ]) {
      expect(() => assertFederationTransportUrl(url, "federation delivery")).not.toThrow();
    }
  });

  it("rejects non-loopback http URLs", () => {
    expect(() => {
      assertFederationTransportUrl("http://stacy.example/api/federation", "federation delivery");
    }).toThrow("must use https://");
    expect(() => {
      assertFederationTransportUrl("http://192.168.1.10:3100/api/federation", "revocation lookup");
    }).toThrow("must use https://");
  });

  it("identifies loopback hostnames narrowly", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("example.localhost.test")).toBe(false);
    expect(isLoopbackHostname("10.0.0.1")).toBe(false);
  });
});
