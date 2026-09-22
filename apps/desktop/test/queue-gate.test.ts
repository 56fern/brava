import { describe, expect, it } from "vitest";
import { isPokemonCenterQueuePage } from "../src/main/queue-gate.js";

describe("Pokémon Center queue detection", () => {
  it("detects Queue-it and official waiting-room pages", () => {
    expect(isPokemonCenterQueuePage("https://pokemoncenterus.queue-it.net/?c=test", "Queue", "")).toBe(true);
    expect(isPokemonCenterQueuePage("https://www.pokemoncenter.com/", "Pokémon Center", "You are now in line. Estimated wait time is 8 minutes.")).toBe(true);
  });

  it("does not mistake the normal storefront for a live queue", () => {
    expect(isPokemonCenterQueuePage("https://www.pokemoncenter.com/", "Pokémon Center", "Shop Pokémon cards and accessories")).toBe(false);
  });
});
