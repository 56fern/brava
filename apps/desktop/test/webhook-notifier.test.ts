import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTask, validateWebhookUrl } from "../src/main/webhook-notifier.js";
import type { AppStore } from "../src/main/store.js";
import type { Task } from "../src/shared/types.js";

afterEach(() => vi.unstubAllGlobals());
const desktopVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

describe("Discord webhook validation", () => {
  it("accepts official Discord webhook URLs", () => {
    expect(validateWebhookUrl("https://discord.com/api/webhooks/123456789/example_token").hostname).toBe("discord.com");
    expect(validateWebhookUrl("https://discord.com/api/v10/webhooks/123456789/example.token-token").pathname).toContain("/webhooks/");
  });

  it("rejects non-Discord and non-webhook URLs", () => {
    expect(() => validateWebhookUrl("http://discord.com/api/webhooks/123/token")).toThrow(/official Discord/i);
    expect(() => validateWebhookUrl("https://example.com/api/webhooks/123/token")).toThrow(/official Discord/i);
    expect(() => validateWebhookUrl("https://discord.com/channels/123/456")).toThrow(/official Discord/i);
  });

  it("sends a green checkout embed without exposing proxy credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    const task: Task = { id: "task-1", name: "Celebration Mini Tins", productUrl: "https://www.pokemoncenter.com/product/example", sku: "10-10465-176", variant: "N/A", quantity: 1, checkoutAmount: 99.9, orderNumber: "PC-123", profileId: "profile-1", proxyId: "proxy-1", status: "completed", statusMessage: "done", updatedAt: new Date().toISOString() };
    const store = {
      getWebhookSettings: async () => ({ successUrl: "https://discord.com/api/webhooks/123456789/example_token", declineUrl: "", successEnabled: true, declineEnabled: true }),
      load: async () => ({
        profiles: [{ id: "profile-1", name: "Primary", email: "buyer@example.com", firstName: "A", lastName: "B", address1: "1 Main", address2: "", city: "City", region: "NY", postalCode: "10001", country: "US", phone: "555" }],
        proxies: [{ id: "proxy-1", name: "Residential group", protocol: "https" as const, host: "secret-host", port: 443, username: "secret-user", password: "secret-pass" }],
        taskGroups: [], tasks: [task], harvesters: [],
      }),
    } as unknown as AppStore;

    await notifyTask(store, task, "success");
    const identityRequest = fetchMock.mock.calls[0];
    const identityPayload = JSON.parse(String(identityRequest?.[1]?.body));
    const payload = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(identityRequest?.[1]?.method).toBe("PATCH");
    expect(identityPayload.name).toBe("Brava");
    expect(identityPayload.avatar).toMatch(/^data:image\/png;base64,/);
    expect(payload.username).toBe("Brava");
    expect(payload.embeds[0].footer.text).toBe(`Brava v${desktopVersion}`);
    expect(payload.embeds[0].title).toBe("Checked Out! 🎉");
    expect(payload.embeds[0].color).toBe(0x43d890);
    expect(JSON.stringify(payload)).toContain("PC-123");
    expect(JSON.stringify(payload)).toContain("https://www.pokemoncenter.com/orders");
    expect(JSON.stringify(payload)).toContain("Shipping ZIP");
    expect(JSON.stringify(payload)).toContain("10001");
    expect(JSON.stringify(payload)).not.toContain("secret-host");
    expect(JSON.stringify(payload)).not.toContain("secret-pass");
  });

  it("sends a neutral connection test embed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    const store = {
      getWebhookSettings: async () => ({ successUrl: "https://discord.com/api/webhooks/123456789/example_test_token", declineUrl: "", successEnabled: true, declineEnabled: true }),
    } as unknown as AppStore;
    const { sendTestWebhook } = await import("../src/main/webhook-notifier.js");
    await sendTestWebhook(store, "success");
    const payload = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(payload.username).toBe("Brava");
    expect(payload.embeds[0].footer.text).toBe(`Brava v${desktopVersion}`);
    expect(payload.embeds[0].title).toBe("Webhook Test");
    expect(payload.embeds[0].description).toMatch(/test message from Brava/i);
    expect(payload.embeds[0].color).toBe(0x5978ff);
  });
});
