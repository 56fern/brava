import { describe, expect, it } from "vitest";
import { resolveBillingUrls } from "../src/auth-urls.js";

describe("billing redirect URLs", () => {
  it("uses the configured app page for checkout and portal returns", () => {
    const urls = resolveBillingUrls("https://api.brava.example/", "https://brava.example/account");
    expect(urls.appReturnUrl).toBe("https://brava.example/account");
    expect(urls.checkoutSuccessUrl).toBe(
      "https://brava.example/account?brava_checkout=success&checkout_id={CHECKOUT_ID}",
    );
    expect(urls.trustedOrigins).toEqual(["https://api.brava.example", "https://brava.example"]);
  });

  it("falls back to the existing health route when no app URL is configured", () => {
    const urls = resolveBillingUrls("https://api.brava.example", "");
    expect(urls.appReturnUrl).toBe("https://api.brava.example/health");
    expect(urls.checkoutSuccessUrl).toContain("/health?brava_checkout=success");
  });

  it("rejects unsafe or relative redirect destinations", () => {
    expect(() => resolveBillingUrls("https://api.brava.example", "javascript:alert(1)"))
      .toThrow("BRAVA_APP_URL must use HTTP or HTTPS");
    expect(() => resolveBillingUrls("/api", "https://brava.example"))
      .toThrow("BETTER_AUTH_URL must be an absolute HTTP(S) URL");
  });
});
