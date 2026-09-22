import type { CheckoutStage, Task } from "../shared/types.js";
import {
  buildAddToCartScript,
  buildCaptchaDetectionScript,
  buildCheckoutPageStateScript,
  buildFillFieldsScript,
  buildGuestCheckoutScript,
  buildOpenCartScript,
  buildPaymentFields,
  buildProductPageScript,
  buildProceedToCheckoutScript,
  buildShippingFields,
  buildSubmitOrderScript,
  parseOrderConfirmation,
  type CheckoutPageState,
} from "../shared/checkout-scripts.js";

/** Structural subset of Electron's webContents so the engine is unit-testable. */
export type CheckoutWebContents = {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  getURL: () => string;
  getTitle: () => string;
};

export type CheckoutOutcome =
  | { status: "completed"; orderNumber?: string; amount?: number; message: string }
  | { status: "captcha"; challengeUrl: string; harvesterId?: string; resumeStage: CheckoutStage; message: string }
  | { status: "declined"; message: string };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pollAttempts = 40;
const pollIntervalMs = 300;
type ClickResult = { clicked?: boolean; candidates?: unknown } | null;

/**
 * Drives a harvester window through add-to-cart and checkout without any user
 * input: variant/quantity selection, profile autofill, order submission, and
 * confirmation parsing. Every step is tolerant of a missing element so a page
 * change degrades into a clear decline instead of a crash.
 */
export class CheckoutAutomation {
  constructor(private readonly nap: (ms: number) => Promise<void> = delay) {}

  private async readFields(webContents: CheckoutWebContents, fields: Parameters<typeof buildFillFieldsScript>[0]): Promise<{ filled: string[]; missing: string[] }> {
    const result = (await webContents.executeJavaScript(buildFillFieldsScript(fields), true)) as {
      filled?: string[];
      missing?: string[];
    } | null;
    return { filled: result?.filled ?? [], missing: result?.missing ?? [] };
  }

  private async pageState(webContents: CheckoutWebContents): Promise<CheckoutPageState> {
    const result = (await webContents.executeJavaScript(buildCheckoutPageStateScript(), true)) as { state?: CheckoutPageState } | null;
    return result?.state ?? "unknown";
  }

  private async captcha(webContents: CheckoutWebContents, resumeStage: CheckoutStage): Promise<Extract<CheckoutOutcome, { status: "captcha" }> | null> {
    const result = (await webContents.executeJavaScript(buildCaptchaDetectionScript(), true)) as { detected?: boolean; url?: string } | null;
    if (!result?.detected) return null;
    return {
      status: "captcha",
      challengeUrl: result.url || webContents.getURL(),
      resumeStage,
      message: "CAPTCHA detected · checkout paused briefly for the harvester",
    };
  }

  private pageContext(webContents: CheckoutWebContents): string {
    return `${webContents.getTitle() || "Untitled page"} at ${webContents.getURL() || "an unknown URL"}`;
  }

  private async confirmation(webContents: CheckoutWebContents): Promise<Extract<CheckoutOutcome, { status: "completed" }> | null> {
    const parsed = parseOrderConfirmation({
      url: webContents.getURL(),
      title: webContents.getTitle(),
      bodyText: (await webContents.executeJavaScript("document.body?.innerText ?? ''", true)) as string,
    });
    if (!parsed.confirmed) return null;
    const amount = parsed.total ? Number(parsed.total.replace(/[^0-9.]/g, "")) : undefined;
    return {
      status: "completed",
      orderNumber: parsed.orderNumber,
      amount: Number.isFinite(amount) ? amount : undefined,
      message: parsed.orderNumber ? `Order ${parsed.orderNumber} placed automatically` : "Order placed automatically",
    };
  }

  /** Runs the full automatic checkout in the caller-supplied webContents. */
  async run(task: Task, profile: Parameters<typeof buildShippingFields>[0], webContents: CheckoutWebContents): Promise<CheckoutOutcome> {
    const alreadyConfirmed = parseOrderConfirmation({ url: webContents.getURL(), title: webContents.getTitle(), bodyText: "" });
    if (alreadyConfirmed.confirmed) {
      const existingConfirmation = await this.confirmation(webContents);
      if (existingConfirmation) return existingConfirmation;
    }
    let stage: CheckoutStage = task.checkoutStage === "checkout" ? "cart" : task.checkoutStage === "submit" ? "review" : task.checkoutStage ?? "product";

    if (stage === "product") {
      const initialCaptcha = await this.captcha(webContents, "product");
      if (initialCaptcha) return initialCaptcha;
      if (task.variant.trim() || task.effectiveQuantity !== undefined) {
        await webContents.executeJavaScript(buildProductPageScript(task.variant, task.effectiveQuantity ?? task.quantity), true);
      }
      let cartClicked = false;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const captcha = await this.captcha(webContents, "product");
        if (captcha) return captcha;
        const cart = (await webContents.executeJavaScript(buildAddToCartScript(), true)) as ClickResult;
        if (cart?.clicked) { cartClicked = true; stage = "cart"; break; }
        await this.nap(pollIntervalMs);
      }
      if (!cartClicked) return { status: "declined", message: `Add to Cart did not appear after waiting on ${this.pageContext(webContents)}. Nothing was ordered.` };
    }

    if (stage === "cart" || stage === "guest") {
      await this.nap(pollIntervalMs * 2);
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const detectedState = await this.pageState(webContents);
        const resumeStage: CheckoutStage = detectedState === "guest" ? "guest" : "cart";
        const captcha = await this.captcha(webContents, resumeStage);
        if (captcha) return captcha;
        if (detectedState === "shipping" || detectedState === "payment" || detectedState === "review" || detectedState === "confirmation") {
          stage = detectedState;
          break;
        }
        if (detectedState === "guest") {
          stage = "guest";
          await webContents.executeJavaScript(buildGuestCheckoutScript(), true) as ClickResult;
        } else if (detectedState === "cart") {
          stage = "cart";
          await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
        } else {
          const guest = await webContents.executeJavaScript(buildGuestCheckoutScript(), true) as ClickResult;
          if (!guest?.clicked) {
            const cart = await webContents.executeJavaScript(buildOpenCartScript(attempt >= 2), true) as ClickResult;
            if (!cart?.clicked) await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
          }
        }
        await this.nap(pollIntervalMs);
      }
      if (stage === "cart" || stage === "guest") {
        return { status: "declined", message: `Brava added the item but could not reach Guest Checkout after waiting on ${this.pageContext(webContents)}. Nothing was ordered.` };
      }
    }

    if (stage === "shipping") {
      const fields = buildShippingFields(profile);
      let missing = fields.map((field) => field.label);
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const captcha = await this.captcha(webContents, "shipping");
        if (captcha) return captcha;
        const detectedState = await this.pageState(webContents);
        if (detectedState === "payment" || detectedState === "review" || detectedState === "confirmation") { stage = detectedState; break; }
        const filled = await this.readFields(webContents, fields);
        missing = filled.missing;
        await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
        await this.nap(pollIntervalMs);
      }
      if (stage === "shipping") return { status: "declined", message: `Shipping could not continue after waiting on ${this.pageContext(webContents)}. Fields not found: ${missing.join(", ") || "none; check the page validation message"}. Nothing was ordered.` };
    }

    if (stage === "payment") {
      const fields = buildPaymentFields(profile);
      if (!fields.some((field) => field.label === "Card number")) return { status: "declined", message: "The assigned profile has no complete payment card. Nothing was ordered." };
      let missing = fields.map((field) => field.label);
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const captcha = await this.captcha(webContents, "payment");
        if (captcha) return captcha;
        const detectedState = await this.pageState(webContents);
        if (detectedState === "review" || detectedState === "confirmation") { stage = detectedState; break; }
        const filled = await this.readFields(webContents, fields);
        missing = filled.missing;
        await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
        await this.nap(pollIntervalMs);
      }
      if (stage === "payment") return { status: "declined", message: `Payment could not continue after waiting on ${this.pageContext(webContents)}. Fields not found: ${missing.join(", ") || "none; check the page validation message"}. Nothing was ordered.` };
    }

    if (stage === "review") {
      let submitted = false;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const captcha = await this.captcha(webContents, "review");
        if (captcha) return captcha;
        const existingConfirmation = await this.confirmation(webContents);
        if (existingConfirmation) return existingConfirmation;
        const submit = (await webContents.executeJavaScript(buildSubmitOrderScript(), true)) as ClickResult;
        if (submit?.clicked) { submitted = true; stage = "confirmation"; break; }
        await this.nap(pollIntervalMs);
      }
      if (!submitted) return { status: "declined", message: `Place Order did not appear after waiting on ${this.pageContext(webContents)}. Nothing was ordered.` };
    }

    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const captcha = await this.captcha(webContents, "confirmation");
      if (captcha) return captcha;
      const confirmation = await this.confirmation(webContents);
      if (confirmation) return confirmation;
      await this.nap(pollIntervalMs);
    }
    return { status: "declined", message: `Place Order was clicked once, but no confirmation appeared after waiting on ${this.pageContext(webContents)}. Verify the order before retrying.` };
  }
}
