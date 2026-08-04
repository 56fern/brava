import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

describe("Pokémon Center exact-SKU probe", () => {
  it("creates a verified signal from an exact in-stock search result", async () => {
    const { productSignalFromSearchProduct } = await import("../src/main/pokemon-center-probe.js");
    const signal = productSignalFromSearchProduct({
      code: "10-10608-101",
      name: "Pokémon TCG: Pokémon 30th Celebration Card Sleeves",
      url: "/product/10-10608-101/pokemon-tcg-pokemon-30th-celebration-card-sleeves-65-sleeves",
      outOfStock: false,
      purchasePrice: 7.99,
    }, "10-10608-101");

    expect(signal).toMatchObject({ sku: "10-10608-101", available: true, price: 7.99 });
    expect(signal?.productUrl).toContain("/product/10-10608-101/");
  });

  it("rejects a related search result that is not the requested SKU", async () => {
    const { productSignalFromSearchProduct } = await import("../src/main/pokemon-center-probe.js");
    expect(productSignalFromSearchProduct({ code: "70-10608", name: "Related item", url: "/product/70-10608/related", outOfStock: false }, "10-10608-101")).toBeNull();
  });
});
