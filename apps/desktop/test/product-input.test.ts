import { describe, expect, it } from "vitest";
import { isPokemonCenterProductUrlForSku, resolvePokemonCenterProductUrl } from "../src/shared/product-input.js";

describe("Pokémon Center product URLs", () => {
  it("repairs an incomplete URL using the task SKU", () => {
    expect(resolvePokemonCenterProductUrl("https://www.pokemoncenter.com/-", "10-10608-101", "Pokémon 30th Celebration Sleeves"))
      .toBe("https://www.pokemoncenter.com/product/10-10608-101/pokemon-30th-celebration-sleeves");
  });

  it("only treats the current product page as reusable when its SKU matches the task", () => {
    const current = "https://www.pokemoncenter.com/product/10-99999-999/another-product";
    expect(isPokemonCenterProductUrlForSku(current, "10-99999-999")).toBe(true);
    expect(isPokemonCenterProductUrlForSku(current, "10-10608-101")).toBe(false);
    expect(isPokemonCenterProductUrlForSku("https://www.pokemoncenter.com/-", "10-10608-101")).toBe(false);
  });
});
