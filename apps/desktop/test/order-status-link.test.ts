import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { pokemonCenterOrderStatusUrl } from "../src/main/webhook-notifier.js";

describe("Pokémon Center guest order status", () => {
  it("uses the official guest order checker", () => {
    expect(pokemonCenterOrderStatusUrl).toBe("https://www.pokemoncenter.com/orders");
  });

  it("links completed Analytics orders through the constrained external opener", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const preload = await readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8");
    const main = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");

    expect(app).toContain("window.brava.external.openOrderStatus()");
    expect(app).toContain("profile?.postalCode");
    expect(preload).toContain('ipcRenderer.invoke("external:open-order-status")');
    expect(main).toContain('shell.openExternal("https://www.pokemoncenter.com/orders")');
  });
});
