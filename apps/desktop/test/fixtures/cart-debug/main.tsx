import React from "react";
import { createRoot } from "react-dom/client";
import { CartDebugModal } from "../../../src/renderer/src/CartDebugModal";
import "../../../src/renderer/src/styles.css";
import type { CartDebugState } from "../../../src/shared/cart-debug";

let state: CartDebugState = { running: false, message: "Ready for a cart-only test.", snapshots: [] };
const canvas = document.createElement("canvas");
canvas.width = 430; canvas.height = 640;
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 430, 640);
ctx.fillStyle = "#141b26"; ctx.font = "bold 24px sans-serif";
ctx.fillText("Shopping Cart", 28, 64);
ctx.font = "16px sans-serif"; ctx.fillText("Your cart is empty.", 28, 120);
ctx.fillText("LOCAL TEST FIXTURE", 28, 200);
window.brava = { tasks: {
  cartDebugState: async () => state,
  startCartDebug: async () => {
    const frame = { at: new Date().toISOString(), label: "Cart is empty", url: "https://www.pokemoncenter.com/cart", image: canvas.toDataURL() };
    state = { taskId: "fixture", running: false, message: "The store reports an empty cart after Add to Cart. Test stopped; checkout was not attempted.", latest: frame, snapshots: [frame] };
    return state;
  },
  stopCartDebug: async () => state,
} } as unknown as typeof window.brava;
createRoot(document.getElementById("root")!).render(<CartDebugModal task={{ id: "fixture", name: "Pokémon TCG: Pokémon 30th Celebration Card Sleeves (65 Sleeves)" } as never} onClose={() => { document.body.dataset.closed = "true"; }} />);
