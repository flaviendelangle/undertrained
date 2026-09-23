import { describe, expect, it } from "vitest";

import {
  hash,
  signApproval,
  validProof,
  validRedirect,
  verifyApproval,
} from "./desktopAuth";

describe("desktop authorization boundaries", () => {
  it("accepts only the exact IPv4 loopback callback and an unprivileged port", () => {
    expect(validRedirect("http://127.0.0.1:49152/callback")).toBe(true);
    for (const url of [
      "https://evil.example/callback",
      "http://127.0.0.1.evil.example:4000/callback",
      "http://127.0.0.1:80/callback",
      "http://user@127.0.0.1:4000/callback",
      "http://127.0.0.1:4000/callback?next=evil",
      "http://127.0.0.1:4000/other",
    ]) {
      expect(validRedirect(url)).toBe(false);
    }
  });
  it("binds browser approval to the complete request and account", () => {
    const signature = signApproval("account:1,challenge:a", "secret");
    expect(verifyApproval("account:1,challenge:a", signature, "secret")).toBe(
      true,
    );
    expect(verifyApproval("account:2,challenge:a", signature, "secret")).toBe(
      false,
    );
    expect(verifyApproval("account:1,challenge:b", signature, "secret")).toBe(
      false,
    );
    expect(verifyApproval("account:1,challenge:a", "short", "secret")).toBe(
      false,
    );
  });
  it("produces the RFC 7636 S256 challenge", () => {
    expect(hash("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(validProof(hash("value"))).toBe(true);
    expect(validProof("abc")).toBe(false);
  });
});
