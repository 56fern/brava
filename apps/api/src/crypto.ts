import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const body = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `BRVA-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
}

export function hashLicenseKey(key: string): string {
  return createHash("sha256").update(`${config.licensePepper}:${key.trim().toUpperCase()}`).digest("hex");
}

type TokenPayload = { licenseId: string; deviceId: string; exp: number };

export function signToken(payload: TokenPayload): string {
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", config.tokenSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", config.tokenSecret).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
