export type BillingUrls = {
  appReturnUrl: string;
  checkoutSuccessUrl: string;
  trustedOrigins: string[];
};

function parseHttpUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  parsed.hash = "";
  return parsed;
}

function withoutTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

/** Resolve only existing, allowlisted destinations for Polar redirects. */
export function resolveBillingUrls(betterAuthUrl: string, bravaAppUrl: string): BillingUrls {
  const auth = parseHttpUrl(betterAuthUrl, "BETTER_AUTH_URL");
  const authBase = withoutTrailingSlash(auth.toString());
  const app = bravaAppUrl
    ? parseHttpUrl(bravaAppUrl, "BRAVA_APP_URL")
    : new URL("/health", authBase);
  const appReturnUrl = withoutTrailingSlash(app.toString());
  const separator = appReturnUrl.includes("?") ? "&" : "?";
  const checkoutSuccessUrl = `${appReturnUrl}${separator}brava_checkout=success&checkout_id={CHECKOUT_ID}`;
  const trustedOrigins = [...new Set([auth.origin, app.origin])];
  return { appReturnUrl, checkoutSuccessUrl, trustedOrigins };
}
