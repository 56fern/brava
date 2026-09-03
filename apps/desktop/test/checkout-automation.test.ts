import { describe, expect, it } from "vitest";
import {
  buildAddToCartScript,
  buildCheckoutFields,
  buildFillFieldsScript,
  buildProductPageScript,
  buildSubmitOrderScript,
  parseOrderConfirmation,
} from "../src/shared/checkout-scripts.js";
import { CheckoutAutomation } from "../src/main/checkout-automation.js";

describe("checkout scripts", () => {
  it("builds profile fields for shipping, contact, and payment", () => {
    const fields = buildCheckoutFields({
      id: "p1",
      groupId: "g",
      name: "Jane Doe",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      address1: "1 Main St",
      address2: "",
      city: "New York",
      region: "NY",
      postalCode: "10001",
      country: "US",
      phone: "555-0100",
      payment: { cardholderName: "Jane Doe", brand: "Visa", number: "4242424242424242", last4: "4242", expiryMonth: "08", expiryYear: "2029", cvv: "123", billingSameAsShipping: true },
    });
    const labels = fields.map((field) => field.label);
    expect(labels).toEqual(expect.arrayContaining(["First name", "Email", "Phone", "Address", "City", "Postal code", "Card number", "Security code"]));
    const card = fields.find((field) => field.label === "Card number");
    expect(card?.value).toBe("4242424242424242");
    expect(buildFillFieldsScript(fields)).toContain("4242424242424242");
    expect(buildFillFieldsScript(fields)).toContain("autocomplete='cc-number'");
  });

  it("omits payment fields when the profile has no card", () => {
    const fields = buildCheckoutFields({
      id: "p1", groupId: "g", name: "Jane Doe", email: "jane@example.com", firstName: "Jane", lastName: "Doe",
      address1: "1 Main St", address2: "", city: "New York", region: "NY", postalCode: "10001", country: "US", phone: "555-0100",
    });
    expect(fields.some((field) => field.label === "Card number")).toBe(false);
    expect(fields.some((field) => field.label === "Email")).toBe(true);
  });

  it("emits compilable page scripts for variant, cart, and submit steps", () => {
    for (const source of [
      buildProductPageScript("Blue / L", 2),
      buildAddToCartScript(),
      buildSubmitOrderScript(),
      buildFillFieldsScript(buildCheckoutFields({ id: "p", groupId: "g", name: "n", email: "e@e.com", firstName: "a", lastName: "b", address1: "x", address2: "", city: "c", region: "NY", postalCode: "1", country: "US", phone: "5" })),
    ]) {
      expect(() => new Function(`return (${source.replace(/;$/, "")})`)).not.toThrow();
    }
    expect(buildProductPageScript("Blue / L", 2)).toContain('"Blue / L"');
  });

  it("parses order confirmation markers and rejects non-confirmation pages", () => {
    expect(parseOrderConfirmation({ url: "https://www.pokemoncenter.com/confirmation", title: "Thank You", bodyText: "Order Number: PC-998877 Order Total $54.99" })).toEqual({ confirmed: true, orderNumber: "PC-998877", total: "$54.99" });
    expect(parseOrderConfirmation({ url: "https://www.pokemoncenter.com/product/x", title: "Product", bodyText: "Choose a size" }).confirmed).toBe(false);
  });
});

describe("CheckoutAutomation engine", () => {
  const task = { id: "task-1", name: "x", productUrl: "https://www.pokemoncenter.com/product/x", sku: "X", variant: "Blue / L", quantity: 2, profileId: "p1", proxyId: "", status: "adding_to_cart" as const, statusMessage: "", updatedAt: "", history: [] };
  const profile = { id: "p1", groupId: "g", name: "Jane Doe", email: "jane@example.com", firstName: "Jane", lastName: "Doe", address1: "1 Main St", address2: "", city: "New York", region: "NY", postalCode: "10001", country: "US", phone: "555-0100", payment: { cardholderName: "Jane Doe", brand: "Visa" as const, number: "4242424242424242", last4: "4242", expiryMonth: "08", expiryYear: "2029", cvv: "123", billingSameAsShipping: true } };
  const noSleep = async () => undefined;

  it("completes checkout and reports the order number", async () => {
    const calls: string[] = [];
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("document.body?.innerText")) return "Thank you for your order! Order Number: PC-998877 Order Total $54.99";
        if (script.includes("place your order")) { calls.push("submit"); return { clicked: true }; }
        if (script.includes("add to cart") || script.includes("view cart")) { calls.push("cart"); return { clicked: true }; }
        if (script.includes("document.querySelector")) { calls.push("fill"); return { filled: ["First name"], missing: [] }; }
        calls.push("variant"); return { variant: "Blue / L", quantity: "2" };
      },
      getURL: () => "https://www.pokemoncenter.com/confirmation",
      getTitle: () => "Thank You",
    };
    const automation = new CheckoutAutomation(noSleep);
    const outcome = await automation.run(task as never, profile as never, webContents);
    expect(outcome.status).toBe("completed");
    expect(calls).toContain("cart");
    expect(calls).toContain("fill");
    expect(calls).toContain("submit");
  });

  it("declines without ordering when add-to-cart is missing", async () => {
    const webContents = {
      executeJavaScript: async () => ({ clicked: false }),
      getURL: () => "https://www.pokemoncenter.com/product/x",
      getTitle: () => "Product",
    };
    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents);
    expect(outcome.status).toBe("declined");
    expect(outcome.status === "declined" && outcome.message).toContain("add-to-cart");
  });
});
