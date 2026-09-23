export type CartDebugFrame = { at: string; label: string; url: string; image: string };
export type CartDebugState = {
  taskId?: string;
  running: boolean;
  message: string;
  latest?: CartDebugFrame;
  snapshots: CartDebugFrame[];
};

// Deliberately exclude checkout, account, and order pages from diagnostics.
export function permitsCartDebugUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["pokemoncenter.com", "www.pokemoncenter.com"].includes(url.hostname)
      && (/^\/product\//i.test(url.pathname) || /^\/cart\/?$/i.test(url.pathname));
  } catch { return false; }
}
