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

export type CheckoutPageState = "product" | "cart" | "guest" | "shipping" | "payment" | "review" | "confirmation" | "unknown";

const escapeJs = (value: string): string => JSON.stringify(value);

/** Field descriptors keyed by the profile/task data they receive. */
export function buildCheckoutFields(profile: Profile, extra?: { address1Hint?: string }): CheckoutFieldScript[] {
  const billing = profile.payment?.billingSameAsShipping === false && profile.billing ? profile.billing : null;
  const fields: CheckoutFieldScript[] = [
    { label: "First name", value: profile.firstName, selectors: ["[autocomplete='given-name']", "[name*='first' i][name*='name' i]", "[id*='first' i][id*='name' i]", "#first_name", "#firstName", "[name*='fname' i]"] },
    { label: "Last name", value: profile.lastName, selectors: ["[autocomplete='family-name']", "[name*='last' i][name*='name' i]", "[id*='last' i][id*='name' i]", "#last_name", "#lastName", "[name*='lname' i]"] },
    { label: "Email", value: profile.email, selectors: ["[autocomplete='email']", "[type='email']", "[name*='email' i]", "#email"] },
    { label: "Phone", value: profile.phone, selectors: ["[autocomplete='tel']", "[type='tel']", "[name*='phone' i]", "#phone"] },
    { label: "Address", value: profile.address1 + (extra?.address1Hint ? ` ${extra.address1Hint}` : ""), selectors: ["[autocomplete='address-line1']", "[name*='address' i][name*='1' i]", "#address1", "[name*='street' i]"] },
    { label: "Address line 2", value: profile.address2, selectors: ["[autocomplete='address-line2']", "[name*='address' i][name*='2' i]", "#address2"] },
    { label: "City", value: profile.city, selectors: ["[autocomplete='address-level2']", "[name*='city' i]", "[id*='city' i]", "[name*='town' i]", "[id*='town' i]"] },
    { label: "State / region", value: profile.region, selectors: ["[autocomplete='address-level1']", "[name*='state' i]", "[name*='region' i]", "[name*='province' i]"] },
    { label: "Postal code", value: profile.postalCode, selectors: ["[autocomplete='postal-code']", "[name*='zip' i]", "[name*='postal' i]", "[name*='postcode' i]"] },
    { label: "Country", value: profile.country, selectors: ["[autocomplete='country']", "[autocomplete='country-name']", "[name*='country' i]"] },
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

const paymentLabels = new Set(["Cardholder name", "Card number", "Card expiry month", "Card expiry year", "Security code"]);

/** Fields that belong on the shipping/contact step, excluding card inputs. */
export function buildShippingFields(profile: Profile): CheckoutFieldScript[] {
  return buildCheckoutFields(profile).filter((field) => !field.label.startsWith("Billing ") && !paymentLabels.has(field.label));
}

/** Fields that belong on the payment step, including a separate billing address when configured. */
export function buildPaymentFields(profile: Profile): CheckoutFieldScript[] {
  return buildCheckoutFields(profile).filter((field) => field.label.startsWith("Billing ") || paymentLabels.has(field.label));
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
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
      if (element instanceof HTMLIFrameElement) {
        try { if (element.contentDocument && !roots.includes(element.contentDocument)) roots.push(element.contentDocument); } catch {}
      }
    }
  }
  const query = (selector) => {
    for (const root of roots) {
      try { const node = root.querySelector(selector); if (node) return node; } catch {}
    }
    return null;
  };
  const labelText = (node) => {
    const id = node.id;
    const explicit = id ? roots.map((root) => { try { return root.querySelector('label[for="' + CSS.escape(id) + '"]'); } catch { return null; } }).find(Boolean) : null;
    return [explicit?.textContent, node.closest('label')?.textContent, node.getAttribute('aria-label'), node.getAttribute('placeholder'), node.name, node.id].filter(Boolean).join(' ').toLowerCase();
  };
  const fillField = (field) => {
    for (const selector of field.selectors) {
      const node = query(selector);
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
    const wanted = field.label.toLowerCase().replace(' / region', '').replace(' line 2', '');
    const tokens = wanted.split(/\s+/).filter((token) => token.length > 2 && token !== 'billing');
    const controls = roots.flatMap((root) => [...root.querySelectorAll('input, select, textarea')]);
    const node = controls.find((control) => visible(control) && tokens.every((token) => labelText(control).includes(token)));
    if (node instanceof HTMLSelectElement) {
      const value = field.value.trim().toLowerCase();
      const option = [...node.options].find((entry) => entry.label.trim().toLowerCase() === value || entry.value.trim().toLowerCase() === value || entry.label.trim().toLowerCase().startsWith(value));
      if (!option) return null;
      setNativeValue(node, option.value);
      return field.label;
    }
    if (node) { setNativeValue(node, field.value); return field.label; }
    return null;
  };
  const filled = [];
  for (const field of plan) { const label = fillField(field); if (label) filled.push(label); }
  return { filled, missing: plan.filter((field) => !filled.includes(field.label)).map((field) => field.label) };
})()`;
}

/** Detects the current Pokémon Center checkout page without mutating it. */
export function buildCheckoutPageStateScript(): string {
  return `(() => {
  const url = location.href.toLowerCase();
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const controls = [...document.querySelectorAll('button, a, input, select, textarea')].filter(visible);
  const text = (element) => (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
  const hasText = (patterns) => controls.some((element) => patterns.some((pattern) => text(element).includes(pattern)));
  const hasSelector = (selectors) => selectors.some((selector) => { try { return visible(document.querySelector(selector)); } catch { return false; } });
  if (/confirmation|thank[- ]?you|order[- ]?(complete|confirmation)/.test(url) || /thank you for your order/i.test(document.body?.innerText || '')) return { state: 'confirmation', url: location.href };
  if (['/checkout/review', '/checkout/summary', '/review'].some((part) => url.includes(part)) || hasText(['place order', 'place your order'])) return { state: 'review', url: location.href };
  if (['/checkout/payment', '/checkout/billing', '/payment'].some((part) => url.includes(part)) || hasSelector(["[autocomplete='cc-number']", "[name*='card' i][name*='number' i]"])) return { state: 'payment', url: location.href };
  if (['/checkout/address', '/checkout/shipping', '/checkout/delivery', '/address', '/shipping'].some((part) => url.includes(part)) || hasSelector(["[autocomplete='given-name']", "[name*='first' i][name*='name' i]", "[id*='first' i][id*='name' i]"])) return { state: 'shipping', url: location.href };
  if (hasText(['guest checkout', 'checkout as guest', 'continue as guest'])) return { state: 'guest', url: location.href };
  if (url.includes('/cart') || url.includes('/bag')) return { state: 'cart', url: location.href };
  if (url.includes('/product/') || hasText(['add to cart', 'add to bag'])) return { state: 'product', url: location.href };
  return { state: 'unknown', url: location.href };
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
    if (!visible(element) || element.hasAttribute('data-brava-clicked')) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.startsWith(pattern));
  });
  if (!match) return { clicked: false, candidates: candidates.filter(visible).length };
  match.setAttribute('data-brava-clicked', 'true');
  match.click();
  return { clicked: true };
})()`;
}

/** Opens the cart after Add to Cart, using the visible cart control or the official cart path. */
export function buildOpenCartScript(allowDirectNavigation = false): string {
  return `(() => {
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const candidates = [...document.querySelectorAll('a[href*="/cart" i], a[href*="/bag" i], button, [role="button"], [data-testid*="cart" i]')];
  const match = candidates.find((element) => {
    if (!visible(element) || element.hasAttribute('data-brava-opened-cart')) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().toLowerCase();
    const href = (element.getAttribute('href') || '').toLowerCase();
    return href.includes('/cart') || href.includes('/bag') || ['view cart', 'go to cart', 'shopping cart', 'my cart', 'cart'].some((pattern) => text === pattern || text.includes(pattern));
  });
  if (match) {
    match.setAttribute('data-brava-opened-cart', 'true');
    match.click();
    return { clicked: true, direct: false };
  }
  if (${JSON.stringify(allowDirectNavigation)} && location.origin.includes('pokemoncenter.com')) {
    location.assign(new URL('/cart', location.origin).href);
    return { clicked: true, direct: true };
  }
  return { clicked: false };
})()`;
}

/** Selects the guest path instead of waiting for an account sign-in. */
export function buildGuestCheckoutScript(): string {
  const patterns = ["guest checkout", "checkout as guest", "continue as guest", "guest"];
  return `(() => {
  const patterns = ${JSON.stringify(patterns)};
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const candidates = [...document.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"]')];
  const match = candidates.find((element) => {
    if (!visible(element) || element.hasAttribute('data-brava-guest-clicked')) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.includes(pattern));
  });
  if (!match) return { clicked: false };
  match.setAttribute('data-brava-guest-clicked', 'true');
  match.click();
  return { clicked: true };
})()`;
}

/** Script that clicks the control that advances from the cart to the checkout form. */
export function buildProceedToCheckoutScript(): string {
  const patterns = ["proceed to checkout", "proceed to secure checkout", "secure checkout", "continue to checkout", "continue to secure checkout", "continue to payment", "continue to delivery", "continue to shipping", "continue to review", "save and continue", "review order", "checkout", "continue", "next"];
  return `(() => {
  const patterns = ${JSON.stringify(patterns)};
  const visible = (element) => element && element.offsetParent !== null && !element.disabled;
  const candidates = [...document.querySelectorAll('button, [role="button"], a[href*="checkout" i], a[href*="cart" i], input[type="submit"]')];
  const match = candidates.find((element) => {
    if (!visible(element)) return false;
    const lastClicked = Number(element.getAttribute('data-brava-last-clicked') || 0);
    if (Date.now() - lastClicked < 900) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.includes(pattern));
  });
  if (!match) return { clicked: false, candidates: candidates.filter(visible).map((element) => (element.textContent || element.value || '').trim().slice(0, 40)).slice(0, 10) };
  match.setAttribute('data-brava-last-clicked', String(Date.now()));
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
    if (!visible(element) || element.hasAttribute('data-brava-clicked')) return false;
    const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || element.value || '').trim().toLowerCase();
    return patterns.some((pattern) => text === pattern || text.includes(pattern));
  });
  if (!match) return { clicked: false, candidates: candidates.filter(visible).map((element) => (element.textContent || element.value || '').trim().slice(0, 40)) };
  match.setAttribute('data-brava-clicked', 'true');
  match.click();
  return { clicked: true };
})()`;
}

/** Detects a CAPTCHA that is actually present on the current checkout page. */
export function buildCaptchaDetectionScript(): string {
  return `(() => {
  const selectors = [
    'iframe[src*="hcaptcha" i]',
    'iframe[title*="hcaptcha" i]',
    'iframe[src*="recaptcha" i]',
    'iframe[src*="challenges.cloudflare" i]',
    '.h-captcha',
    '.g-recaptcha',
    '.cf-turnstile',
    '[data-sitekey]',
    '#challenge-stage'
  ];
  const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  const pageSignal = /captcha|verify you are human|security check|just a moment/i.test(document.title || '')
    || /captcha|challenge/.test(location.pathname.toLowerCase());
  return { detected: Boolean(element || pageSignal), url: location.href };
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
