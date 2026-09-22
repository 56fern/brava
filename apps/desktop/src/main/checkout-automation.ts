import type { CheckoutStage, Task } from "../shared/types.js";
import {
  buildAddToCartScript,
  buildCartEvidenceScript,
  buildCaptchaDetectionScript,
  buildCartDiagnosticsScript,
  buildCheckoutPageStateScript,
  buildCheckoutErrorScript,
  buildFillFieldsScript,
  buildGuestCheckoutScript,
  buildOpenCartScript,
  buildPaymentFields,
  buildProductPageScript,
  buildProceedToCheckoutScript,
  buildShippingFields,
  buildSubmitOrderScript,
  parseOrderConfirmation,
  splitPaymentFields,
  type CheckoutPageState,
} from "../shared/checkout-scripts.js";

/** Structural subset of Electron's webContents so the engine is unit-testable. */
export type CheckoutWebContents = {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  getURL: () => string;
  getTitle: () => string;
  mainFrame?: CheckoutFrame;
};

type CheckoutFrame = {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  isDestroyed?: () => boolean;
  readonly framesInSubtree?: readonly CheckoutFrame[];
  readonly name?: string;
  readonly url?: string;
};

export type CheckoutOutcome =
  | { status: "completed"; orderNumber?: string; amount?: number; message: string }
  | { status: "captcha"; challengeUrl: string; harvesterId?: string; resumeStage: CheckoutStage; message: string }
  | { status: "cancelled"; message: string }
  | { status: "declined"; message: string };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pollAttempts = 120;
const pollIntervalMs = 100;
const requiredPaymentLabels = ["Card number", "Card expiry month", "Card expiry year", "Security code"];
type ClickResult = { clicked?: boolean; candidates?: unknown } | null;

/**
 * Drives a harvester window through add-to-cart and checkout without any user
 * input: variant/quantity selection, profile autofill, order submission, and
 * confirmation parsing. Every step is tolerant of a missing element so a page
 * change degrades into a clear decline instead of a crash.
 */
export class CheckoutAutomation {
  constructor(private readonly nap: (ms: number) => Promise<void> = delay) {}

  private assertRunning(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException("Checkout stopped by user", "AbortError");
  }

  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    this.assertRunning(signal);
    if (!signal) return this.nap(ms);
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException("Checkout stopped by user", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void this.nap(ms).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    this.assertRunning(signal);
  }

  private async readFields(webContents: CheckoutWebContents, fields: Parameters<typeof buildFillFieldsScript>[0], signal?: AbortSignal): Promise<{ filled: string[]; missing: string[]; errors: string[] }> {
    this.assertRunning(signal);
    const script = buildFillFieldsScript(fields);
    const frameTree = webContents.mainFrame?.framesInSubtree;
    const targets: readonly CheckoutFrame[] = frameTree?.length ? frameTree : [webContents];
    const filled = new Set<string>();
    const errors: string[] = [];
    for (const [index, frame] of targets.entries()) {
      this.assertRunning(signal);
      if (frame.isDestroyed?.()) continue;
      try {
        const result = (await frame.executeJavaScript(script, true)) as { filled?: string[] } | null;
        for (const label of result?.filled ?? []) filled.add(label);
      } catch (error) {
        const location = frame.name || frame.url || `frame ${index + 1}`;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${location}: ${message}`.slice(0, 240));
      }
    }
    return {
      filled: [...filled],
      missing: fields.filter((field) => !filled.has(field.label)).map((field) => field.label),
      errors,
    };
  }

  private async pageState(webContents: CheckoutWebContents, signal?: AbortSignal): Promise<CheckoutPageState> {
    this.assertRunning(signal);
    const result = (await webContents.executeJavaScript(buildCheckoutPageStateScript(), true)) as { state?: CheckoutPageState } | null;
    return result?.state ?? "unknown";
  }

  private async captcha(webContents: CheckoutWebContents, resumeStage: CheckoutStage, signal?: AbortSignal): Promise<Extract<CheckoutOutcome, { status: "captcha" }> | null> {
    this.assertRunning(signal);
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

  private async siteErrors(webContents: CheckoutWebContents, signal?: AbortSignal): Promise<string[]> {
    this.assertRunning(signal);
    try {
      const messages = await webContents.executeJavaScript(buildCheckoutErrorScript(), true);
      return Array.isArray(messages) ? messages.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  private async confirmation(webContents: CheckoutWebContents, signal?: AbortSignal): Promise<Extract<CheckoutOutcome, { status: "completed" }> | null> {
    this.assertRunning(signal);
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
  async run(task: Task, profile: Parameters<typeof buildShippingFields>[0], webContents: CheckoutWebContents, signal?: AbortSignal, onSubmittingOrder?: () => Promise<void>, onCarted?: () => Promise<void>): Promise<CheckoutOutcome> {
    this.assertRunning(signal);
    let cartReported = Boolean(task.cartedAt);
    const reportCarted = async () => {
      this.assertRunning(signal);
      if (cartReported) return;
      cartReported = true;
      await onCarted?.();
    };
    const alreadyConfirmed = parseOrderConfirmation({ url: webContents.getURL(), title: webContents.getTitle(), bodyText: "" });
    if (alreadyConfirmed.confirmed) {
      const existingConfirmation = await this.confirmation(webContents, signal);
      if (existingConfirmation) return existingConfirmation;
    }
    let stage: CheckoutStage = task.checkoutStage === "checkout" ? "cart" : task.checkoutStage === "submit" ? "review" : task.checkoutStage ?? "product";
    if (["shipping", "payment", "review", "confirmation"].includes(stage)) await reportCarted();

    if (stage === "product") {
      const initialCaptcha = await this.captcha(webContents, "product", signal);
      if (initialCaptcha) return initialCaptcha;
      if (task.variant.trim() || task.effectiveQuantity !== undefined) {
        await webContents.executeJavaScript(buildProductPageScript(task.variant, task.effectiveQuantity ?? task.quantity), true);
      }
      const before = await webContents.executeJavaScript(buildCartEvidenceScript(), true) as { count?: number | null } | null;
      let cartClicked = false;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        this.assertRunning(signal);
        const captcha = await this.captcha(webContents, "product", signal);
        if (captcha) return captcha;
        const cart = (await webContents.executeJavaScript(buildAddToCartScript(), true)) as ClickResult;
        if (cart?.clicked) { cartClicked = true; stage = "cart"; break; }
        await this.wait(pollIntervalMs, signal);
      }
      if (!cartClicked) return { status: "declined", message: `Add to Cart did not appear after waiting on ${this.pageContext(webContents)}. Nothing was ordered.` };
      // The DOM click returns before the store's asynchronous add request
      // settles. Opening /cart immediately can interrupt that request.
      // Wait for a cart badge or success notice, with a bounded fallback for
      // storefronts that do not expose either signal.
      let cartAcknowledged = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const captcha = await this.captcha(webContents, "cart", signal);
        if (captcha) return captcha;
        const current = await this.pageState(webContents, signal);
        if (current === "cart" || current === "guest" || current === "shipping" || current === "payment" || current === "review" || current === "confirmation") {
          stage = current;
          cartAcknowledged = true;
          if (current !== "cart" && current !== "guest") await reportCarted();
          break;
        }
        const evidence = await webContents.executeJavaScript(buildCartEvidenceScript(), true) as { count?: number | null; added?: boolean } | null;
        if (evidence?.added || (typeof evidence?.count === "number" && evidence.count > (before?.count ?? 0))) {
          cartAcknowledged = true;
          await reportCarted();
          break;
        }
        await this.wait(pollIntervalMs, signal);
      }
      if (!cartAcknowledged) {
        const siteErrors = await this.siteErrors(webContents, signal);
        if (siteErrors.length) return { status: "declined", message: `Pokémon Center did not confirm the Add to Cart click on ${this.pageContext(webContents)}. Site error: ${siteErrors.join(" | ")}. Checkout was not attempted.` };
      }
    }

    if (stage === "cart" || stage === "guest") {
      let checkoutControlClicked = false;
      let emptyCartChecks = 0;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        this.assertRunning(signal);
        const detectedState = await this.pageState(webContents, signal);
        const resumeStage: CheckoutStage = detectedState === "guest" ? "guest" : "cart";
        const captcha = await this.captcha(webContents, resumeStage, signal);
        if (captcha) return captcha;
        if (detectedState === "shipping" || detectedState === "payment" || detectedState === "review" || detectedState === "confirmation") {
          stage = detectedState;
          await reportCarted();
          break;
        }
        if (detectedState === "guest") {
          stage = "guest";
          const guest = await webContents.executeJavaScript(buildGuestCheckoutScript(), true) as ClickResult;
          checkoutControlClicked ||= Boolean(guest?.clicked);
          if (guest?.clicked) await reportCarted();
        } else if (detectedState === "cart") {
          stage = "cart";
          const cart = await webContents.executeJavaScript(buildCartDiagnosticsScript(), true) as { empty?: boolean } | null;
          emptyCartChecks = cart?.empty ? emptyCartChecks + 1 : 0;
          if (emptyCartChecks >= 30) {
            const siteErrors = await this.siteErrors(webContents, signal);
            return { status: "declined", message: `Brava clicked Add to Cart, but Pokémon Center reports an empty cart at ${webContents.getURL()}.${siteErrors.length ? ` Site error: ${siteErrors.join(" | ")}.` : ""} The item was not confirmed in the cart; checkout was not attempted.` };
          }
          if (cart?.empty) { await this.wait(pollIntervalMs, signal); continue; }
          const proceed = await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
          checkoutControlClicked ||= Boolean(proceed?.clicked);
          if (proceed?.clicked) await reportCarted();
        } else {
          const guest = await webContents.executeJavaScript(buildGuestCheckoutScript(), true) as ClickResult;
          checkoutControlClicked ||= Boolean(guest?.clicked);
          if (guest?.clicked) await reportCarted();
          if (!guest?.clicked) {
            const cart = await webContents.executeJavaScript(buildOpenCartScript(attempt >= 2), true) as ClickResult;
            if (!cart?.clicked) {
              const proceed = await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
              checkoutControlClicked ||= Boolean(proceed?.clicked);
            }
          }
        }
        await this.wait(pollIntervalMs, signal);
      }
      if (stage === "cart" || stage === "guest") {
        let diagnostic = "";
        try {
          const cart = await webContents.executeJavaScript(buildCartDiagnosticsScript(), true) as { empty?: boolean; controls?: string[] } | null;
          if (cart?.empty) diagnostic = " The cart page reports that it is empty.";
          else if (cart?.controls?.length) diagnostic = ` Visible cart controls: ${cart.controls.join(" | ")}.`;
          else diagnostic = " No checkout or guest controls were visible.";
        } catch { /* Keep the original timeout if the page navigated during diagnostics. */ }
        const action = checkoutControlClicked ? "A checkout control was clicked but the page did not advance." : "No checkout control could be clicked.";
        return { status: "declined", message: `Brava clicked Add to Cart but could not reach Guest Checkout after waiting on ${this.pageContext(webContents)}. ${action}${diagnostic} Nothing was ordered.` };
      }
    }

    if (stage === "shipping") {
      const fields = buildShippingFields(profile);
      let missing = fields.map((field) => field.label);
      let fieldErrors: string[] = [];
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        this.assertRunning(signal);
        const captcha = await this.captcha(webContents, "shipping", signal);
        if (captcha) return captcha;
        const detectedState = await this.pageState(webContents, signal);
        if (detectedState === "payment" || detectedState === "review" || detectedState === "confirmation") { stage = detectedState; break; }
        const filled = await this.readFields(webContents, fields, signal);
        missing = filled.missing;
        fieldErrors = filled.errors;
        await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
        await this.wait(pollIntervalMs, signal);
      }
      if (stage === "shipping") return { status: "declined", message: `Shipping could not continue after waiting on ${this.pageContext(webContents)}. Fields not found: ${missing.join(", ") || "none; check the page validation message"}.${fieldErrors.length ? ` Frame diagnostics: ${fieldErrors.join(" | ")}` : ""} Nothing was ordered.` };
    }

    if (stage === "payment") {
      const fields = buildPaymentFields(profile);
      if (requiredPaymentLabels.some((label) => !fields.some((field) => field.label === label))) return { status: "declined", message: "The assigned profile has no complete payment card. Nothing was ordered." };
      const payment = splitPaymentFields(fields);
      let methodReady = payment.method.length === 0;
      let missing = payment.details.map((field) => field.label);
      let fieldErrors: string[] = [];
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        this.assertRunning(signal);
        const captcha = await this.captcha(webContents, "payment", signal);
        if (captcha) return captcha;
        const detectedState = await this.pageState(webContents, signal);
        if (detectedState === "review" || detectedState === "confirmation") { stage = detectedState; break; }
        if (!methodReady) {
          const selected = await this.readFields(webContents, payment.method, signal);
          methodReady = selected.missing.length === 0;
          fieldErrors = selected.errors;
          await this.wait(pollIntervalMs, signal);
          continue;
        }
        const filled = await this.readFields(webContents, payment.details, signal);
        missing = filled.missing;
        fieldErrors = filled.errors;
        // Never advance to review when a required card control was not found.
        // A review page can render despite missing hosted-card values and only
        // reject the order after the irreversible Place Order click.
        if (requiredPaymentLabels.every((label) => filled.filled.includes(label))) {
          await webContents.executeJavaScript(buildProceedToCheckoutScript(), true) as ClickResult;
        }
        await this.wait(pollIntervalMs, signal);
      }
      if (stage === "payment") {
        const siteErrors = await this.siteErrors(webContents, signal);
        return { status: "declined", message: `Payment could not continue after waiting on ${this.pageContext(webContents)}. Fields not found: ${missing.join(", ") || "none; check the page validation message"}.${siteErrors.length ? ` Site error: ${siteErrors.join(" | ")}.` : ""}${fieldErrors.length ? ` Frame diagnostics: ${fieldErrors.join(" | ")}` : ""} Nothing was ordered.` };
      }
    }

    if (stage === "review") {
      let submitted = false;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        this.assertRunning(signal);
        const existingConfirmation = await this.confirmation(webContents, signal);
        if (existingConfirmation) return existingConfirmation;
        const captcha = await this.captcha(webContents, "review", signal);
        if (captcha) return captcha;
        const submit = (await webContents.executeJavaScript(buildSubmitOrderScript(), true)) as ClickResult;
        if (submit?.clicked) { submitted = true; stage = "confirmation"; break; }
        await this.wait(pollIntervalMs, signal);
      }
      if (!submitted) return { status: "declined", message: `Place Order did not appear after waiting on ${this.pageContext(webContents)}. Nothing was ordered.` };
    }

    this.assertRunning(signal);
    await onSubmittingOrder?.();
    let lastSiteErrors: string[] = [];
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      this.assertRunning(signal);
      const confirmation = await this.confirmation(webContents, signal);
      if (confirmation) return confirmation;
      const captcha = await this.captcha(webContents, "confirmation", signal);
      if (captcha) return captcha;
      const siteErrors = await this.siteErrors(webContents, signal);
      if (siteErrors.length) lastSiteErrors = siteErrors;
      await this.wait(pollIntervalMs, signal);
    }
    return { status: "declined", message: `Place Order was clicked once, but no confirmation appeared after waiting on ${this.pageContext(webContents)}.${lastSiteErrors.length ? ` Site error: ${lastSiteErrors.join(" | ")}.` : ""} Verify the order before retrying.` };
  }
}
