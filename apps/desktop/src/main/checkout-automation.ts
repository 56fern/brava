import type { Task } from "../shared/types.js";
import {
  buildAddToCartScript,
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

  /** Runs the full automatic checkout in the caller-supplied webContents. */
  async run(task: Task, profile: Parameters<typeof buildCheckoutFields>[0], webContents: CheckoutWebContents): Promise<CheckoutOutcome> {
    if (task.variant.trim() || task.effectiveQuantity !== undefined) {
      await webContents.executeJavaScript(buildProductPageScript(task.variant, task.effectiveQuantity ?? task.quantity), true);
    }
    const cart = (await webContents.executeJavaScript(buildAddToCartScript(), true)) as { clicked?: boolean } | null;
    if (!cart?.clicked) {
      return { status: "declined", message: "No add-to-cart control was found on the product page; nothing was ordered." };
    }
    await this.nap(1_500);
    const proceed = (await webContents.executeJavaScript(buildProceedToCheckoutScript(), true)) as { clicked?: boolean } | null;
    if (proceed?.clicked) await this.nap(2_000);
    const filled = await this.readFields(webContents, profile);
    if (filled.missing.length) {
      return { status: "declined", message: `Checkout form missing fields: ${filled.missing.join(", ")}. Nothing was ordered.` };
    }
    await this.nap(500);
    const submit = (await webContents.executeJavaScript(buildSubmitOrderScript(), true)) as { clicked?: boolean } | null;
    if (!submit?.clicked) {
      return { status: "declined", message: "No place-order control was found; the cart was filled but not ordered." };
    }
    await this.nap(2_500);
    const confirmation = parseOrderConfirmation({
      url: webContents.getURL(),
      title: webContents.getTitle(),
      bodyText: (await webContents.executeJavaScript("document.body?.innerText ?? ''", true)) as string,
    });
    if (!confirmation.confirmed) {
      return { status: "declined", message: "Order submission was clicked but no confirmation appeared; verify the page before retrying." };
    }
    const amount = confirmation.total ? Number(confirmation.total.replace(/[^0-9.]/g, "")) : undefined;
    return {
      status: "completed",
      orderNumber: confirmation.orderNumber,
      amount: Number.isFinite(amount) ? amount : undefined,
      message: confirmation.orderNumber
        ? `Order ${confirmation.orderNumber} placed automatically`
        : "Order placed automatically",
    };
  }
}
