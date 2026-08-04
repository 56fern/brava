import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getVirtualRange } from "../src/shared/virtual-window";

describe("proxy list virtualization", () => {
  it("renders a bounded window for 20,000 proxies", () => {
    const range = getVirtualRange(20_000, 0, 650, 65, 8);
    expect(range).toEqual({ start: 0, end: 18 });
    expect(range.end - range.start).toBeLessThan(30);
  });

  it("moves through the full proxy group without mounting every row", () => {
    const middle = getVirtualRange(20_000, 650_000, 650, 65, 8);
    const end = getVirtualRange(20_000, 1_299_350, 650, 65, 8);
    expect(middle.start).toBe(9_992);
    expect(middle.end - middle.start).toBeLessThan(30);
    expect(end.end).toBe(20_000);
  });

  it("uses the virtual proxy table while preserving test and delete actions", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const activeProxies = app.slice(app.indexOf("function Proxies("), app.indexOf("function ProxiesLegacy("));
    expect(activeProxies).toContain("<VirtualProxyRows");
    expect(activeProxies).toContain("data-total-rows={proxies.length}");
    expect(activeProxies).toContain("data-rendered-rows={visible.length}");
    expect(activeProxies).toContain("onTest={() => onTest(proxy)}");
    expect(activeProxies).toContain("onDelete={() => onDelete(proxy.id)}");
  });
});
