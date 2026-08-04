import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("proxy testing controls", () => {
  it("offers group and individual tests with visible results", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const proxies = app.slice(app.indexOf("function Proxies("), app.indexOf("function ProxiesLegacy("));

    expect(proxies).toContain('window.brava.proxies.test(proxy.id, testTarget)');
    expect(proxies).toContain('window.brava.proxies.testMany');
    expect(proxies).toContain('"Test all"');
    expect(proxies).toContain('title={`Test proxy on ${targetLabel}`}');
    expect(proxies).toContain('aria-label="Proxy test target"');
    expect(proxies).toContain('<option value="pokemon_center">Pokémon Center</option>');
    expect(proxies).toContain('<option value="google">Google</option>');
    expect(proxies).toContain('<option value="cloudflare">Cloudflare</option>');
    expect(proxies).toContain('<span>Speed</span>');
    expect(proxies).toContain('`${result.latencyMs} ms`');
    expect(proxies).toContain('result.latencyMs');
  });
});
