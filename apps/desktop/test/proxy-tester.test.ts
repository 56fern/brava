import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { proxyTestTargetUrl, testProxies, testProxy } from "../src/main/proxy-tester.js";
import type { ProxyConfig } from "../src/shared/types.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function mockProxy(statusCode = 204, onRequest?: (url: string, authorization?: string) => void) {
  const server = createServer((request, response) => {
    onRequest?.(request.url ?? "", request.headers["proxy-authorization"]);
    response.writeHead(statusCode).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function proxy(id: string, port: number, username = "", password = ""): ProxyConfig {
  return { id, name: id, protocol: "http", host: "127.0.0.1", port, username, password };
}

describe("proxy tester", () => {
  it("uses only the supported fixed test destinations", () => {
    expect(proxyTestTargetUrl("pokemon_center")).toBe("http://www.pokemoncenter.com/");
    expect(proxyTestTargetUrl("google")).toBe("http://www.google.com/");
    expect(proxyTestTargetUrl("cloudflare")).toBe("http://www.cloudflare.com/");
    expect(() => proxyTestTargetUrl("custom-site")).toThrow("Unknown proxy test target");
  });

  it("tests the destination through the configured authenticated proxy", async () => {
    let seenUrl = "";
    let seenAuthorization = "";
    const port = await mockProxy(204, (url, authorization) => { seenUrl = url; seenAuthorization = authorization ?? ""; });

    const tested = await testProxy(proxy("proxy-1", port, "hello", "world"), { target: "http://store.test/products", timeoutMs: 1_000 });

    expect(tested.status).toBe("working");
    expect(tested.proxyId).toBe("proxy-1");
    expect(tested.latencyMs).toBeTypeOf("number");
    expect(seenUrl).toBe("http://store.test/products");
    expect(seenAuthorization).toBe(`Basic ${Buffer.from("hello:world").toString("base64")}`);
  });

  it("reports authentication failures and tests a group without dropping results", async () => {
    const port = await mockProxy(407);
    const tested = await testProxies([proxy("one", port), proxy("two", port)], { target: "http://store.test/", timeoutMs: 1_000, concurrency: 1 });

    expect(tested).toHaveLength(2);
    expect(tested.map((item) => item.proxyId)).toEqual(["one", "two"]);
    expect(tested.every((item) => item.status === "failed" && item.message === "Authentication failed")).toBe(true);
  });
});
