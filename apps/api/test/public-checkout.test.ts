import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { ProductMonitorHub } from "../src/monitor.js";
import { DiscordPublicCheckoutPublisher, type PublicCheckout } from "../src/public-checkout.js";
import { LicenseRepository } from "../src/repository.js";

describe("public checkout feed", () => {
  it("accepts sanitized checkout events only from active licensed devices", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brava-public-checkout-"));
    const publisher = { publish: vi.fn(async (_checkout: PublicCheckout) => "sent" as const) };
    const app = createApp(new LicenseRepository(join(directory, "licenses.json")), new ProductMonitorHub(), publisher);
    const event = {
      eventId: "task-1",
      site: "pokemon_center_us",
      sku: "10-12345-100",
      productName: "Pokemon TCG Box",
      productUrl: "https://www.pokemoncenter.com/product/example",
      quantity: 2,
      price: 99.98,
      clientVersion: "0.48.0",
      profileName: "must not be forwarded",
      orderNumber: "must not be forwarded",
      email: "must-not-be-forwarded@example.com",
    };

    await request(app).post("/v1/checkouts/public").send(event).expect(401);
    const created = await request(app).post("/v1/admin/licenses")
      .set("authorization", `Bearer ${config.adminToken}`)
      .send({ label: "Checkout test", maxDevices: 1, expiresAt: null }).expect(201);
    const activated = await request(app).post("/v1/licenses/activate")
      .send({ key: created.body.key, deviceId: "checkout-device-1", deviceName: "Checkout PC" }).expect(200);
    await request(app).post("/v1/checkouts/public")
      .set("authorization", `Bearer ${activated.body.token}`)
      .send(event).expect(201);

    const forwarded = publisher.publish.mock.calls[0]?.[0];
    expect(forwarded).toMatchObject({ eventId: "task-1", sku: "10-12345-100", quantity: 2 });
    expect(JSON.stringify(forwarded)).not.toContain("profileName");
    expect(JSON.stringify(forwarded)).not.toContain("orderNumber");
    expect(JSON.stringify(forwarded)).not.toContain("must-not-be-forwarded");
  });

  it("brands and deduplicates the Discord public embed", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof fetch;
    const publisher = new DiscordPublicCheckoutPublisher(
      "https://discord.com/api/webhooks/123456789/example_token",
      config.publicCheckoutAvatarPath,
      fetcher,
    );
    const checkout = {
      eventId: "task-public-1",
      site: "pokemon_center_us" as const,
      sku: "10-12345-100",
      productName: "Pokemon TCG Box",
      productUrl: "https://www.pokemoncenter.com/product/example",
      quantity: 1,
      price: 49.99,
      clientVersion: "0.48.0",
    };

    await expect(publisher.publish(checkout)).resolves.toBe("sent");
    await expect(publisher.publish(checkout)).resolves.toBe("duplicate");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const identity = JSON.parse(String((fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body));
    const message = JSON.parse(String((fetcher as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]?.body));
    expect(identity.name).toBe("Brava Checkouts");
    expect(identity.avatar).toMatch(/^data:image\/png;base64,/);
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.embeds[0].title).toBe("Checkout secured ✦");
    expect(message.embeds[0].footer.text).toBe("Brava Public Checkouts · v0.48.0");
    expect(JSON.stringify(message)).not.toMatch(/profile|email|order|proxy|postal|zip/i);
  });
});
