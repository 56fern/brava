const pokemonCenterHosts = new Set(["pokemoncenter.com", "www.pokemoncenter.com"]);
const skuPattern = /(?:^|[^0-9])(\d{2}-\d{5}-\d{3})(?:[^0-9]|$)/;

export function skuFromProductUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !pokemonCenterHosts.has(url.hostname.toLowerCase())) return "";
    return decodeURIComponent(url.pathname).match(skuPattern)?.[1] ?? "";
  } catch {
    return "";
  }
}
