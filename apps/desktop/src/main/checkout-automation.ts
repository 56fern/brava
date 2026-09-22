import type { CheckoutStage, Task } from "../shared/types.js";
import {
  buildAddToCartScript,
  buildCaptchaDetectionScript,
  buildCheckoutFields,
  buildFillFieldsScript,
  buildProductPageScript,
  buildProceedToCheckoutScript,
  buildSubmitOrderScript,
  parseOrderConfirmation,
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

  private async readFields(webContents: CheckoutWebContents, profile: Parameters<typeof buildCheckoutFields>[0]): Promise<{ filled: string[]; missing: string[] }> {
    const fields = buildCheckoutFields(profile);
    const result = (await webContents.executeJavaScript(buildFillFieldsScript(fields), true)) as {
      filled?: string[];
      missing?: string[];
    } | null;
    return { filled: result?.filled ?? [], missing: result?.missing ?? [] };
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
  async run(task: Task, profile: Parameters<typeof buildCheckoutFields>[0], webContents: CheckoutWebContents): Promise<CheckoutOutcome> {
    const alreadyConfirmed = parseOrderConfirmation({ url: webContents.getURL(), title: webContents.getTitle(), bodyText: "" });
    if (alreadyConfirmed.confirmed) {
      const existingConfirmation = await this.confirmation(webContents);
      if (existingConfirmation) return existingConfirmation;
    }
    let stage = task.checkoutStage ?? "product";

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
        if (cart?.clicked) { cartClicked = true; stage = "checkout"; break; }
        await this.nap(pollIntervalMs);
      }
      if (!cartClicked) return { status: "declined", message: `Add to Cart did not appear after waiting on ${this.pageContext(webContents)}. Nothing was ordered.` };
    }

    if (stage === "checkout") {
      const required = buildCheckoutFields(profile).map((field) => field.label);
      const filledLabels = new Set<string>();
      let missing = required;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const captcha = await this.captcha(webContents, "checkout");
        if (captcha) return captcha;
        const filled = await this.readFields(webContents, profile);
        filled.filled.forEach((label) => filledLabels.add(label));
        missing = required.filter((label) => !filledLabels.has(label));
        if (!missing.length) { stage = "submit"; break; }
        await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
        await this.nap(pollIntervalMs);
      }
      if (stage !== "submit") {
        return { status: "declined", message: `Checkout form did not become ready after waiting on ${this.pageContext(webContents)}. Fields not found on the page: ${missing.join(", ")}. Nothing was ordered.` };
      }
    }

    if (stage === "submit") {
      let submitted = false;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const captcha = await this.captcha(webContents, "submit");
        if (captcha) return captcha;
        const existingConfirmation = await this.confirmation(webContents);
        if (existingConfirmation) return existingConfirmation;
        const submit = (await webContents.executeJavaScript(buildSubmitOrderScript(), true)) as ClickResult;
        if (submit?.clicked) { submitted = true; stage = "confirmation"; break; }
        await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
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
