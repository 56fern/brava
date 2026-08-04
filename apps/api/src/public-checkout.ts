import { readFile } from "node:fs/promises";
import { z } from "zod";

const discordHosts = new Set(["discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com", "canary.discord.com", "ptb.discord.com"]);
const officialPokemonCenterUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["pokemoncenter.com", "www.pokemoncenter.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

export const publicCheckoutSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  site: z.literal("pokemon_center_us"),
  sku: z.string().trim().max(96).default(""),
  productName: z.string().trim().min(1).max(240),
  productUrl: z.string().trim().max(500).refine((value) => !value || officialPokemonCenterUrl(value), "Invalid product URL").default(""),
  quantity: z.number().int().min(1).max(999),
  price: z.number().nonnegative().max(1_000_000).optional(),
  clientVersion: z.string().trim().regex(/^\d+\.\d+\.\d+$/).max(24),
});

export type PublicCheckout = z.infer<typeof publicCheckoutSchema>;

export interface PublicCheckoutPublisher {
  publish(checkout: PublicCheckout): Promise<"sent" | "duplicate" | "disabled">;
}

function validateDiscordWebhook(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("PUBLIC_CHECKOUT_WEBHOOK_URL must be a valid Discord webhook URL."); }
  if (url.protocol !== "https:" || !discordHosts.has(url.hostname.toLowerCase()) || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) {
    throw new Error("PUBLIC_CHECKOUT_WEBHOOK_URL must use an official Discord HTTPS webhook URL.");
  }
  return url;
}

const escapeMarkdown = (value: string): string => value.split("").map((character) => "[]()*_`".includes(character) ? `\\${character}` : character).join("");

export class DiscordPublicCheckoutPublisher implements PublicCheckoutPublisher {
  private readonly delivered = new Map<string, number>();
  private identityReady = false;

  constructor(
    private readonly webhookUrl: string,
    private readonly avatarPath: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async publish(checkout: PublicCheckout): Promise<"sent" | "duplicate" | "disabled"> {
    if (!this.webhookUrl.trim()) return "disabled";
    if (this.delivered.has(checkout.eventId)) return "duplicate";
    const url = validateDiscordWebhook(this.webhookUrl);
    await this.ensureIdentity(url);
    const productLabel = checkout.sku && checkout.productName !== checkout.sku
      ? `${checkout.sku} · ${checkout.productName}`
      : checkout.productName;
    const safeProductLabel = escapeMarkdown(productLabel);
    const productValue = checkout.productUrl ? `[${safeProductLabel}](${checkout.productUrl})` : safeProductLabel;
    const fields = [
      { name: "Site", value: "Pokemon Center US", inline: true },
      { name: "Mode", value: "Default", inline: true },
      { name: "Product", value: productValue.slice(0, 1024), inline: true },
      { name: "Quantity", value: String(checkout.quantity), inline: true },
      ...(checkout.price == null ? [] : [{ name: "Total", value: `$${checkout.price.toFixed(2)}`, inline: true }]),
    ];
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "Brava Checkouts",
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "Checkout secured ✦",
          color: 0x2f8cff,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: `Brava Public Checkouts · v${checkout.clientVersion}` },
        }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Discord rejected the public checkout webhook (${response.status}).`);
    this.remember(checkout.eventId);
    return "sent";
  }

  private async ensureIdentity(url: URL): Promise<void> {
    if (this.identityReady) return;
    const avatar = await readFile(this.avatarPath);
    const response = await this.fetcher(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Brava Checkouts", avatar: `data:image/png;base64,${avatar.toString("base64")}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Discord rejected the public checkout identity (${response.status}).`);
    this.identityReady = true;
  }

  private remember(eventId: string): void {
    this.delivered.set(eventId, Date.now());
    if (this.delivered.size <= 10_000) return;
    const oldest = this.delivered.keys().next().value as string | undefined;
    if (oldest) this.delivered.delete(oldest);
  }
}
