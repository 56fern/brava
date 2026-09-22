import { describe, expect, it, vi } from "vitest";
import {
  buildAddToCartScript,
  buildCaptchaDetectionScript,
  buildCheckoutFields,
  buildCheckoutPageStateScript,
  buildFillFieldsScript,
  buildGuestCheckoutScript,
  buildOpenCartScript,
  buildProductPageScript,
  buildSubmitOrderScript,
  parseOrderConfirmation,
  splitPaymentFields,
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
    expect(labels).toEqual(expect.arrayContaining(["First name", "Email", "Phone", "Address", "City", "State / region", "Postal code", "Country", "Payment method", "Card number", "Security code"]));
    const card = fields.find((field) => field.label === "Card number");
    expect(card?.value).toBe("4242424242424242");
    expect(buildFillFieldsScript(fields)).toContain("4242424242424242");
    expect(buildFillFieldsScript(fields)).toContain("autocomplete='cc-number'");
  });

  it("matches labeled name fields first and never reuses an input", () => {
    const fields = buildCheckoutFields({
      id: "p1", groupId: "g", name: "Jane Martinucci", email: "jane@example.com", firstName: "Jane", lastName: "Martinucci",
      address1: "1 Main St", address2: "", city: "New York", region: "NY", postalCode: "10001", country: "US", phone: "555-0100",
    });
    const script = buildFillFieldsScript(fields);
    expect(script).toContain("const labeledControl = (field)");
    expect(script).toContain("const used = new Set()");
    expect(script).toContain("!used.has(candidate)");
    expect(script).toContain('"value":"Jane"');
    expect(script).toContain('"value":"Martinucci"');
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
      buildOpenCartScript(),
      buildGuestCheckoutScript(),
      buildCheckoutPageStateScript(),
      buildCaptchaDetectionScript(),
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
    let page: "product" | "cart" | "guest" | "shipping" | "payment" | "review" | "confirmation" = "product";
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("return { state: 'confirmation'")) return { state: page };
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return page === "confirmation" ? "Thank you for your order! Order Number: PC-998877 Order Total $54.99" : "";
        if (script.includes("place your order")) { calls.push("place order"); page = "confirmation"; return { clicked: true }; }
        if (script.includes("data-brava-clicked")) { calls.push("add to cart"); return { clicked: true }; }
        if (script.includes("data-brava-opened-cart")) { calls.push("open cart"); page = "cart"; return { clicked: true }; }
        if (script.includes("data-brava-guest-clicked")) {
          if (page !== "guest") return { clicked: false };
          calls.push("guest checkout"); page = "shipping"; return { clicked: true };
        }
        if (script.includes("data-brava-last-clicked")) {
          calls.push(page === "cart" ? "checkout" : page === "shipping" ? "continue shipping" : "continue payment");
          page = page === "cart" ? "guest" : page === "shipping" ? "payment" : "review";
          return { clicked: true };
        }
        if (script.includes("const plan =")) { calls.push(page === "shipping" ? "fill shipping" : "fill payment"); return { filled: [], missing: [] }; }
        calls.push("variant"); return { variant: "Blue / L", quantity: "2" };
      },
      getURL: () => `https://www.pokemoncenter.com/${page === "product" ? "product/x" : page === "cart" ? "cart" : page === "guest" ? "checkout" : page === "shipping" ? "checkout/address" : page === "payment" ? "checkout/payment" : page === "review" ? "checkout/review" : "confirmation"}`,
      getTitle: () => page === "confirmation" ? "Thank You" : "Pokémon Center",
    };
    const automation = new CheckoutAutomation(noSleep);
    const outcome = await automation.run(task as never, profile as never, webContents);
    expect(outcome.status).toBe("completed");
    expect(calls).toEqual(expect.arrayContaining(["add to cart", "open cart", "checkout", "guest checkout", "fill shipping", "continue shipping", "fill payment", "continue payment", "place order"]));
    expect(calls.indexOf("open cart")).toBeLessThan(calls.indexOf("guest checkout"));
    expect(calls.indexOf("fill shipping")).toBeLessThan(calls.indexOf("fill payment"));
  });

  it("declines without ordering when add-to-cart is missing", async () => {
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("const plan =")) return { filled: [], missing: ["First name"] };
        return { clicked: false };
      },
      getURL: () => "https://www.pokemoncenter.com/product/x",
      getTitle: () => "Product",
    };
    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents);
    expect(outcome.status).toBe("declined");
    expect(outcome.status === "declined" && outcome.message).toMatch(/Add to Cart/i);
  });

  it("stops polling and clicking as soon as checkout is cancelled", async () => {
    const controller = new AbortController();
    let scriptCalls = 0;
    const webContents = {
      executeJavaScript: async (script: string) => {
        scriptCalls += 1;
        if (script.includes("challenges.cloudflare")) return { detected: false };
        return { clicked: false };
      },
      getURL: () => "https://www.pokemoncenter.com/product/x",
      getTitle: () => "Product",
    };
    const neverSleep = () => new Promise<void>(() => undefined);
    const running = new CheckoutAutomation(neverSleep).run(task as never, profile as never, webContents, controller.signal);
    await vi.waitFor(() => expect(scriptCalls).toBe(4));
    const callsAtStop = scriptCalls;
    controller.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(scriptCalls).toBe(callsAtStop);
  });

  it("selects Credit/Debit Card before filling card details", () => {
    const fields = buildCheckoutFields(profile as never);
    const paymentMethod = fields.find((field) => field.label === "Payment method");
    expect(paymentMethod).toMatchObject({ value: "Credit/Debit Card" });
    expect(fields.indexOf(paymentMethod!)).toBeLessThan(fields.findIndex((field) => field.label === "Card number"));
    const payment = splitPaymentFields(fields);
    expect(payment.method.map((field) => field.label)).toEqual(["Payment method"]);
    expect(payment.details.map((field) => field.label)).toEqual(expect.arrayContaining(["Card number", "Card expiry month", "Card expiry year", "Security code"]));
    const detailScript = buildFillFieldsScript(payment.details);
    expect(detailScript).toContain("select[name*='month' i]");
    expect(detailScript).toContain("select[name*='year' i]");
    expect(detailScript).toContain("if (node.value !== option.value)");
  });

  it("waits for the card controls after selecting the payment method", async () => {
    const calls: string[] = [];
    let page: "payment" | "review" | "confirmation" = "payment";
    let methodSelected = false;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("return { state: 'confirmation'")) return { state: page };
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return page === "confirmation" ? "Thank you for your order! Order Number: PC-777777" : "";
        if (script.includes('"label":"Payment method"')) { calls.push("select method"); methodSelected = true; return { filled: ["Payment method"], missing: [] }; }
        if (script.includes('"label":"Card number"')) {
          calls.push("fill card details");
          return methodSelected ? { filled: ["Card number", "Card expiry month", "Card expiry year", "Security code"], missing: [] } : { filled: [], missing: ["Card number"] };
        }
        if (script.includes("data-brava-last-clicked")) { calls.push("continue payment"); page = "review"; return { clicked: true }; }
        if (script.includes("place your order")) { calls.push("place order"); page = "confirmation"; return { clicked: true }; }
        return {};
      },
      getURL: () => `https://www.pokemoncenter.com/${page === "payment" ? "checkout/payment" : page === "review" ? "checkout/review" : "confirmation"}`,
      getTitle: () => page === "confirmation" ? "Thank You" : "Checkout",
    };

    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "payment" } as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "completed", orderNumber: "PC-777777" });
    expect(calls).toEqual(["select method", "fill card details", "continue payment", "place order"]);
  });

  it("pauses only when the live page actually exposes a CAPTCHA", async () => {
    const calls: string[] = [];
    const challengeUrl = "https://www.pokemoncenter.com/challenge/checkout";
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: true, url: challengeUrl };
        calls.push(script);
        return { clicked: false };
      },
      getURL: () => challengeUrl,
      getTitle: () => "Security check",
    };
    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "captcha", challengeUrl, resumeStage: "product" });
    expect(calls).toHaveLength(0);
  });

  it("polls until delayed checkout fields render instead of blaming the profile", async () => {
    let fillAttempts = 0;
    let page: "product" | "cart" | "guest" | "shipping" | "payment" | "review" | "confirmation" = "product";
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("return { state: 'confirmation'")) return { state: page };
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return page === "confirmation" ? "Thank you for your order! Order Number: PC-123456" : "";
        if (script.includes("const plan =")) {
          if (page === "shipping") {
            fillAttempts += 1;
            return fillAttempts < 3 ? { filled: [], missing: ["First name"] } : { filled: ["First name"], missing: [] };
          }
          return { filled: ["Card number"], missing: [] };
        }
        if (script.includes("place your order")) { page = "confirmation"; return { clicked: true }; }
        if (script.includes("data-brava-clicked")) return { clicked: true };
        if (script.includes("data-brava-opened-cart")) { page = "cart"; return { clicked: true }; }
        if (script.includes("data-brava-guest-clicked")) {
          if (page !== "guest") return { clicked: false };
          page = "shipping"; return { clicked: true };
        }
        if (script.includes("data-brava-last-clicked")) {
          if (page === "cart") page = "guest";
          else if (page === "shipping" && fillAttempts >= 3) page = "payment";
          else if (page === "payment") page = "review";
          return { clicked: true };
        }
        return {};
      },
      getURL: () => `https://www.pokemoncenter.com/${page === "product" ? "product/x" : page === "cart" ? "cart" : page === "shipping" ? "checkout/address" : page === "payment" ? "checkout/payment" : page === "review" ? "checkout/review" : page === "confirmation" ? "confirmation" : "checkout"}`,
      getTitle: () => page === "confirmation" ? "Thank You" : "Checkout",
    };

    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents);
    expect(fillAttempts).toBe(3);
    expect(outcome).toMatchObject({ status: "completed", orderNumber: "PC-123456" });
  });

  it("resumes confirmation after CAPTCHA without clicking Add to Cart or Place Order again", async () => {
    let addToCartCalls = 0;
    let submitCalls = 0;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return "Thank you for your order! Order Number: PC-654321";
        if (script.includes("add to cart")) { addToCartCalls += 1; return { clicked: true }; }
        if (script.includes("place your order")) { submitCalls += 1; return { clicked: true }; }
        return {};
      },
      getURL: () => "https://www.pokemoncenter.com/confirmation",
      getTitle: () => "Thank You",
    };

    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "confirmation" } as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "completed", orderNumber: "PC-654321" });
    expect(addToCartCalls).toBe(0);
    expect(submitCalls).toBe(0);
  });
});
