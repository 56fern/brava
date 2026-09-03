import type { Profile } from "./types.js";

/**
 * Pure builders for the scripts injected into the harvester window during an
 * automatic checkout. Every builder returns self-contained JavaScript source;
 * they are unit-testable without Electron and never touch a live page.
 *
 * The generated scripts lean on the native value setter + input/change events
 * so React-controlled inputs accept programmatic values, and they resolve
 * fields by autocomplete/name/id/label heuristics rather than fragile hard
 * coded selectors, because the storefront markup changes without notice.
 */

export type CheckoutFieldScript = {
  label: string;
  value: string;
  selectors: string[];
  sensitive?: boolean;
};

const escapeJs = (value: string): string => JSON.stringify(value);

/** Field descriptors keyed by the profile/task data they receive. */
export function buildCheckoutFields(profile: Profile, extra?: { address1Hint?: string }): CheckoutFieldScript[] {
  const billing = profile.payment?.billingSameAsShipping === false && profile.billing ? profile.billing : null;
  const fields: CheckoutFieldScript[] = [
    { label: "First name", value: profile.firstName, selectors: ["[autocomplete='given-name']", "[name*='first' i][name*='name' i]", "#first_name", "#firstName", "[name*='fname' i]"] },
    { label: "Last name", value: profile.lastName, selectors: ["[autocomplete='family-name']", "[name*='last' i][name*='name' i]", "#last_name", "#lastName", "[name*='lname' i]"] },
    { label: "Email", value: profile.email, selectors: ["[autocomplete='email']", "[type='email']", "[name*='email' i]", "#email"] },
    { label: "Phone", value: profile.phone, selectors: ["[autocomplete='tel']", "[type='tel']", "[name*='phone' i]", "#phone"] },
    { label: "Address", value: profile.address1 + (extra?.address1Hint ? ` ${extra.address1Hint}` : ""), selectors: ["[autocomplete='address-line1']", "[name*='address' i][name*='1' i]", "#address1", "[name*='street' i]"] },
    { label: "Address line 2", value: profile.address2, selectors: ["[autocomplete='address-line2']", "[name*='address' i][name*='2' i]", "#address2"] },
    { label: "City", value: profile.city, selectors: ["[autocomplete='address-level2']", "[name*='city' i]", "[name*='town' i]"] },
    { label: "Postal code", value: profile.postalCode, selectors: ["[autocomplete='postal-code']", "[name*='zip' i]", "[name*='postal' i]", "[name*='postcode' i]"] },
  ];
  if (billing) {
    fields.push(
      { label: "Billing first name", value: billing.firstName, selectors: ["#billing_first_name", "[name*='billing' i][name*='first' i]", "[name*='billing_first']"] },
      { label: "Billing last name", value: billing.lastName, selectors: ["#billing_last_name", "[name*='billing' i][name*='last' i]"] },
      { label: "Billing address", value: billing.address1, selectors: ["#billing_address1", "[name*='billing' i][name*='address' i][name*='1' i]"] },
      { label: "Billing city", value: billing.city, selectors: ["#billing_city", "[name*='billing' i][name*='city' i]"] },
      { label: "Billing postal code", value: billing.postalCode, selectors: ["#billing_zip", "[name*='billing' i][name*='zip' i]", "[name*='billing' i][name*='postal' i]"] },
    );
  }
  if (profile.payment?.number) {
    fields.push(
      { label: "Cardholder name", value: profile.payment.cardholderName, selectors: ["[autocomplete='cc-name']", "[name*='name-on-card' i]", "[name*='card' i][name*='name' i]", "#credit_card_name"], sensitive: true },
      { label: "Card number", value: profile.payment.number, selectors: ["[autocomplete='cc-number']", "[name*='card' i][name*='number' i]", "#credit_card_number", "[name*='card' i][name*='num' i]"], sensitive: true },
      { label: "Card expiry month", value: profile.payment.expiryMonth, selectors: ["[autocomplete='cc-exp-month']", "[name*='exp' i][name*='month' i]", "#expiration_date_1i"], sensitive: true },
      { label: "Card expiry year", value: profile.payment.expiryYear, selectors: ["[autocomplete='cc-exp-year']", "[name*='exp' i][name*='year' i]", "#expiration_date_2i"], sensitive: true },
      { label: "Security code", value: profile.payment.cvv ?? "", selectors: ["[autocomplete='cc-csc']", "[name*='cvv' i]", "[name*='security' i][name*='code' i]", "#verification_value"], sensitive: true },
    );
  }
  return fields.filter((field) => field.value.trim().length > 0);
}

/** Escape a string for embedding as a JS string literal in an injected script. */
export const jsString = escapeJs;

/**
 * Script that fills every provided field on the live page and returns which
 * labels it filled. Selects are matched by option text/label; inputs get the
 * native setter + input/change events so React state updates.
 */
export function buildFillFieldsScript(fields: CheckoutFieldScript[]): string {
  const plan = fields.map((field) => ({ label: field.label, value: field.value, selectors: field.selectors }));
  return `(async () => {
  const plan = ${JSON.stringify(plan)};
  const setNativeValue = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const visible = (element) => element && !element.disabled && element.type !== 'hidden' && element.offsetParent !== null;
  const fillField = (field) => {
    for (const selector of field.selectors) {
      let node = null;
      try { node = document.querySelector(selector); } catch { continue; }
      if (!node) continue;
      if (node instanceof HTMLSelectElement) {
        const wanted = field.value.trim().toLowerCase();
        const option = [...node.options].find((entry) => entry.label.trim().toLowerCase() === wanted || entry.value.trim().toLowerCase() === wanted || entry.label.trim().toLowerCase().startsWith(wanted) || entry.value.trim().toLowerCase().startsWith(wanted));
        if (option) { setNativeValue(node, option.value); return field.label; }
        continue;
      }
      if (!visible(node)) continue;
      setNativeValue(node, field.value);
      return field.label;
    }
    return null;
  };
  const filled = [];
  for (const field of plan) { const label = fillField(field); if (label) filled.push(label); }
  return { filled, missing: plan.filter((field) => !filled.includes(field.label)).map((field) => field.label) };
})()`;
}

/** Script that selects a product variant by label/value text and sets quantity. */
export function buildProductPageScript(variant: string, quantity: number): string {
  return `(async () => {
  const wanted = ${escapeJs(variant || "")};
  const quantity = ${JSON.stringify(String(quantity))};
  const setNativeValue = (element, value) => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const visible = (element) => element && !element.disabled && element.offsetParent !== null;
  const result = { variant: null, quantity: null };
  if (wanted) {
    const wantedLower = wanted.trim().toLowerCase();
    const options = [...document.querySelectorAll('select option')].filter((option) => {
      const text = (option.label || option.textContent || '').trim().toLowerCase();
      return text === wantedLower || text.startsWith(wantedLower) || wantedLower.startsWith(text) && text.length > 0;
    });
    const select = options.map((option) => option.closest('select')).find((element) => visible(element));
    if (select && options.length) { setNativeValue(select, options[0].value ?? options[0].textContent); result.variant = options[0].label || options[0].textContent; }
    if (!result.variant) {
      const buttons = [...document.querySelectorAll('button, [role="radio"], input[type="radio"], label')].filter(visible);
      const match = buttons.find((element) => {
        const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().toLowerCase();
        return text === wantedLower || (text.includes(wantedLower) && wantedLower.length >= 2);
      });
      if (match) { match.click(); result.variant = (match.textContent || match.getAttribute('aria-label') || match.getAttribute('title') || '').trim(); }
    }
  }
  const quantityInput = ["[name*='quantity' i]", '[id*="quantity" i]', "[name*='qty' i]", '[id*="qty" i]'].map((selector) => { try { return document.querySelector(selector); } catch { return null; } }).find((element) => visible(element) && !(element instanceof HTMLSelectElement));
  if (quantityInput) { setNativeValue(quantityInput, quantity); result.quantity = quantity; }
  return result;
})()`;
}

/** Script that clicks the add-to-cart control by label text. */
export function buildAddToCartScript(): string {
  const patterns = ["add to cart", "add to bag", "add to basket"];
  return `(() => {
  const patterns = ${JSON.stringify(patterns)};
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const candidates = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], [data-testid*="cart" i]')];
  const match = candidates.find((element) => {
    if (!visible(element)) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.startsWith(pattern));
  });
  if (!match) return { clicked: false, candidates: candidates.filter(visible).length };
  match.click();
  return { clicked: true };
})()`;
}

/** Script that clicks the control that advances from the cart to the checkout form. */
export function buildProceedToCheckoutScript(): string {
  const patterns = ["proceed to checkout", "proceed to secure checkout", "secure checkout", "continue to checkout", "continue to secure checkout", "checkout", "view cart", "go to cart"];
  return `(() => {
  const patterns = ${JSON.stringify(patterns)};
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const candidates = [...document.querySelectorAll('button, [role="button"], a[href*="checkout" i], a[href*="cart" i], input[type="submit"]')];
  const match = candidates.find((element) => {
    if (!visible(element)) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.includes(pattern));
  });
  if (!match) return { clicked: false, candidates: candidates.filter(visible).map((element) => (element.textContent || element.value || '').trim().slice(0, 40)).slice(0, 10) };
  match.click();
  return { clicked: true };
})()`;
}

/** Script that clicks the final order-submission control by label text. */
export function buildSubmitOrderScript(): string {
  const patterns = ["place your order", "place order", "pay now", "complete order", "complete purchase", "submit order", "confirm order", "place the order"];
  return `(() => {
  const patterns = ${JSON.stringify(patterns)};
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const candidates = [...document.querySelectorAll('button, [role="button"], input[type="submit"], button[type="submit"]')];
  const match = candidates.find((element) => {
    if (!visible(element)) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.includes(pattern));
  });
  if (!match) return { clicked: false, candidates: candidates.filter(visible).map((element) => (element.textContent || element.value || '').trim().slice(0, 40)) };
  match.click();
  return { clicked: true };
})()`;
}

/** Pure confirmation detection from the page URL/title/text after submit. */
export function parseOrderConfirmation(input: { url: string; title: string; bodyText: string }): { orderNumber?: string; total?: string; confirmed: boolean } {
  const url = input.url.toLowerCase();
  const title = input.title.toLowerCase();
  const text = input.bodyText;
  const lower = text.toLowerCase();
  const urlConfirmed = /confirmation|thank[- ]?you|order[- ]?(complete|completion|confirm)|\/orders?\//.test(url);
  const textConfirmed = /thank you for your order|order (number|confirmation|complete)|your order has been|order placed|place[dr]? (your )?order (is|was) confirmed/.test(lower);
  const confirmed = urlConfirmed || textConfirmed || /order confirmation|thank you/.test(title);
  if (!confirmed) return { confirmed: false };
  const orderMatch = text.match(/order\s*(?:number|#|no\.?|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,24})/i);
  const totalMatch = text.match(/order\s*total[^$]{0,20}(\$[\d,]+\.\d{2})/i) ?? text.match(/(?:total|amount due|charged)[^$]{0,20}(\$[\d,]+\.\d{2})/i);
  return { confirmed: true, orderNumber: orderMatch?.[1]?.toUpperCase(), total: totalMatch?.[1] };
}
