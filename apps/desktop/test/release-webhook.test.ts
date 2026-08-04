import { describe, expect, it } from "vitest";
import { buildReleaseWebhookPayload, validateReleaseWebhookUrl } from "../scripts/release-webhook.mjs";

describe("release webhook", () => {
  it("builds a clean branded update embed", () => {
    const payload = buildReleaseWebhookPayload("1.2.3", {
      title: "New Update Available",
      sections: [{ name: "Improvements", items: ["Faster startup", "Cleaner layout"] }],
      instructions: "Open Settings and select Update & restart.",
    }, true);

    expect(payload.username).toBe("Brava Updates");
    expect(payload.content).toBe("@everyone");
    expect(payload.allowed_mentions.parse).toEqual(["everyone"]);
    expect(payload.embeds[0].author.name).toBe("Brava Changelog");
    expect(payload.embeds[0].title).toBe("New Update Available (1.2.3)");
    expect(payload.embeds[0].fields[0].value).toContain("• Faster startup");
    expect(payload.embeds[0].footer.text).toBe("Brava v1.2.3");
  });

  it("accepts only official Discord webhook URLs", () => {
    expect(validateReleaseWebhookUrl("https://discord.com/api/webhooks/123456789/example-token").hostname).toBe("discord.com");
    expect(() => validateReleaseWebhookUrl("https://example.com/api/webhooks/123/token")).toThrow(/official Discord/i);
  });
});
