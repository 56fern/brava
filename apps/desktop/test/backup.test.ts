import { describe, expect, it } from "vitest";
import { validateAppData } from "../src/shared/backup.js";

describe("Brava backup validation", () => {
  it("accepts a complete empty backup", () => {
    expect(validateAppData({ profiles: [], proxies: [], taskGroups: [], tasks: [], harvesters: [] })).toEqual({ profileGroups: [], proxyGroups: [], profiles: [], proxies: [], taskGroups: [], tasks: [], harvesters: [] });
  });

  it("migrates legacy profiles and proxies into persisted groups", () => {
    const data = validateAppData({
      profiles: [{ id: "p1", name: "Home", email: "a@example.com", firstName: "A", lastName: "B", address1: "1 Main", city: "Boston", region: "MA", postalCode: "02101", country: "US", phone: "555" }],
      proxies: [{ id: "x1", name: "route", protocol: "http", host: "127.0.0.1", port: 8080, username: "", password: "" }],
      tasks: [], harvesters: [],
    });
    expect(data.profileGroups).toHaveLength(1);
    expect(data.proxyGroups).toHaveLength(1);
    expect(data.profiles[0]?.groupId).toBe(data.profileGroups[0]?.id);
    expect(data.proxies[0]?.groupId).toBe(data.proxyGroups[0]?.id);
  });

  it("preserves complete encrypted payment details during validation", () => {
    const data = validateAppData({
      profileGroups: [{ id: "g1", name: "Personal" }],
      profiles: [{
        id: "p1", groupId: "g1", name: "Home", email: "a@example.com", firstName: "A", lastName: "B",
        address1: "1 Main", address2: "", city: "Boston", region: "MA", postalCode: "02101", country: "US", phone: "555",
        payment: { cardholderName: "A B", brand: "Visa", number: "4242424242424242", last4: "4242", expiryMonth: "08", expiryYear: "2029", cvv: "123", billingSameAsShipping: true },
      }],
      proxyGroups: [], proxies: [], taskGroups: [], tasks: [], harvesters: [],
    });

    expect(data.profiles[0]?.payment).toMatchObject({ number: "4242424242424242", cvv: "123", last4: "4242" });
  });

  it("rejects unrelated or malformed JSON data", () => {
    expect(() => validateAppData({ hello: "world" })).toThrow(/not a Brava/i);
    expect(() => validateAppData({ profiles: [], proxies: [{ port: "bad" }], tasks: [], harvesters: [] })).toThrow();
  });
});
