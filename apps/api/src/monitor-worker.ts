import type { ProductMonitorHub } from "./monitor.js";
import type { ProductSignalInput } from "./types.js";

type Candidate = Record<string, unknown>;

function absoluteUrl(value: unknown, sourceUrl: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
}

function availability(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").toLowerCase();
  return !text.includes("outofstock") && !text.includes("sold out") && !text.includes("unavailable");
}

function positiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 1) return Math.floor(numeric);
  }
  return undefined;
}

function candidate(value: Candidate, sourceUrl: string): ProductSignalInput | null {
  const sku = String(value.sku ?? value.productID ?? "").trim();
  const name = String(value.name ?? value.title ?? "").trim();
  const productUrl = absoluteUrl(value.productUrl ?? value.url, sourceUrl);
  if (!sku || !name || !productUrl) return null;
  const numericPrice = Number(value.price);
  const maxCartQuantity = positiveInteger(value.maxCartQuantity, value.maximumQuantity, value.maxQuantity, value.purchaseLimit, value.quantityLimit);
  return {
    site: "pokemon_center_us",
    sku,
    name,
    productUrl,
    available: availability(value.available ?? (value as Record<string, unknown>).availability),
    price: Number.isFinite(numericPrice) ? numericPrice : undefined,
    maxCartQuantity,
    source: sourceUrl,
  };
}

function walkJson(value: unknown, sourceUrl: string, output: ProductSignalInput[]): void {
  if (Array.isArray(value)) return value.forEach((item) => walkJson(item, sourceUrl, output));
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = String(record["@type"] ?? "").toLowerCase();
  if (type === "product" || record.sku || record.productID) {
    const offers = Array.isArray(record.offers) ? record.offers[0] : record.offers;
    const offer = offers && typeof offers === "object" ? offers as Record<string, unknown> : {};
    const parsed = candidate({
      ...record,
      productUrl: record.url,
      price: record.price ?? offer.price,
      available: record.available ?? offer.availability,
      maxCartQuantity: record.maxCartQuantity ?? record.maximumQuantity ?? record.maxQuantity ?? record.purchaseLimit ?? record.quantityLimit ?? offer.maxCartQuantity ?? offer.maximumQuantity,
    }, sourceUrl);
    if (parsed) output.push(parsed);
  }
  for (const nested of Object.values(record)) walkJson(nested, sourceUrl, output);
}

export function parseProductSignals(body: string, contentType: string, sourceUrl: string): ProductSignalInput[] {
  const output: ProductSignalInput[] = [];
  const jsonDocuments: unknown[] = [];
  if (contentType.includes("json")) {
    try { jsonDocuments.push(JSON.parse(body)); } catch { /* Source health records malformed JSON. */ }
  } else {
    for (const match of body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { jsonDocuments.push(JSON.parse(match[1] ?? "")); } catch { /* Ignore malformed page metadata. */ }
    }
  }
  for (const document of jsonDocuments) walkJson(document, sourceUrl, output);
  const unique = new Map(output.map((item) => [`${item.site}:${item.sku}`, item]));
  return [...unique.values()];
}

export class ProductMonitorWorker {
  private timer?: NodeJS.Timeout;
  private readonly primed = new Set<string>();
  private readonly validators = new Map<string, { etag?: string; modified?: string }>();

  constructor(
    private readonly hub: ProductMonitorHub,
    private readonly sources: string[],
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
  ) {}

  start(): void {
    for (const source of this.sources) {
      this.hub.source({ source, status: "warming", productsSeen: 0 });
      void this.poll(source);
    }
    if (this.sources.length) this.timer = setInterval(() => this.sources.forEach((source) => void this.poll(source)), this.intervalMs);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  async poll(source: string): Promise<void> {
    const checkedAt = new Date().toISOString();
    try {
      const previous = this.validators.get(source) ?? {};
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await fetch(source, {
        headers: {
          accept: "application/json,text/html;q=0.9",
          "user-agent": "Brava-Monitor/0.14 (+central product signal service)",
          ...(previous.etag ? { "if-none-match": previous.etag } : {}),
          ...(previous.modified ? { "if-modified-since": previous.modified } : {}),
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (response.status === 304) {
        this.hub.source({ source, status: "healthy", lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, productsSeen: 0 });
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.validators.set(source, { etag: response.headers.get("etag") ?? undefined, modified: response.headers.get("last-modified") ?? undefined });
      const products = parseProductSignals(await response.text(), response.headers.get("content-type") ?? "", source);
      const announce = this.primed.has(source);
      products.forEach((product) => this.hub.observe(product, announce));
      this.primed.add(source);
      this.hub.source({ source, status: "healthy", lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, productsSeen: products.length });
    } catch (error) {
      this.hub.source({ source, status: "error", lastCheckedAt: checkedAt, lastError: error instanceof Error ? error.message : "Monitor request failed", productsSeen: 0 });
    }
  }
}
