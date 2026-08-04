import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ProxyConfig, ProxyTestResult, ProxyTestTarget } from "../shared/types.js";

const DEFAULT_TARGET = "http://www.pokemoncenter.com/";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_CONCURRENCY = 100;

export const proxyTestTargets: Record<ProxyTestTarget, string> = {
  pokemon_center: DEFAULT_TARGET,
  google: "http://www.google.com/",
  cloudflare: "http://www.cloudflare.com/",
};

export function proxyTestTargetUrl(target: unknown): string {
  if (target !== "pokemon_center" && target !== "google" && target !== "cloudflare") throw new Error("Unknown proxy test target.");
  return proxyTestTargets[target];
}

export type ProxyTestOptions = {
  target?: string;
  timeoutMs?: number;
  concurrency?: number;
};

function result(proxyId: string, status: ProxyTestResult["status"], message: string, startedAt: number): ProxyTestResult {
  return { proxyId, status, latencyMs: Date.now() - startedAt, message };
}

export function testProxy(proxy: ProxyConfig, options: ProxyTestOptions = {}): Promise<ProxyTestResult> {
  const startedAt = Date.now();
  const target = new URL(options.target ?? DEFAULT_TARGET);
  const timeoutMs = Math.max(500, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
  const request = proxy.protocol === "https" ? httpsRequest : httpRequest;
  const authorization = proxy.username
    ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`, "utf8").toString("base64")}`
    : undefined;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ProxyTestResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const proxyRequest = request({
      host: proxy.host,
      port: proxy.port,
      method: "GET",
      path: target.href,
      servername: proxy.host,
      headers: {
        Host: target.host,
        Connection: "close",
        "Proxy-Connection": "close",
        ...(authorization ? { "Proxy-Authorization": authorization } : {}),
      },
    }, (response) => {
      response.resume();
      const code = response.statusCode ?? 0;
      if (code >= 200 && code < 400) finish(result(proxy.id, "working", `HTTP ${code}`, startedAt));
      else if (code === 407) finish(result(proxy.id, "failed", "Authentication failed", startedAt));
      else if (code === 403) finish(result(proxy.id, "failed", "Blocked by site", startedAt));
      else finish(result(proxy.id, "failed", code ? `HTTP ${code}` : "No response", startedAt));
    });
    proxyRequest.setTimeout(timeoutMs, () => {
      proxyRequest.destroy();
      finish(result(proxy.id, "failed", "Timed out", startedAt));
    });
    proxyRequest.on("error", (error: NodeJS.ErrnoException) => {
      const message = error.code === "ECONNREFUSED" ? "Connection refused"
        : error.code === "ENOTFOUND" ? "Host not found"
          : error.code === "ECONNRESET" ? "Connection reset"
            : "Connection failed";
      finish(result(proxy.id, "failed", message, startedAt));
    });
    proxyRequest.end();
  });
}

export async function testProxies(proxies: ProxyConfig[], options: ProxyTestOptions = {}): Promise<ProxyTestResult[]> {
  if (!proxies.length) return [];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 250, proxies.length));
  const results = new Array<ProxyTestResult>(proxies.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < proxies.length) {
      const index = nextIndex++;
      const proxy = proxies[index];
      if (proxy) results[index] = await testProxy(proxy, options);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
