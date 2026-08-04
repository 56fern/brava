export type HarvesterProxy = {
  protocol: "http" | "https";
  host: string;
  port: number;
  username: string;
  password: string;
};

export function parseHarvesterProxy(value: string): HarvesterProxy | null {
  const input = value.trim();
  if (!input) return null;

  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error("Proxy must use host:port or host:port:username:password.");
    }
    const protocol = url.protocol === "https:" ? "https" : url.protocol === "http:" ? "http" : null;
    const port = Number(url.port || (protocol === "https" ? 443 : 80));
    if (!protocol || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Proxy host or port is invalid.");
    return { protocol, host: url.hostname, port, username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  }

  const parts = input.split(":");
  if (parts.length < 2 || parts.length === 3) throw new Error("Proxy must use host:port or host:port:username:password.");
  const host = parts[0]?.trim() ?? "";
  const port = Number(parts[1]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Proxy host or port is invalid.");
  return { protocol: "http", host, port, username: parts[2] ?? "", password: parts.slice(3).join(":") };
}

export function harvesterProxyLabel(value: string): string {
  try {
    const parsed = parseHarvesterProxy(value);
    return parsed ? `${parsed.host}:${parsed.port}` : "Localhost (no proxy)";
  } catch {
    return "Invalid proxy";
  }
}
