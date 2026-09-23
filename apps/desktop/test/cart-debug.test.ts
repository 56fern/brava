import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CartDebugController } from "../src/main/cart-debug.js";
import { permitsCartDebugUrl } from "../src/shared/cart-debug.js";
import { CheckoutAutomation } from "../src/main/checkout-automation.js";
import type { CartDebugRunOptions } from "../src/main/cart-debug.js";
import { buildAddToCartScript, buildCartDiagnosticsScript, buildCartEvidenceScript, buildCaptchaDetectionScript, buildCheckoutPageStateScript, buildOpenCartScript } from "../src/shared/checkout-scripts.js";

describe("cart-only debug safety", () => {
  it("only permits official product/cart pages, never payment or accounts", () => {
    expect(permitsCartDebugUrl("https://www.pokemoncenter.com/product/10-10608-101")).toBe(true);
    expect(permitsCartDebugUrl("https://www.pokemoncenter.com/cart")).toBe(true);
    for (const path of ["checkout/payment", "checkout/address", "orders", "account", "cart/checkout"]) expect(permitsCartDebugUrl(`https://www.pokemoncenter.com/${path}`)).toBe(false);
    expect(permitsCartDebugUrl("https://pokemoncenter.com.evil.test/cart")).toBe(false);
  });

  it.each([false, true])("stops on the cart (empty=%s) and cannot reach checkout or profile filling", async (empty) => {
    let cart = false;
    let clicked = false;
    const checkpoint = vi.fn(async () => undefined);
    const script = vi.fn(async (source: string) => {
      if (source === buildCaptchaDetectionScript()) return { detected: false };
      if (source === buildAddToCartScript()) { clicked = true; return { clicked: true }; }
      if (source === buildCartEvidenceScript()) return { count: clicked ? 1 : 0 };
      if (source === buildCheckoutPageStateScript()) return { state: cart ? "cart" : "product" };
      if (source === buildOpenCartScript(false) || source === buildOpenCartScript(true)) { cart = true; return { clicked: true }; }
      if (source === buildCartDiagnosticsScript()) return { empty, controls: empty ? [] : ["checkout"] };
      throw new Error("Unexpected checkout script executed");
    });
    const task = { variant: "", quantity: 1, checkoutStage: "product" } as never;
    // A throwing profile proves no personal/payment property is accessed.
    const profile = new Proxy({}, { get: () => { throw new Error("Profile must not be read"); } }) as never;
    const result = await new CheckoutAutomation(async () => undefined).run(task, profile, { executeJavaScript: script, getURL: () => `https://www.pokemoncenter.com/${cart ? "cart" : "product/1"}`, getTitle: () => "Cart" }, undefined, undefined, undefined, { cartOnly: true, checkpoint });
    expect(result.status).toBe("cancelled");
    expect(result.message).toMatch(empty ? /empty cart/ : /before checkout/);
    expect(script.mock.calls.filter(([source]) => source === buildAddToCartScript())).toHaveLength(1);
    expect(checkpoint).toHaveBeenCalledWith("Before Add to Cart");
    expect(checkpoint).toHaveBeenCalledWith("Add to Cart clicked");
  });

  it("rejects resume at a checkout stage before executing any script", async () => {
    const executeJavaScript = vi.fn();
    const result = await new CheckoutAutomation().run({ checkoutStage: "payment" } as never, {} as never, { executeJavaScript, getURL: () => "", getTitle: () => "" }, undefined, undefined, undefined, { cartOnly: true, checkpoint: async () => undefined });
    expect(result.status).toBe("cancelled");
    expect(executeJavaScript).not.toHaveBeenCalled();
  });

  it("captures hidden pages in memory, strips query strings, and clears on close", async () => {
    const debug = new CartDebugController();
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getURL: () => "https://www.pokemoncenter.com/cart?token=secret",
      capturePage: vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => "data:image/png;base64,test" })),
    });
    let options!: CartDebugRunOptions;
    debug.start("t1", async (signal, value) => {
      options = value;
      value.ready(contents as never);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { status: "cancelled", message: "Stopped" };
    });
    await options.checkpoint("Before click");
    expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true, stayAwake: true });
    expect(debug.state().snapshots[0].url).toBe("https://www.pokemoncenter.com/cart");
    expect(() => debug.start("t2", vi.fn())).toThrow(/Stop/);
    await debug.stop(true);
    expect(debug.state().snapshots).toEqual([]);
    expect(debug.state().latest).toBeUndefined();
    expect(contents.listenerCount("did-start-navigation")).toBe(0);
  });

  it("discards a capture if navigation changes while capturePage is pending", async () => {
    const debug = new CartDebugController();
    let finish!: (value: unknown) => void;
    let url = "https://www.pokemoncenter.com/cart";
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, getURL: () => url, capturePage: () => new Promise((resolve) => { finish = resolve; }) });
    let options!: CartDebugRunOptions;
    debug.start("t1", async (signal, value) => {
      options = value; value.ready(contents as never);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { status: "cancelled", message: "Stopped" };
    });
    const capture = options.checkpoint("Live");
    await Promise.resolve();
    url = "https://www.pokemoncenter.com/checkout/payment";
    contents.emit("did-start-navigation");
    finish({ isEmpty: () => false, toDataURL: () => "must-not-leak" });
    await capture;
    expect(debug.state().latest).toBeUndefined();
    await debug.stop(true);
  });

  it("stops immediately even if the hidden compositor never returns a screenshot", async () => {
    const debug = new CartDebugController();
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, getURL: () => "https://www.pokemoncenter.com/cart", capturePage: () => new Promise(() => {}) });
    debug.start("t1", async (_signal, options) => {
      options.ready(contents as never);
      await options.checkpoint("Waiting for screenshot");
      return { status: "cancelled", message: "Stopped" };
    });
    await Promise.resolve();
    await debug.stop(true);
    expect(debug.state().running).toBe(false);
    expect(debug.state().snapshots).toEqual([]);
  });

  it("cart navigation never clicks a combined Cart / Checkout control", () => {
    const checkoutClick = vi.fn();
    const cartClick = vi.fn();
    const element = (textContent: string, href: string, click: () => void) => ({ textContent, offsetParent: {}, disabled: false, hasAttribute: () => false, setAttribute: () => {}, getAttribute: (name: string) => name === "href" ? href : null, click });
    new Function("document", "location", `return ${buildOpenCartScript()}`)({ querySelectorAll: () => [element("Cart / Checkout", "/cart/checkout", checkoutClick), element("View Cart", "/cart", cartClick)] }, { origin: "https://www.pokemoncenter.com" });
    expect(checkoutClick).not.toHaveBeenCalled();
    expect(cartClick).toHaveBeenCalledOnce();
  });
});
