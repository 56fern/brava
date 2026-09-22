import { describe, expect, it, vi } from "vitest";
import {
  buildAddToCartScript,
  buildCartEvidenceScript,
  buildCaptchaDetectionScript,
  buildCartDiagnosticsScript,
  buildCheckoutFields,
  buildCheckoutErrorScript,
  buildCheckoutPageStateScript,
  buildFillFieldsScript,
  buildGuestCheckoutScript,
  buildOpenCartScript,
  buildProceedToCheckoutScript,
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

  it("uses each checkout field's own DOM realm for iframe-safe assignment", () => {
    const script = buildFillFieldsScript(buildCheckoutFields({
      id: "p1", groupId: "g", name: "Jane Doe", email: "jane@example.com", firstName: "Jane", lastName: "Doe",
      address1: "1 Main St", address2: "", city: "New York", region: "NY", postalCode: "10001", country: "US", phone: "555-0100",
      payment: { cardholderName: "Jane Doe", brand: "Visa", number: "4242424242424242", last4: "4242", expiryMonth: "08", expiryYear: "2029", cvv: "123", billingSameAsShipping: true },
    }));
    expect(script).toContain("element.ownerDocument?.defaultView || window");
    expect(script).toContain("view.HTMLInputElement.prototype");
    expect(script).toContain("new view.Event('input'");
    expect(script).toContain("node.tagName?.toLowerCase() === 'select'");
    expect(script).toContain("isControl(candidate) && !used.has(candidate)");
    expect(script).toContain("if (!isControl(node)) return false");
    expect(script).not.toContain("element instanceof HTMLSelectElement");
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
      buildCartEvidenceScript(),
      buildOpenCartScript(),
      buildProceedToCheckoutScript(),
      buildCartDiagnosticsScript(),
      buildGuestCheckoutScript(),
      buildCheckoutPageStateScript(),
      buildCaptchaDetectionScript(),
      buildSubmitOrderScript(),
      buildCheckoutErrorScript(),
      buildFillFieldsScript(buildCheckoutFields({ id: "p", groupId: "g", name: "n", email: "e@e.com", firstName: "a", lastName: "b", address1: "x", address2: "", city: "c", region: "NY", postalCode: "1", country: "US", phone: "5" })),
    ]) {
      expect(() => new Function(`return (${source.replace(/;$/, "")})`)).not.toThrow();
    }
    expect(buildProductPageScript("Blue / L", 2)).toContain('"Blue / L"');
  });

  it("ignores an ordinary reCAPTCHA badge but detects a visible challenge iframe", () => {
    const badge = { getBoundingClientRect: () => ({ width: 70, height: 70 }) };
    const challenge = { getBoundingClientRect: () => ({ width: 320, height: 420 }) };
    const evaluate = (challengeVisible: boolean) => new Function("document", "location", "getComputedStyle", `return ${buildCaptchaDetectionScript()}`)(
      {
        title: "Checkout",
        querySelector: (selector: string) => selector === 'iframe[src*="recaptcha" i]' ? badge : challengeVisible && selector === 'iframe[src*="/bframe" i]' ? challenge : null,
      },
      { pathname: "/checkout/review", href: "https://www.pokemoncenter.com/checkout/review" },
      () => ({ display: "block", visibility: "visible" }),
    ) as { detected: boolean };

    expect(evaluate(false).detected).toBe(false);
    expect(evaluate(true).detected).toBe(true);
  });

  it("clicks a fixed-position CHECK OUT button on the cart despite its missing offset parent", () => {
    let clicked = 0;
    const attributes = new Map<string, string>();
    const button = {
      textContent: "  CHECK\n OUT  ", value: "", disabled: false, offsetParent: null,
      getClientRects: () => [{ width: 200, height: 40 }],
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      click: () => { clicked += 1; },
    };
    const continueShopping = {
      ...button, textContent: "Continue Shopping", offsetParent: {},
      click: () => { throw new Error("Continue Shopping must not be clicked"); },
    };
    const result = new Function("document", "location", `return ${buildProceedToCheckoutScript()}`)(
      { querySelectorAll: () => [continueShopping, button] }, { pathname: "/cart" },
    ) as { clicked: boolean };
    expect(result.clicked).toBe(true);
    expect(clicked).toBe(1);
  });

  it("reports only cart-control labels when checkout cannot advance", () => {
    const result = new Function("document", `return ${buildCartDiagnosticsScript()}`)(
      {
        querySelectorAll: () => [{ textContent: "Check Out", offsetParent: {}, getAttribute: () => null }],
        body: { innerText: "Shopping Cart: 1 item" },
      },
    ) as { empty: boolean; controls: string[] };
    expect(result).toEqual({ empty: false, controls: ["check out"] });
  });

  it("opens the cart without clicking Add to Cart a second time", () => {
    const clicked: string[] = [];
    const element = (label: string, href = "") => ({
      textContent: label, offsetParent: {}, disabled: false,
      hasAttribute: () => false, setAttribute: () => undefined,
      getAttribute: (name: string) => name === "href" ? href : null,
      click: () => clicked.push(label),
    });
    const result = new Function("document", "location", `return ${buildOpenCartScript()}`)(
      { querySelectorAll: () => [element("Add to Cart"), element("View Cart", "/cart")] },
      { origin: "https://www.pokemoncenter.com" },
    );
    expect(result.clicked).toBe(true);
    expect(clicked).toEqual(["View Cart"]);
  });

  it("does not report a disabled Place Order control as submitted", () => {
    const click = vi.fn();
    const button = { textContent: "Place Order", offsetParent: {}, disabled: false, click,
      getAttribute: (name: string) => name === "aria-disabled" ? "true" : null,
      hasAttribute: () => false, setAttribute: () => undefined };
    const result = new Function("document", `return ${buildSubmitOrderScript()}`)({ querySelectorAll: () => [button] });
    expect(result.clicked).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it("reads a cart badge without confusing the Add to Cart button for confirmation", () => {
    const cartLink = {
      offsetParent: {}, textContent: "Cart 1", getAttribute: (name: string) => name === "aria-label" ? "Cart 1" : null,
      querySelectorAll: () => [],
    };
    const addButton = {
      offsetParent: {}, textContent: "Add to Cart 9", getAttribute: (name: string) => name === "aria-label" ? "Add to Cart 9" : null,
      querySelectorAll: () => [],
    };
    const result = new Function("document", `return ${buildCartEvidenceScript()}`)(
      { querySelectorAll: (selector: string) => selector.includes('a[href*="/cart"') ? [addButton, cartLink] : [], body: { innerText: "Add to Cart" } },
    ) as { count: number; added: boolean };
    expect(result).toEqual({ count: 1, added: false });
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
    let added = false;
    let sleptMs = 0;
    let page: "product" | "cart" | "guest" | "shipping" | "payment" | "review" | "confirmation" = "product";
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("return { state: 'confirmation'")) return { state: page };
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("const cartLinks =")) return { count: added ? 1 : 0, added: false };
        if (script.includes("document.body?.innerText")) return page === "confirmation" ? "Thank you for your order! Order Number: PC-998877 Order Total $54.99" : "";
        if (script.includes("place your order")) { calls.push("place order"); page = "confirmation"; return { clicked: true }; }
        if (script.includes("data-brava-clicked")) { added = true; calls.push("add to cart"); return { clicked: true }; }
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
        if (script.includes("const plan =")) {
          calls.push(page === "shipping" ? "fill shipping" : "fill payment");
          if (script.includes('"label":"Payment method"')) return { filled: ["Payment method"], missing: [] };
          return page === "shipping"
            ? { filled: ["First name", "Last name", "Email", "Phone", "Address", "City", "State / region", "Postal code", "Country"], missing: [] }
            : { filled: ["Cardholder name", "Card number", "Card expiry month", "Card expiry year", "Security code"], missing: [] };
        }
        calls.push("variant"); return { variant: "Blue / L", quantity: "2" };
      },
      getURL: () => `https://www.pokemoncenter.com/${page === "product" ? "product/x" : page === "cart" ? "cart" : page === "guest" ? "checkout" : page === "shipping" ? "checkout/address" : page === "payment" ? "checkout/payment" : page === "review" ? "checkout/review" : "confirmation"}`,
      getTitle: () => page === "confirmation" ? "Thank You" : "Pokémon Center",
    };
    const automation = new CheckoutAutomation(async (ms) => { sleptMs += ms; });
    const outcome = await automation.run(task as never, profile as never, webContents, undefined, undefined, async () => {
      expect(sleptMs).toBe(0);
      calls.push("carted status");
    });
    expect(outcome.status).toBe("completed");
    expect(calls).toEqual(expect.arrayContaining(["add to cart", "open cart", "checkout", "guest checkout", "fill shipping", "continue shipping", "fill payment", "continue payment", "place order"]));
    expect(calls.indexOf("open cart")).toBeLessThan(calls.indexOf("guest checkout"));
    expect(calls.indexOf("carted status")).toBeLessThan(calls.indexOf("open cart"));
    expect(calls.filter((call) => call === "carted status")).toHaveLength(1);
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

  it("reports an empty cart instead of claiming checkout was submitted", async () => {
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("return { state: 'confirmation'")) return { state: "cart" };
        if (script.includes("data-brava-clicked")) return { clicked: true };
        if (script.includes("your shopping cart is empty")) return { empty: true, controls: [] };
        return { clicked: false };
      },
      getURL: () => "https://www.pokemoncenter.com/cart",
      getTitle: () => "Shopping Cart | Pokémon Center",
    };
    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents);
    expect(outcome.status).toBe("declined");
    expect(outcome.message).toContain("reports an empty cart");
    expect(outcome.message).toContain("checkout was not attempted");
  });

  it("waits for cart-count evidence before leaving the product page", async () => {
    let page = "product";
    let clickedAdd = false;
    let evidenceReads = 0;
    let evidenceReadsAtCartOpen = -1;
    let cartReports = 0;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("return { state: 'confirmation'")) return { state: page };
        if (script.includes("const cartLinks =")) {
          evidenceReads += 1;
          return { count: clickedAdd && evidenceReads >= 5 ? 1 : 0, added: false };
        }
        if (script.includes("data-brava-clicked")) { clickedAdd = true; return { clicked: true }; }
        if (script.includes("data-brava-opened-cart")) {
          expect(cartReports).toBe(1);
          evidenceReadsAtCartOpen = evidenceReads;
          page = "cart";
          return { clicked: true };
        }
        if (script.includes("your shopping cart is empty")) return { empty: true, controls: [] };
        return { clicked: false };
      },
      getURL: () => `https://www.pokemoncenter.com/${page === "cart" ? "cart" : "product/x"}`,
      getTitle: () => page,
    };
    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents, undefined, undefined, async () => { cartReports += 1; });
    expect(outcome.status).toBe("declined");
    expect(evidenceReadsAtCartOpen).toBeGreaterThanOrEqual(5);
    expect(cartReports).toBe(1);
  });

  it("reports an add-to-cart site error without navigating away from the product", async () => {
    let cartOpened = false;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("return { state: 'confirmation'")) return { state: "product" };
        if (script.includes("const cartLinks =")) return { count: 0, added: false };
        if (script.includes("data-brava-clicked")) return { clicked: true };
        if (script.includes("const selectors = ['[role=\"alert\"]'")) return ["Unable to add item to cart"];
        if (script.includes("data-brava-opened-cart")) cartOpened = true;
        return { clicked: false };
      },
      getURL: () => "https://www.pokemoncenter.com/product/x",
      getTitle: () => "Product",
    };
    const outcome = await new CheckoutAutomation(noSleep).run(task as never, profile as never, webContents);
    expect(outcome.status).toBe("declined");
    expect(outcome.message).toContain("Unable to add item to cart");
    expect(cartOpened).toBe(false);
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
    await vi.waitFor(() => expect(scriptCalls).toBe(5));
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

  it("does not continue to review when a required card field is absent", async () => {
    let continueClicks = 0;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("return { state: 'confirmation'")) return { state: "payment" };
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes('"label":"Payment method"')) return { filled: ["Payment method"] };
        if (script.includes('"label":"Card number"')) return { filled: ["Card number", "Card expiry month", "Card expiry year"] };
        if (script.includes("data-brava-last-clicked")) { continueClicks += 1; return { clicked: true }; }
        return [];
      },
      getURL: () => "https://www.pokemoncenter.com/checkout/payment",
      getTitle: () => "Payment",
    };

    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "payment" } as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "declined" });
    expect(outcome.message).toContain("Security code");
    expect(continueClicks).toBe(0);
  });

  it("includes a visible site error after one Place Order click without retrying", async () => {
    let submitClicks = 0;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return "An error occurred while placing the order.";
        if (script.includes("place your order")) { submitClicks += 1; return { clicked: true }; }
        if (script.includes(".error-message")) return ["An error occurred while placing the order."];
        return {};
      },
      getURL: () => "https://www.pokemoncenter.com/checkout/review",
      getTitle: () => "Review Order",
    };

    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "submit" } as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "declined" });
    expect(outcome.message).toContain("Site error: An error occurred while placing the order.");
    expect(submitClicks).toBe(1);
  });

  it("reports Submitting order only after Place Order is clicked", async () => {
    const events: string[] = [];
    let placed = false;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return placed ? "Thank you for your order! Order Number: PC-123456" : "Review order";
        if (script.includes("place your order")) { events.push("clicked"); placed = true; return { clicked: true }; }
        return {};
      },
      getURL: () => placed ? "https://www.pokemoncenter.com/confirmation" : "https://www.pokemoncenter.com/checkout/review",
      getTitle: () => placed ? "Thank You" : "Review Order",
    };
    const onSubmittingOrder = vi.fn(async () => { events.push("submitting"); });

    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "submit" } as never, profile as never, webContents, undefined, onSubmittingOrder);
    expect(outcome.status).toBe("completed");
    expect(events).toEqual(["clicked", "submitting"]);
    expect(onSubmittingOrder).toHaveBeenCalledTimes(1);
  });

  it("fills payment details across Electron child frames", async () => {
    const calls: string[] = [];
    let page: "payment" | "review" | "confirmation" = "payment";
    const topFrame = {
      name: "main checkout",
      executeJavaScript: async (script: string) => {
        if (script.includes('"label":"Payment method"')) { calls.push("method in main"); return { filled: ["Payment method"] }; }
        return { filled: [] };
      },
    };
    const cardFrame = {
      name: "hosted card fields",
      executeJavaScript: async (script: string) => {
        if (script.includes('"label":"Card number"')) {
          calls.push("details in child");
          return { filled: ["Cardholder name", "Card number", "Card expiry month", "Card expiry year", "Security code"] };
        }
        return { filled: [] };
      },
    };
    const webContents = {
      mainFrame: { ...topFrame, framesInSubtree: [topFrame, cardFrame] },
      executeJavaScript: async (script: string) => {
        if (script.includes("return { state: 'confirmation'")) return { state: page };
        if (script.includes("challenges.cloudflare")) return { detected: false };
        if (script.includes("document.body?.innerText")) return page === "confirmation" ? "Thank you for your order! Order Number: PC-888888" : "";
        if (script.includes("data-brava-last-clicked")) { calls.push("continue payment"); page = "review"; return { clicked: true }; }
        if (script.includes("place your order")) { calls.push("place order"); page = "confirmation"; return { clicked: true }; }
        return {};
      },
      getURL: () => `https://www.pokemoncenter.com/${page === "payment" ? "checkout/payment" : page === "review" ? "checkout/review" : "confirmation"}`,
      getTitle: () => page === "confirmation" ? "Thank You" : "Checkout",
    };

    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "payment" } as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "completed", orderNumber: "PC-888888" });
    expect(calls).toEqual(["method in main", "details in child", "continue payment", "place order"]);
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
          if (script.includes('"label":"Payment method"')) return { filled: ["Payment method"], missing: [] };
          if (page === "shipping") {
            fillAttempts += 1;
            return fillAttempts < 3
              ? { filled: [], missing: ["First name"] }
              : { filled: ["First name", "Last name", "Email", "Phone", "Address", "City", "State / region", "Postal code", "Country"], missing: [] };
          }
          return { filled: ["Cardholder name", "Card number", "Card expiry month", "Card expiry year", "Security code"], missing: [] };
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

  it("recognizes order confirmation before treating a remaining CAPTCHA widget as a challenge", async () => {
    let captchaChecks = 0;
    const webContents = {
      executeJavaScript: async (script: string) => {
        if (script.includes("challenges.cloudflare")) { captchaChecks += 1; return { detected: true }; }
        if (script.includes("document.body?.innerText")) return "Thank you for your order! Order Number: PC-654321";
        return {};
      },
      getURL: () => "https://www.pokemoncenter.com/checkout/confirmation",
      getTitle: () => "Thank You",
    };
    const outcome = await new CheckoutAutomation(noSleep).run({ ...task, checkoutStage: "confirmation" } as never, profile as never, webContents);
    expect(outcome).toMatchObject({ status: "completed", orderNumber: "PC-654321" });
    expect(captchaChecks).toBe(0);
  });
});
