const pokemonCenterHosts = new Set(["pokemoncenter.com", "www.pokemoncenter.com"]);
const skuPattern = /(?:^|[^0-9])(\d{2}-\d{5}-\d{3})(?:[^0-9]|$)/;
const pokemonCenterOrigin = "https://www.pokemoncenter.com";

export function skuFromProductUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !pokemonCenterHosts.has(url.hostname.toLowerCase())) return "";
    return decodeURIComponent(url.pathname).match(skuPattern)?.[1] ?? "";
  } catch {
    return "";
  }
}

function productSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function isPokemonCenterProductUrlForSku(value: string, sku: string | undefined): boolean {
  const normalizedSku = sku?.trim().toUpperCase();
  if (!normalizedSku) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && pokemonCenterHosts.has(parsed.hostname.toLowerCase())
      && parsed.pathname.toLowerCase().includes("/product/")
      && skuFromProductUrl(parsed.toString()).toUpperCase() === normalizedSku;
  } catch {
    return false;
  }
}

/** Returns an official SKU-bearing product URL, repairing incomplete search-result URLs when possible. */
export function resolvePokemonCenterProductUrl(value: string | undefined, sku: string | undefined, name = ""): string {
  const normalizedSku = sku?.trim().toUpperCase() || skuFromProductUrl(value ?? "").toUpperCase();
  if (!/^[A-Z0-9-]{3,64}$/.test(normalizedSku)) return "";

  try {
    const parsed = new URL(value ?? "");
    if (isPokemonCenterProductUrlForSku(parsed.toString(), normalizedSku)) {
      return parsed.toString();
    }
  } catch { /* Fall through to the canonical SKU route. */ }

  const slug = productSlug(name);
  return `${pokemonCenterOrigin}/product/${encodeURIComponent(normalizedSku)}${slug ? `/${slug}` : ""}`;
}
