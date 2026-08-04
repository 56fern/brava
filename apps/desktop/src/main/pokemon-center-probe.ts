import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { ProductSignal } from "../shared/types.js";

type SearchProduct = {
  code?: unknown;
  name?: unknown;
  url?: unknown;
  outOfStock?: unknown;
  purchasePrice?: unknown;
  listPrice?: unknown;
  maxCartQuantity?: unknown;
  maximumQuantity?: unknown;
  purchaseLimit?: unknown;
};

const searchOrigin = "https://www.pokemoncenter.com";
const probeTimeoutMs = 15_000;

function positiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 1) return Math.floor(numeric);
  }
  return undefined;
}

export function productSignalFromSearchProduct(product: SearchProduct, requestedSku: string): ProductSignal | null {
  const sku = String(product.code ?? "").trim().toUpperCase();
  if (!sku || sku !== requestedSku.trim().toUpperCase()) return null;
  const name = String(product.name ?? "").trim();
  const relativeUrl = String(product.url ?? "").trim();
  if (!name || !relativeUrl) return null;
  let productUrl = "";
  try {
    const parsed = new URL(relativeUrl, searchOrigin);
    if (parsed.origin !== searchOrigin) return null;
    productUrl = parsed.toString();
  } catch { return null; }
  const numericPrice = Number(product.purchasePrice ?? product.listPrice);
  return {
    sequence: Date.now(),
    id: randomUUID(),
    site: "pokemon_center_us",
    sku,
    name,
    productUrl,
    available: product.outOfStock === false,
    price: Number.isFinite(numericPrice) ? numericPrice : undefined,
    maxCartQuantity: positiveInteger(product.maxCartQuantity, product.maximumQuantity, product.purchaseLimit),
    source: `${searchOrigin}/search/${encodeURIComponent(sku)}`,
    detectedAt: new Date().toISOString(),
  };
}

export class PokemonCenterProbe {
  private readonly pending = new Map<string, Promise<ProductSignal | null>>();
  private serial: Promise<void> = Promise.resolve();
  private closed = false;

  lookup(rawSku: string): Promise<ProductSignal | null> {
    const sku = rawSku.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,64}$/.test(sku)) return Promise.resolve(null);
    const existing = this.pending.get(sku);
    if (existing) return existing;
    const result = this.serial.then(() => this.closed ? null : this.run(sku));
    this.serial = result.then(() => undefined, () => undefined);
    this.pending.set(sku, result);
    void result.finally(() => this.pending.delete(sku));
    return result;
  }

  close(): void { this.closed = true; }

  private async run(sku: string): Promise<ProductSignal | null> {
    const probe = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        partition: "persist:brava-product-monitor",
      },
    });
    probe.setSkipTaskbar(true);
    probe.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    probe.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    try {
      await probe.loadURL(`${searchOrigin}/search/${encodeURIComponent(sku)}`, {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
      });
      const deadline = Date.now() + probeTimeoutMs;
      while (!probe.isDestroyed() && Date.now() < deadline) {
        const product = await probe.webContents.executeJavaScript(`(() => {
          const raw = document.querySelector('#__NEXT_DATA__')?.textContent;
          if (!raw) return null;
          try {
            const data = JSON.parse(raw);
            const products = data?.props?.initialState?.search?.results?.products;
            if (!Array.isArray(products)) return null;
            const match = products.find((item) => String(item?.code || '').trim().toUpperCase() === ${JSON.stringify(sku)});
            return match ? JSON.stringify(match) : '__READY_NO_MATCH__';
          } catch { return null; }
        })()`, true) as string | null;
        if (product === "__READY_NO_MATCH__") return null;
        if (product) return productSignalFromSearchProduct(JSON.parse(product) as SearchProduct, sku);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("Official product search did not finish loading in time.");
    } finally {
      if (!probe.isDestroyed()) probe.destroy();
    }
  }
}
