import crypto from "node:crypto";
import type { MonitorSourceHealth, ProductSignal, ProductSignalInput } from "./types.js";

const maxSignals = 500;

function normalized(input: ProductSignalInput): ProductSignalInput {
  return {
    ...input,
    sku: input.sku.trim().toUpperCase(),
    name: input.name.trim(),
    productUrl: input.productUrl.trim(),
    source: input.source.trim(),
  };
}

function fingerprint(input: ProductSignalInput): string {
  return JSON.stringify([input.name, input.productUrl, input.available, input.price ?? null, input.maxCartQuantity ?? null]);
}

export class ProductMonitorHub {
  private sequence = 0;
  private readonly signals: ProductSignal[] = [];
  private readonly products = new Map<string, string>();
  private readonly sources = new Map<string, MonitorSourceHealth>();

  observe(raw: ProductSignalInput, announce = true): ProductSignal | null {
    const input = normalized(raw);
    if (!input.sku || !input.name || !input.productUrl) return null;
    const key = `${input.site}:${input.sku}`;
    const nextFingerprint = fingerprint(input);
    if (this.products.get(key) === nextFingerprint) return null;
    this.products.set(key, nextFingerprint);
    if (!announce) return null;
    const signal: ProductSignal = {
      ...input,
      sequence: ++this.sequence,
      id: crypto.randomUUID(),
      detectedAt: input.detectedAt ?? new Date().toISOString(),
    };
    this.signals.push(signal);
    if (this.signals.length > maxSignals) this.signals.splice(0, this.signals.length - maxSignals);
    return signal;
  }

  list(after = 0): ProductSignal[] {
    return this.signals.filter((signal) => signal.sequence > after);
  }

  source(update: MonitorSourceHealth): void {
    this.sources.set(update.source, update);
  }

  health() {
    const sources = [...this.sources.values()];
    const healthySources = sources.filter((source) => source.status === "healthy").length;
    const status = sources.length === 0 ? "idle" : healthySources === sources.length ? "healthy" : healthySources > 0 ? "degraded" : "offline";
    return {
      status,
      sourceCount: sources.length,
      healthySources,
      latestSequence: this.sequence,
      signalCount: this.signals.length,
      latestSignal: this.signals.at(-1) ?? null,
      sources,
    };
  }
}
