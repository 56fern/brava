import type { Task } from "../shared/types.js";
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
  | { status: "captcha"; challengeUrl: string; harvesterId?: string; message: string }
  | { status: "declined"; message: string };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  private async captcha(webContents: CheckoutWebContents): Promise<CheckoutOutcome | null> {
    const result = (await webContents.executeJavaScript(buildCaptchaDetectionScript(), true)) as { detected?: boolean; url?: string } | null;
    if (!result?.detected) return null;
    return {
      status: "captcha",
      challengeUrl: result.url || webContents.getURL(),
      message: "CAPTCHA detected · checkout paused briefly for the harvester",
    };
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
    const initialCaptcha = await this.captcha(webContents);
    if (initialCaptcha) return initialCaptcha;
    if (task.variant.trim() || task.effectiveQuantity !== undefined) {
      await webContents.executeJavaScript(buildProductPageScript(task.variant, task.effectiveQuantity ?? task.quantity), true);
    }
    const cart = (await webContents.executeJavaScript(buildAddToCartScript(), true)) as { clicked?: boolean } | null;
    if (cart?.clicked) await this.nap(1_500);
    const cartCaptcha = await this.captcha(webContents);
    if (cartCaptcha) return cartCaptcha;
    const proceed = (await webContents.executeJavaScript(buildProceedToCheckoutScript(), true)) as { clicked?: boolean } | null;
    if (proceed?.clicked) await this.nap(2_000);
    const checkoutCaptcha = await this.captcha(webContents);
    if (checkoutCaptcha) return checkoutCaptcha;
    const filled = await this.readFields(webContents, profile);
    if (filled.missing.length) {
      const formCaptcha = await this.captcha(webContents);
      if (formCaptcha) return formCaptcha;
      if (!cart?.clicked && !proceed?.clicked) {
        return { status: "declined", message: "No add-to-cart or checkout controls were found; nothing was ordered." };
      }
      return { status: "declined", message: `Checkout form missing fields: ${filled.missing.join(", ")}. Nothing was ordered.` };
    }
    await this.nap(500);
    const submit = (await webContents.executeJavaScript(buildSubmitOrderScript(), true)) as { clicked?: boolean } | null;
    if (!submit?.clicked) {
      const confirmation = await this.confirmation(webContents);
      if (confirmation) return confirmation;
      return { status: "declined", message: "No place-order control was found; the cart was filled but not ordered." };
    }
    await this.nap(2_500);
    const submitCaptcha = await this.captcha(webContents);
    if (submitCaptcha) return submitCaptcha;
    const confirmation = await this.confirmation(webContents);
    if (!confirmation) {
      return { status: "declined", message: "Order submission was clicked but no confirmation appeared; verify the page before retrying." };
    }
    return confirmation;
  }
}
