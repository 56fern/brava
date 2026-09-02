export const LOCAL_API_URL = "http://127.0.0.1:4310";
export const PRODUCTION_API_URL = "https://api.bravabots.com";

export function resolveApiUrl(explicitUrl: string | undefined, development: boolean): string {
  const configured = explicitUrl?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return development ? LOCAL_API_URL : PRODUCTION_API_URL;
}

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL, import.meta.env.DEV);
